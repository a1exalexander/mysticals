import { spawn, execFile } from 'child_process'
import { accessSync, constants, createWriteStream, mkdtempSync, readdirSync, rmSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'
import { promisify } from 'util'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { app, net, Notification, shell } from 'electron'
import { Deferred, Effect, Fiber, Schedule } from 'effect'
import { IPC, type UpdateState } from '@shared/ipc'
import { t } from '@mysticals/core/i18n'
import { currentLocale } from './locale'
import { AnyArgs, handle } from './ipc/register'
import { broadcast, showBanner } from './window'

const run = promisify(execFile)
const FEED = process.env.MYSTICALS_UPDATE_FEED || 'https://api.github.com/repos/a1exalexander/mysticals/releases/latest'
// Dev/e2e runs only check against an explicit feed and never swap the bundle.
const ENABLED = app.isPackaged || !!process.env.MYSTICALS_UPDATE_FEED
const EVERY = '6 hours'
// A stalled feed must not hold the next check (single-flight) forever.
const CHECK_TIMEOUT = '30 seconds'
// ponytail: in-place swap is macOS-only; Windows/Linux get the release page. electron-updater if that's not enough.
const SWAP = process.platform === 'darwin'
// Developer ID team the update must be signed by; empty in dev and local ad-hoc builds, which skip the check.
const TEAM = import.meta.env.MYSTICALS_APPLE_TEAM_ID?.match(/^[A-Z0-9]{10}$/)?.[0] ?? ''

let state: UpdateState = { status: 'idle' }
let zipUrl = ''
let pageUrl = ''
const notified = new Set<string>()

/** Runs `f` as an interruptible Effect (aborting `signal`); throws become failures with the same Error. */
const attempt = <A>(f: (signal: AbortSignal) => A | Promise<A>): Effect.Effect<A, Error> =>
  Effect.tryPromise({ try: async (signal) => f(signal), catch: (e) => (e instanceof Error ? e : new Error(String(e))) })

const exec = (cmd: string, args: string[]): Effect.Effect<unknown, Error> => attempt((signal) => run(cmd, args, { signal }))

/** True when numeric x.y.z `a` is newer than `b`. */
export function newer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

/** Fails unless `bundle` is signed by Developer ID `team`. */
export const verifyTeam = (bundle: string, team: string): Effect.Effect<void, Error> =>
  // The leading '=' marks inline requirement text; without it codesign reads the argument as a file path.
  Effect.asVoid(exec('codesign', ['--verify', '--deep', '--strict', '-R', `=anchor apple generic and certificate leaf[subject.OU] = "${team}"`, bundle]))

function set(next: UpdateState): void {
  state = next
  broadcast(IPC.update, state)
}

const download = (url: string, file: string): Effect.Effect<void, Error> =>
  attempt(async (signal) => {
    const res = await net.fetch(url, { signal })
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
      createWriteStream(file),
      { signal }
    )
  })

/** Registers update IPC and starts background checks (on launch, then every 6h). Closing the scope stops a download. */
export const startUpdater = Effect.gen(function* () {
  const scope = yield* Effect.scope

  /** Downloads + unpacks the release, then swaps the running .app bundle via a detached script and quits. */
  const install: Effect.Effect<void, Error> = Effect.suspend(() => {
    if (!SWAP) return pageUrl ? attempt(() => shell.openExternal(pageUrl)) : Effect.void
    if ((state.status !== 'available' && state.status !== 'error') || !zipUrl) return Effect.void
    const version = state.version
    set({ status: 'downloading', version, progress: 0 })
    let dir = ''
    // A failed or cancelled attempt would otherwise leave the ~130MB download behind in $TMPDIR. A finished one keeps
    // it: the swap script moves the new bundle out of it after we quit.
    const cleanUp = (): void => {
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
    return Effect.gen(function* () {
      // .../Mysticals.app/Contents/MacOS/Mysticals → .../Mysticals.app
      const target = resolve(process.execPath, '../../..')
      if (app.isPackaged) {
        if (!target.endsWith('.app')) return yield* Effect.fail(new Error(`not running from an app bundle: ${target}`))
        yield* attempt(() => accessSync(dirname(target), constants.W_OK))
      }
      dir = yield* attempt(() => mkdtempSync(join(tmpdir(), 'mysticals-update-')))
      const zip = join(dir, 'update.zip')
      yield* download(zipUrl, zip)
      const out = join(dir, 'out')
      yield* exec('ditto', ['-x', '-k', zip, out])
      const name = (yield* attempt(() => readdirSync(out))).find((n) => n.endsWith('.app'))
      if (!name) return yield* Effect.fail(new Error('no .app in update archive'))
      const fresh = join(out, name)
      // Refuse a bundle not signed by our Developer ID team, so a tampered release asset never replaces the app.
      if (TEAM) yield* verifyTeam(fresh, TEAM)
      // Drop quarantine so Gatekeeper does not re-assess the relaunch.
      yield* exec('xattr', ['-cr', fresh])
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
      // The script owns the download now: quitting interrupts this fiber, which must not delete it.
      dir = ''
      app.quit()
    }).pipe(
      Effect.catch((e) =>
        Effect.sync(() => {
          console.error('update failed', e)
          cleanUp()
          set({ status: 'error', version, error: e.message })
        })
      ),
      Effect.onInterrupt(() => Effect.sync(cleanUp))
    )
  })
  // In the app's scope, so quitting mid-download stops it.
  const installInScope = Effect.forkIn(install, scope).pipe(Effect.flatMap(Fiber.join))

  const banner = (version: string): void => {
    if (notified.has(version) || !Notification.isSupported()) return
    notified.add(version)
    showBanner({ title: t(currentLocale(), 'update.available', { version }), body: t(currentLocale(), SWAP ? 'update.clickToUpdate' : 'update.clickToDownload') }, () =>
      Effect.runFork(Effect.ignore(installInScope))
    )
  }

  /** Polls the latest GitHub release; network errors are logged, never surfaced. */
  const checkOnce: Effect.Effect<UpdateState> = Effect.gen(function* () {
    if (!ENABLED || state.status === 'downloading' || state.status === 'ready') return state
    const rel = yield* attempt(async (signal) => {
      const res = await net.fetch(FEED, { headers: { Accept: 'application/vnd.github+json' }, signal })
      if (!res.ok) throw new Error(`feed ${res.status}`)
      return (await res.json()) as {
        tag_name?: string
        html_url?: string
        assets?: { name: string; browser_download_url: string }[]
      }
    }).pipe(Effect.timeout(CHECK_TIMEOUT))
    const version = (rel.tag_name ?? '').replace(/^v/, '')
    const asset = rel.assets?.find((a) => a.name.endsWith(`-${process.arch}-mac.zip`))
    const page = /^https:\/\/github\.com\//.test(rel.html_url ?? '') ? rel.html_url! : ''
    if (!/^\d+\.\d+\.\d+$/.test(version) || !(SWAP ? asset : page) || !newer(version, app.getVersion())) return state
    zipUrl = asset?.browser_download_url ?? ''
    pageUrl = page
    if (state.version !== version || state.status === 'idle') set({ status: 'available', version })
    banner(version)
    return state
  }).pipe(
    Effect.catch((e) =>
      Effect.sync(() => {
        console.error('update check failed', e)
        return state
      })
    )
  )

  // Single-flight: a check asked for while one runs (Settings button vs. the timer) gets that one's result.
  let checking: Deferred.Deferred<UpdateState> | undefined
  const check: Effect.Effect<UpdateState> = Effect.suspend(() => {
    if (checking) return Deferred.await(checking)
    const done = (checking = Deferred.makeUnsafe<UpdateState>())
    const once = checkOnce.pipe(
      Effect.onExit((exit) => {
        checking = undefined
        return Deferred.done(done, exit)
      })
    )
    return Effect.forkIn(once, scope).pipe(Effect.andThen(Deferred.await(done)))
  })

  yield* handle(IPC.updateState, AnyArgs, () => Effect.sync(() => state))
  yield* handle(IPC.updateCheck, AnyArgs, () => check)
  yield* handle(IPC.updateInstall, AnyArgs, () => installInScope)
  if (ENABLED) yield* Effect.forkScoped(Effect.repeat(check, Schedule.spaced(EVERY)))
})
