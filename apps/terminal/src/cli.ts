#!/usr/bin/env node
import { createElement } from 'react'
import { render } from 'ink'
import { version } from '../package.json'
import { connect } from './client'
import { runDaemon } from './daemon/server'
import { ApiContext } from './ui/hooks'
import { App } from './ui/App'
import { checkUpdate } from './update'

const HELP = `mysticals ${version} — isolated multi-account calendar for the terminal

Usage: mysticals [--help | --version]

All open mysticals windows share one background daemon (accounts, sync, notifications);
it stops a few seconds after the last window closes.

Environment:
  MYSTICALS_HOME   data directory (default: ~/Library/Application Support/mysticals-terminal)
  MYSTICALS_MOCK=1 demo mode with fake accounts; nothing real is touched

Press ? inside the app for keys.`

let leaveScreen = (): void => {}

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) return void console.log(HELP)
  if (argv.includes('--version') || argv.includes('-v')) return void console.log(version)
  if (argv.includes('--daemon')) return runDaemon()
  if (argv.length) {
    console.error(`Unknown argument: ${argv[0]}\n\n${HELP}`)
    process.exit(2)
  }

  const api = await connect()
  const stopUpdate = new AbortController() // a slow registry must not keep the process alive after quit
  if (process.stdin.isTTY && process.stdout.isTTY) {
    // Alternate screen (restores the shell on exit; the app is drawn from row 1 so mouse cells map to layout)
    // + mouse press/wheel reports in SGR encoding. Always undone on exit, or the shell fills with "[<0;…M" junk.
    process.stdout.write('\x1b[?1049h\x1b[H\x1b[?1000h\x1b[?1006h')
    leaveScreen = () => void process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l')
    process.on('exit', leaveScreen)
    for (const s of ['SIGTERM', 'SIGHUP'] as const) process.on(s, () => process.exit(0))
  }
  const app = render(createElement(ApiContext.Provider, { value: api }, createElement(App, { updateCheck: checkUpdate(stopUpdate.signal) })))
  // Piped stdin (e.g. `echo | mysticals`): no keys; draw and quit when the input ends.
  if (!process.stdin.isTTY) process.stdin.on('end', () => app.unmount()).resume()
  await app.waitUntilExit()
  stopUpdate.abort()
  api.close()
}

main(process.argv.slice(2)).catch((e: unknown) => {
  leaveScreen() // so the error lands in the shell, not the discarded alternate screen
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
