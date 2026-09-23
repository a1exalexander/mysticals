import { existsSync, readFileSync } from 'fs'
import { parseEnv } from 'util'
import { defineConfig } from 'tsup'

// Google OAuth client baked into dist/cli.js: build env wins over apps/terminal/.env; both are optional.
const file = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}
const env = (k: string): string => JSON.stringify(process.env[k] || file[k] || '')

// Core is TS source and gets bundled; third-party deps stay external (they are `dependencies`).
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  noExternal: ['@multicals/core'],
  define: {
    __GOOGLE_CLIENT_ID__: env('MULTICALS_GOOGLE_CLIENT_ID'),
    __GOOGLE_CLIENT_SECRET__: env('MULTICALS_GOOGLE_CLIENT_SECRET')
  },
  clean: true
})
