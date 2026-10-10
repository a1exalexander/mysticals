import { BrowserWindow } from 'electron'
import { readPrefs } from './prefs'

export type ReminderSound = 'chime' | 'bell'

/** Settings > Notifications: a sound with each reminder, on by default. */
export const reminderSound = (): boolean => readPrefs().reminderSound !== false

// Plain JS for the page below: Web Audio struck tones (fundamental + partials, fast attack, exponential decay).
// chime: low glass tap for Banners. bell: soft bell over a low octave for the Full-screen reminder. One AudioContext,
// suspended between tones; play() resolves once the tone has faded.
const PAGE = `
const ctx = new AudioContext()
void ctx.suspend()
const out = ctx.createGain()
out.gain.value = 0.5
out.connect(ctx.destination)
let playing = 0
async function play(kind) {
  playing++
  await ctx.resume()
  const t0 = ctx.currentTime + 0.02
  let end = 0
  let last
  const tone = (freq, dur, peak, partials = []) => {
    for (const [mult, rel, d] of [[1, 1, dur], ...partials]) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = freq * mult
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(peak * rel, t0 + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
      o.connect(g).connect(out)
      o.start(t0)
      o.stop(t0 + d + 0.05)
      if (d >= end) {
        end = d
        last = o
      }
    }
  }
  if (kind === 'chime') tone(523.25, 0.6, 0.26, [[2.32, 0.18, 0.3], [4.25, 0.06, 0.15]])
  else {
    tone(392, 1.4, 0.16)
    tone(783.99, 1.3, 0.26, [[2.76, 0.25, 0.5], [5.4, 0.08, 0.25]])
  }
  await new Promise((done) => (last.onended = done))
  if (!--playing) await ctx.suspend()
}`

/** How long each tone rings (ms), for mock runs that play nothing. */
const LENGTH: Record<ReminderSound, number> = { chime: 670, bell: 1470 }

let player: { win: BrowserWindow; loaded: Promise<boolean> } | undefined

/** The hidden, script-only window that plays the tones: main has no audio and the main window may be closed (macOS). */
function soundWindow(): NonNullable<typeof player> {
  if (player && !player.win.isDestroyed()) return player
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const html = `<!doctype html><script>${PAGE}</script>`
  // A page that failed to load is dropped; the next tone makes a new one.
  const loaded = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(
    () => true,
    (e) => {
      console.error('reminder sound failed', e)
      win.destroy()
      return false
    }
  )
  return (player = { win, loaded })
}

/** Opens the sound window right after startup, so the first tone needs no page load or audio warm-up. */
export function warmSound(): void {
  // Mock runs (e2e) count windows: no extra hidden one.
  if (process.env.MYSTICALS_MOCK !== '1') soundWindow()
}

/**
 * Plays a reminder sound unless turned off in Settings (`force`: the Settings test button plays it anyway). Resolves
 * once it has faded (mock runs just wait that long); never rejects.
 */
export async function playSound(kind: ReminderSound, force = false): Promise<void> {
  if (!force && !reminderSound()) return
  if (process.env.MYSTICALS_MOCK === '1') return new Promise((done) => setTimeout(done, LENGTH[kind]))
  const { win, loaded } = soundWindow()
  if (!(await loaded)) return
  await win.webContents.executeJavaScript(`play(${JSON.stringify(kind)})`).catch((e) => console.error('reminder sound failed', e))
}
