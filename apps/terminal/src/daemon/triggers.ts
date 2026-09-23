import type { Triggers } from '@multicals/core/sync/engine'

/** Fires after the Mac wakes from sleep: a 30 s tick that arrives > 60 s late means the clock jumped. */
export const wakeTriggers =
  (tickMs = 30_000, slackMs = 60_000): Triggers =>
  (fire) => {
    let last = Date.now()
    const timer = setInterval(() => {
      const now = Date.now()
      if (now - last > tickMs + slackMs) fire()
      last = now
    }, tickMs)
    timer.unref()
    return () => clearInterval(timer)
  }
