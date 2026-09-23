# Multicals

A simple macOS calendar for Google and CalDAV accounts (Namecheap Private Email, iCloud, Fastmail, any CalDAV server). Built with Electron, TypeScript and React. You add accounts inside the app. It never reads the macOS Calendar database.

## Repo layout

Turborepo + pnpm workspace. Apps live in `apps/*`, shared code will go to `packages/*`.

- `apps/desktop` — the Electron app (package name `multicals`; don't rename it, Electron derives the user-data folder with accounts from it).

## Why isolation matters

In a shared calendar app, one broken account can quietly make another account the organizer: coworkers start getting invites to work meetings from your personal Gmail. Multicals doesn't allow that:

- There is no default account or calendar. Every new event needs an explicit account and calendar.
- Events are never copied, moved or re-created across accounts.
- RSVPs go out only through the account that received the invite.
- Each account has its own provider, encrypted credentials (Electron `safeStorage`, one file per account), cache and sync loop.
- Attendees are never added automatically. The organizer is always the chosen account itself.

## Setup

```sh
pnpm i
# if apps/desktop/node_modules/electron/dist is missing afterwards:
node apps/desktop/node_modules/electron/install.js
cp apps/desktop/.env.example apps/desktop/.env
```

### Google OAuth client (for Google accounts)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and your email, and add yourself as a test user.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, application type **Desktop app**.
5. Put the values in `apps/desktop/.env`:

   ```
   MAIN_VITE_GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   MAIN_VITE_GOOGLE_CLIENT_SECRET=...
   ```

   A Desktop-app client secret isn't really confidential, but keep `.env` out of git anyway.

## Run

```sh
pnpm dev                  # development with hot reload
MULTICALS_MOCK=1 pnpm dev # two fake isolated accounts, no network
pnpm test                 # unit tests
pnpm e2e                  # Playwright smoke tests (mock mode)
pnpm dist                 # unsigned .dmg (arm64 + x64) in apps/desktop/dist/
```

The build is unsigned (`identity: null` in `apps/desktop/electron-builder.yml`). On first launch, right-click the app and choose **Open**. That file also explains how to sign and notarize.

## Adding Namecheap Private Email (CalDAV)

1. In Private Email webmail, create an **application password** for the mailbox. You need one if 2FA is on, and it's a good idea anyway.
2. In Multicals: **Add calendar → CalDAV**, preset **Namecheap Private Email**. The server URL `https://dav.privateemail.com/dav.php/` is filled in for you. It matches the SabreDAV root shown in Private Email → Configuration details → CalDAV ([Namecheap docs](https://www.namecheap.com/support/knowledgebase/subcategory/2260/private-email-contacts-and-calendars-setup/)).
3. Enter your full email address as the username, paste the app password, and pick a label and colour.

iCloud (`https://caldav.icloud.com/`, app-specific password from appleid.apple.com) and Fastmail (`https://caldav.fastmail.com/`, app password from Settings → Privacy & Security) work the same way. For any other server, choose **Custom**.
