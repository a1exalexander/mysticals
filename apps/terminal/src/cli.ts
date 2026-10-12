#!/usr/bin/env node
import { createElement } from 'react'
import { render } from 'ink'
import { Cause, Effect, Fiber } from 'effect'
import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import { messageOf } from '@mysticals/core/errors'
import { version } from '../package.json'
import { connect } from './client'
import { runDaemon } from './daemon/server'
import { ApiContext } from './ui/hooks'
import { App } from './ui/App'
import { telemetry, TELEMETRY_NOTICE } from './telemetry'
import { checkUpdate } from './update'

const HELP = `mysticals ${version} — isolated multi-account calendar for the terminal

Usage: mysticals [--help | --version]

All open mysticals windows share one background daemon (accounts, sync, notifications);
it stops a few seconds after the last window closes.

Environment:
  MYSTICALS_HOME   data directory (default: mysticals-terminal in ~/Library/Application Support
                   on macOS, %APPDATA% on Windows, $XDG_DATA_HOME or ~/.local/share on Linux)
  MYSTICALS_MOCK=1 demo mode with fake accounts; nothing real is touched
                   (PowerShell: $env:MYSTICALS_MOCK=1; mysticals  cmd: set "MYSTICALS_MOCK=1" && mysticals)
  MYSTICALS_TELEMETRY=0 (or DO_NOT_TRACK=1) turns off the anonymous usage stats
                   (app installed, account added; no personal data)

Press ? inside the app for keys.`

let leaveScreen = (): void => {}

const main = (argv: string[]): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (argv.includes('--help') || argv.includes('-h')) return console.log(HELP)
    if (argv.includes('--version') || argv.includes('-v')) return console.log(version)
    if (argv.includes('--daemon')) return yield* runDaemon
    if (argv.length) {
      console.error(`Unknown argument: ${argv[0]}\n\n${HELP}`)
      process.exit(2)
    }

    // Before connect(): a daemon spawned by it would otherwise create the install id first and this run would miss the notice.
    // ponytail: a quit right after the first launch waits for app_installed (5 s cap, first run only).
    const notice = (yield* telemetry())?.installed ? TELEMETRY_NOTICE : undefined
    const api = yield* Effect.acquireRelease(connect(), (api) => Effect.sync(() => api.close()))
    // Interrupted on quit: a slow registry must not keep the process alive.
    const update = yield* Effect.forkChild(checkUpdate())
    if (process.stdin.isTTY && process.stdout.isTTY) {
      // Alternate screen (restores the shell on exit; the app is drawn from row 1 so mouse cells map to layout)
      // + mouse press/wheel reports in SGR encoding. Always undone on exit, or the shell fills with "[<0;…M" junk.
      process.stdout.write('\x1b[?1049h\x1b[H\x1b[?1000h\x1b[?1006h')
      leaveScreen = () => void process.stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l')
      process.on('exit', leaveScreen)
      process.on('SIGHUP', () => process.exit(0))
    }
    // Never rejects: an interrupted check (quit) would otherwise be an unhandled rejection in App's `.then`.
    const updateCheck = Effect.runPromise(Fiber.join(update).pipe(Effect.catchCause(() => Effect.undefined)))
    const app = render(createElement(ApiContext.Provider, { value: api }, createElement(App, { updateCheck, notice })))
    // Piped stdin (e.g. `echo | mysticals`): no keys; draw and quit when the input ends.
    if (!process.stdin.isTTY) process.stdin.on('end', () => app.unmount()).resume()
    // SIGINT/SIGTERM interrupt this wait (NodeRuntime.runMain); the scope then closes the connection and the app.
    yield* Effect.acquireUseRelease(
      Effect.succeed(app),
      (app) => Effect.promise(() => app.waitUntilExit()),
      (app) => Effect.sync(() => app.unmount())
    )
  }).pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer))

main(process.argv.slice(2)).pipe(
  Effect.catchCause((cause) =>
    Effect.sync(() => {
      if (Cause.hasInterruptsOnly(cause)) return // SIGINT/SIGTERM: everything was closed on the way out
      leaveScreen() // so the error lands in the shell, not the discarded alternate screen
      console.error(messageOf(Cause.squash(cause)))
      process.exit(1)
    })
  ),
  NodeRuntime.runMain({ disableErrorReporting: true })
)
