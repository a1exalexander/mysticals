# Contributing

Thanks for helping. Bug reports, fixes and small features are welcome. For anything bigger, open an issue first so we can agree on the approach.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `docs: …`).

## Repo layout

Turborepo + pnpm workspace. Apps live in `apps/*`, shared code in `packages/*`.

- `packages/core` (`@mysticals/core`): platform-free core shared by both apps. Account store, providers (Google, CalDAV), sync engine, the validated API (`createApi`), mock backend and pure view logic. TypeScript source, bundled by each app.
- `apps/desktop` (`@mysticals/desktop`): the Electron app. Its `productName` in `package.json` is `mysticals`. Don't change it lightly: Electron derives the user-data folder with accounts (and the Keychain item) from it.
- `apps/terminal` (npm package `mysticals`): the terminal app (Ink). Every open `mysticals` shares one background daemon that stops a few seconds after the last one closes. Its data lives in a `mysticals-terminal` folder (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows, `$XDG_DATA_HOME` or `~/.local/share` on Linux), separate from the desktop app.
- `apps/landing` (`@mysticals/landing`): the Astro website.

Credentials are always encrypted. The desktop app uses Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, Secret Service on Linux; one file per account) and refuses to store credentials on Linux without a keyring. The terminal app keeps its key in the macOS Keychain or the Linux Secret Service (`secret-tool`), or seals it with Windows DPAPI.

## Setup

Needs Node.js 20.3+ and pnpm 10.

```sh
pnpm i
# if apps/desktop/node_modules/electron/dist is missing afterwards:
node apps/desktop/node_modules/electron/install.js
cp .env.example .env   # Windows (cmd): copy .env.example .env
```

### Google OAuth client (for Google accounts)

CalDAV and mock mode work without this.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add yourself as a test user.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Desktop app**.
5. Put the values in the repo-root `.env`. Both apps read it and embed the values at build time:

   ```
   MYSTICALS_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   MYSTICALS_GOOGLE_CLIENT_SECRET=...
   ```

   A Desktop-app client secret isn't really confidential, but keep `.env` out of git anyway.

## Run and test

```sh
pnpm dev                  # all apps in dev mode (desktop with hot reload)
MYSTICALS_MOCK=1 pnpm dev # two fake isolated accounts, no network
pnpm typecheck
pnpm test                 # unit tests
pnpm e2e                  # Playwright smoke tests of the desktop app (mock mode)
pnpm dist                 # unsigned installers for the current OS in apps/desktop/dist/
                          # (macOS .dmg/.zip, Windows setup .exe, Linux .AppImage/.deb)
```

On Windows, set the mock flag first: `$env:MYSTICALS_MOCK=1` (PowerShell) or `set MYSTICALS_MOCK=1` (cmd).

Run a single app with `pnpm --filter <name> <script>`, for example `pnpm --filter @mysticals/desktop dev` or `pnpm --filter @mysticals/landing dev`.

Builds are unsigned (`identity: null` in `apps/desktop/electron-builder.yml`).

### Terminal app

```sh
pnpm --filter mysticals build                   # apps/terminal/dist/cli.js
MYSTICALS_MOCK=1 node apps/terminal/dist/cli.js
pnpm --filter mysticals dev                     # rebuild on change
pnpm --filter mysticals test
```

## Releasing

A `v*` tag runs `.github/workflows/release.yml`. It builds the desktop app on macOS, Windows and Linux runners, attaches the `.dmg` and `.zip` (arm64 + x64), the Windows `-setup.exe` and the Linux `.AppImage` and `.deb` to one GitHub Release, and publishes the terminal app to npm.

1. Bump `version` in `apps/desktop/package.json` and `apps/terminal/package.json`. Both must match the tag, or the job fails.
2. Commit, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

Required repo secrets: `NPM_TOKEN`, `MYSTICALS_GOOGLE_CLIENT_ID`, `MYSTICALS_GOOGLE_CLIENT_SECRET` (one Desktop-app OAuth client shared by both apps).

Installed apps pick up the release on their own. On macOS the desktop app downloads the `.zip` for its architecture and updates itself. On Windows and Linux its update button opens the release page. The terminal app shows a hint to run `npm i -g mysticals`.
