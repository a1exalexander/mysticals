import { BrowserWindow } from 'electron'
import { readPrefs } from './prefs'

export type ReminderSound = 'chime' | 'bell'

/** Settings > Notifications: a sound with each reminder, on by default. */
export const reminderSound = (): boolean => readPrefs().reminderSound !== false

// Plain JS for the page below: Web Audio struck tones (fundamental + partials, fast attack, exponential decay).
// chime: low glass tap for Banners. bell: soft bell over a low octave for the Full-screen reminder.
const SYNTH = `(kind) => {
  const ctx = new AudioContext()
  const out = ctx.createGain()
  out.gain.value = 0.5
  out.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.02
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
    }
  }
  if (kind === 'chime') tone(523.25, 0.6, 0.26, [[2.32, 0.18, 0.3], [4.25, 0.06, 0.15]])
  else {
    tone(392, 1.4, 0.16)
    tone(783.99, 1.3, 0.26, [[2.76, 0.25, 0.5], [5.4, 0.08, 0.25]])
  }
}`

/**
 * Plays a reminder sound unless turned off in Settings. Main has no audio and the main window may be closed (macOS),
 * so a hidden, script-only window plays it and is closed once the tone has faded.
 */
export function playSound(kind: ReminderSound): void {
  // Mock runs (e2e) count windows: no extra hidden one.
  if (!reminderSound() || process.env.MYSTICALS_MOCK === '1') return
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const html = `<!doctype html><script>(${SYNTH})(${JSON.stringify(kind)})</script>`
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((e) => console.error('reminder sound failed', e))
  setTimeout(() => w.isDestroyed() || w.destroy(), 3000)
}
