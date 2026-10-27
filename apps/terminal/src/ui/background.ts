/**
 * Is the terminal background light? Asked once at startup, before Ink takes stdin, so the theme can swap colours
 * that don't read on white (theme `setLightBackground`).
 *   1. OSC 11 ("\x1b]11;?") asks the terminal for its background colour; DA1 ("\x1b[c") right behind it is answered
 *      by practically every terminal, in order, so its reply ends the wait early when OSC 11 gets none.
 *   2. Else COLORFGBG ("fg;bg", set by rxvt, Konsole and others).
 *   3. Else, and when stdin/stdout isn't a TTY or NO_COLOR is set, dark: the colours as they always were.
 */

/**
 * A reply to the OSC 11 or DA1 query that arrives after the timeout must not reach the key handlers. Ink hands it over
 * in parts: "]", "11;rgb:…", "\\" (the ST) and the DA1 reply "[?62;22c". True for the payload and the DA1 reply; the
 * lone "]" and "\\" can't be told from typing and are bound to nothing (a reply lands within a second of launch,
 * before any text field can be open).
 */
export const isTerminalReply = (input: string): boolean => /^(\x1b?\])?11;rgba?:[\da-f/]*\x07?$|^\x1b?\[\?[\d;]*c$/i.test(input)

/** "rgb:RRRR/GGGG/BBBB" (1-4 hex digits per channel) in an OSC 11 reply, as 0..1 luminance. */
export function replyLuminance(reply: string): number | undefined {
  const m = /\]11;rgba?:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})/i.exec(reply)
  if (!m) return
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / (16 ** x.length - 1))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The decision: OSC 11 reply, else COLORFGBG (light unless the background is ANSI 0-6 or 8, as vim reads it), else dark. */
export function isLightBackground(reply: string, colorfgbg: string | undefined): boolean {
  const lum = replyLuminance(reply)
  if (lum !== undefined) return lum > 0.5
  const bg = colorfgbg?.split(';').at(-1)
  if (!bg || !/^\d+$/.test(bg)) return false
  const n = Number(bg)
  return !(n <= 6 || n === 8)
}

type In = Pick<NodeJS.ReadStream, 'isTTY' | 'isRaw' | 'setRawMode' | 'on' | 'off' | 'resume' | 'pause'>
type Out = Pick<NodeJS.WriteStream, 'isTTY' | 'write'>

/** Queries the terminal (at most `timeoutMs`), then puts stdin back as it was: raw mode, paused, no listener. */
export function detectLightBackground(
  stdin: In = process.stdin,
  stdout: Out = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 250
): Promise<boolean> {
  // NO_COLOR: no colours to pick; no TTY: nothing to ask and nothing drawn for a person
  if (env.NO_COLOR || !stdin.isTTY || !stdout.isTTY) return Promise.resolve(false)
  return new Promise((resolve) => {
    const wasRaw = !!stdin.isRaw
    let got = ''
    let finished = false
    const done = (): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      stdin.off('data', onData)
      stdin.pause()
      try {
        stdin.setRawMode(wasRaw)
      } catch {
        // a stdin that refused raw mode is still in its old mode
      }
      resolve(isLightBackground(got, env.COLORFGBG))
    }
    const onData = (chunk: Buffer | string): void => {
      got += String(chunk)
      if (/\x1b\[\?[\d;]*c/.test(got)) done() // DA1 answered: OSC 11, if supported, came before it
    }
    const timer = setTimeout(done, timeoutMs)
    try {
      stdin.setRawMode(true) // no echo of the reply, no line buffering
      stdin.on('data', onData)
      stdin.resume()
      stdout.write('\x1b]11;?\x07\x1b[c')
    } catch {
      done()
    }
  })
}
