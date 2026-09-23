# multicals (terminal)

Multicals for the macOS terminal: one calendar view over several Google and CalDAV accounts that stay isolated from each other. It's a separate app from the desktop (Electron) Multicals, with its own accounts, settings and credentials, so you can run both on the same Mac.

## Install

```sh
npm i -g multicals
multicals
```

Needs macOS and Node.js 20 or newer. `multicals --help` lists options, `multicals --version` prints the version.

Try it without real accounts:

```sh
MULTICALS_MOCK=1 multicals
```

## Keys

| Key | Action |
| --- | --- |
| `a` `d` `2` `w` `m` | Agenda / Day / 2 Days / Week / Month view |
| `←` `→` (or `h` `l`) | Day, 2 Days, Week, Month: previous / next day, selecting its event closest to the same time. Agenda: previous / next event |
| `↑` `↓` | Day, 2 Days, Week: previous / next event of the selected day. Month: previous / next event in time order. Agenda: previous / next event |
| `j` `k` | Next / previous event in time order |
| `Shift` `←` `→` (or `H` `L`) | Previous / next page (moving past the edge of a page pages too) |
| `t` | Today |
| `enter` | Open the selected event |
| `n` | New event |
| `i` | Invitations (`y` accept, `n` decline, `m` maybe) |
| `s` | Accounts and calendars |
| `r` | Sync now |
| `?` | Help |
| `q` | Quit (`esc` or `q` closes an open panel first) |

The bottom bar has two rows. The first shows what's on now, the next event within 24 hours, the number of pending invites, and accounts whose last sync failed. The second has buttons for new, sync, invites, accounts, help and quit.

The agenda shows each day as a heading (relative day, event count, busy time) followed by two-line event cards: start and end time, a bar in the calendar's colour, the title with badges (`● now · ends in 25m`, `in 25m` for the next one today, `RSVP`, `maybe`, `declined`), and a detail line (account · calendar, `↻ repeats`, `⚠ overlaps`, place or `video call`, number of people). Days without events collapse into `free` rows.

Day, 2 Days and Week are time-grid tables: one row per hour, a column per day, all-day events on top. Events are blocks in their calendar's colour. The current time is red: the clock in the hour column, a red line through today's free cells, a red line between past and upcoming events in the agenda, and today's date in the month grid.

Colours come from your terminal theme: the app only uses the 16 ANSI colours and reverse video, and each calendar's colour is snapped to the nearest ANSI hue. `NO_COLOR=1` turns colours off.

### Mouse

Everything with a key also works with a click: view tabs, `‹ today ›`, the buttons in the bottom bar, the key buttons at the bottom of each panel, and the parts of the info row (now/next event, invites, failed sync). Click an event to select it and click it again to open it. Click a day heading to open that day, or a free cell of the time grid to create an event there. The scroll wheel moves the selection.

At 100 columns or wider, the agenda, day and 2 days views show the selected event (or the next one ahead) in a pane on the right.

multicals runs in the terminal's alternate screen with mouse reporting on, so a plain drag no longer selects text. Hold ⌥ Option while dragging (Shift in some terminals) to select and copy. In tmux, turn on `set -g mouse on` to pass clicks through.

## How it runs

The first `multicals` you open starts a small background daemon. It holds the accounts, syncs them and shows macOS notifications. Every other `multicals` window connects to the same daemon over a unix socket, so accounts are synced once, however many windows are open. The daemon stops about 3 seconds after the last window closes. Notifications only arrive while at least one window is open.

## Where data lives

| What | Where |
| --- | --- |
| Accounts, cache, settings | `~/Library/Application Support/multicals-terminal` |
| Daemon socket and log | `daemon.sock` and `daemon.log` in that folder |
| Credentials | Encrypted in that folder (AES-256-GCM). The key is in the macOS Keychain, item `multicals-terminal` |

The desktop app uses its own folder and Keychain item; the two never share data. Set `MULTICALS_HOME` to use another data folder (for example a second, independent profile). `MULTICALS_MOCK=1` uses a temporary folder with two fake accounts and touches nothing real.

## Troubleshooting

- **"Could not start the multicals daemon"**: read `daemon.log` in the data folder. A socket left behind by a crashed daemon is cleaned up automatically on the next start.
- **Daemon stuck**: close all `multicals` windows, then `pkill -f 'cli.js --daemon'` and start again.
- **Keychain prompt**: on first use macOS asks to allow access to the `multicals-terminal` Keychain item. Choose **Always Allow**. If you deny it, saved credentials can't be decrypted and accounts have to be added again.
- **Google sign-in not available**: the build had no Google OAuth client. See below.

## Development

From the repo root:

```sh
pnpm i
cp apps/terminal/.env.example apps/terminal/.env   # optional, for Google accounts
pnpm --filter multicals build                      # dist/cli.js
node apps/terminal/dist/cli.js                     # run it
MULTICALS_MOCK=1 node apps/terminal/dist/cli.js    # with fake accounts
pnpm --filter multicals dev                        # rebuild on change
pnpm --filter multicals test                       # unit, UI and daemon tests
pnpm --filter multicals typecheck
```

After a rebuild, close every window so the old daemon exits before you test the new one.

### Google OAuth client

Create a Google Cloud OAuth client of type **Desktop app** (steps in the [root README](../../README.md#google-oauth-client-for-google-accounts)) and put it in `apps/terminal/.env`:

```
MULTICALS_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
MULTICALS_GOOGLE_CLIENT_SECRET=...
```

The values are embedded into `dist/cli.js` at build time. The same variables set in the environment at runtime override them.

### Publish

```sh
cd apps/terminal
npm version patch
pnpm publish       # prepublishOnly builds dist/ first
```

Use `pnpm publish`, not `npm publish`: it rewrites the `workspace:` version of `@multicals/core`. Only `dist/` is published and core is bundled into it.
