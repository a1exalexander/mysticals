#!/usr/bin/env node
import { createElement } from 'react'
import { render } from 'ink'
import { version } from '../package.json'
import { connect } from './client'
import { runDaemon } from './daemon/server'
import { ApiContext } from './ui/hooks'
import { App } from './ui/App'

const HELP = `multicals ${version} — isolated multi-account calendar for the terminal

Usage: multicals [--help | --version]

All open multicals windows share one background daemon (accounts, sync, notifications);
it stops a few seconds after the last window closes.

Environment:
  MULTICALS_HOME   data directory (default: ~/Library/Application Support/multicals-terminal)
  MULTICALS_MOCK=1 demo mode with fake accounts; nothing real is touched

Press ? inside the app for keys.`

async function main(argv: string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) return void console.log(HELP)
  if (argv.includes('--version') || argv.includes('-v')) return void console.log(version)
  if (argv.includes('--daemon')) return runDaemon()
  if (argv.length) {
    console.error(`Unknown argument: ${argv[0]}\n\n${HELP}`)
    process.exit(2)
  }

  const api = await connect()
  const app = render(createElement(ApiContext.Provider, { value: api }, createElement(App)))
  // Piped stdin (e.g. `echo | multicals`): no keys; draw and quit when the input ends.
  if (!process.stdin.isTTY) process.stdin.on('end', () => app.unmount()).resume()
  await app.waitUntilExit()
  api.close()
}

main(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
