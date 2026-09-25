import { spawn, execFile } from 'child_process'
import { accessSync, constants, createWriteStream, mkdtempSync, readdirSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { app, BrowserWindow, ipcMain, net, Notification, shell } from 'electron'
import { IPC, type UpdateState } from '@shared/ipc'

const run = promisify(execFile)
const FEED = process.env.MYSTICALS_UPDATE_FEED || 'https://api.github.com/repos/a1exalexander/mysticals/releases/latest'
// Dev/e2e runs only check against an explicit feed and never swap the bundle.
const ENABLED = app.isPackaged || !!process.env.MYSTICALS_UPDATE_FEED
const EVERY = 6 * 60 * 60_000
// ponytail: in-place swap is macOS-only; Windows/Linux get the release page. electron-updater if that's not enough.
const SWAP = process.platform === 'darwin'
// Developer ID team the update must be signed by; empty in dev and local ad-hoc builds, which skip the check.
const TEAM = import.meta.env.MYSTICALS_APPLE_TEAM_ID?.match(/^[A-Z0-9]{10}$/)?.[0] ?? ''

let state: UpdateState = { status: 'idle' }
let zipUrl = ''
let pageUrl = ''
const notified = new Set<string>()
// Held until closed/clicked: a GC'd Notification drops its click handler.
const banners = new Set<Notification>()

/** True when numeric x.y.z `a` is newer than `b`. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

function set(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.update, state)
}

function banner(version: string): void {
  if (notified.has(version) || !Notification.isSupported()) return
  notified.add(version)
  const n = new Notification({ title: `Mysticals ${version} is available`, body: SWAP ? 'Click to update' : 'Click to download' })
  banners.add(n)
  n.on('close', () => banners.delete(n))
  n.on('failed', (_, error) => {
    banners.delete(n)
    console.error('notification failed', error)
  })
  n.on('click', () => {
    banners.delete(n)
    void install()
  })
  n.show()
}

/** Polls the latest GitHub release; network errors are logged, never surfaced. */
async function check(): Promise<UpdateState> {
  if (!ENABLED || state.status === 'downloading' || state.status === 'ready') return state
  try {
    const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(`feed ${res.status}`)
    const rel = (await res.json()) as {
      tag_name?: string
      html_url?: string
      assets?: { name: string; browser_download_url: string }[]
    }
    const version = (rel.tag_name ?? '').replace(/^v/, '')
    const asset = rel.assets?.find((a) => a.name.endsWith(`-${process.arch}-mac.zip`))
    const page = /^https:\/\/github\.com\//.test(rel.html_url ?? '') ? rel.html_url! : ''
    if (!/^\d+\.\d+\.\d+$/.test(version) || !(SWAP ? asset : page) || !newer(version, app.getVersion())) return state
    zipUrl = asset?.browser_download_url ?? ''
    pageUrl = page
    if (state.version !== version || state.status === 'idle') set({ status: 'available', version })
    banner(version)
  } catch (e) {
    console.error('update check failed', e)
  }
  return state
}

async function download(url: string, file: string): Promise<void> {
  const res = await net.fetch(url)
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    async function* (src: AsyncIterable<Buffer>) {
      for await (const chunk of src) {
        got += chunk.length
        const progress = total ? Math.floor((got / total) * 100) : 0
        if (progress !== state.progress) set({ ...state, progress })
        yield chunk
      }
    },
    createWriteStream(file)
  )
}

/** Downloads + unpacks the release, then swaps the running .app bundle via a detached script and quits. */
async function install(): Promise<void> {
  if (!SWAP) {
    if (pageUrl) await shell.openExternal(pageUrl)
    return
  }
  if ((state.status !== 'available' && state.status !== 'error') || !zipUrl) return
  const version = state.version
  set({ status: 'downloading', version, progress: 0 })
  try {
    // .../Mysticals.app/Contents/MacOS/Mysticals → .../Mysticals.app
    const target = resolve(process.execPath, '../../..')
    if (app.isPackaged) {
      if (!target.endsWith('.app')) throw new Error(`not running from an app bundle: ${target}`)
      accessSync(dirname(target), constants.W_OK)
    }
    const dir = mkdtempSync(join(tmpdir(), 'mysticals-update-'))
    const zip = join(dir, 'update.zip')
    await download(zipUrl, zip)
    const out = join(dir, 'out')
    await run('ditto', ['-x', '-k', zip, out])
    const name = readdirSync(out).find((n) => n.endsWith('.app'))
    if (!name) throw new Error('no .app in update archive')
    const fresh = join(out, name)
    // Refuse a bundle not signed by our Developer ID team, so a tampered release asset never replaces the app.
    if (TEAM) {
      const req = `anchor apple generic and certificate leaf[subject.OU] = "${TEAM}"`
      await run('codesign', ['--verify', '--deep', '--strict', '-R', req, fresh])
    }
    // Drop quarantine so Gatekeeper does not re-assess the relaunch.
    await run('xattr', ['-cr', fresh])
    set({ status: 'ready', version })
    if (!app.isPackaged) return
    // Paths go in as positional args ($1..$3), so no shell quoting is involved.
    const script = [
      'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
      'rm -rf "$2.old"; mv "$2" "$2.old" || { open "$2"; exit 1; }',
      'if mv "$3" "$2"; then rm -rf "$2.old"; else rm -rf "$2"; mv "$2.old" "$2"; fi',
      'open "$2"'
    ].join('\n')
    spawn('/bin/sh', ['-c', script, 'sh', String(process.pid), target, fresh], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  } catch (e) {
    console.error('update failed', e)
    set({ status: 'error', version, error: e instanceof Error ? e.message : String(e) })
  }
}

/** Registers update IPC and starts background checks (on launch, then every 6h). */
export function startUpdater(): void {
  ipcMain.handle(IPC.updateState, () => state)
  ipcMain.handle(IPC.updateCheck, check)
  ipcMain.handle(IPC.updateInstall, install)
  if (!ENABLED) return
  void check()
  setInterval(() => void check(), EVERY)
}
