import { defineConfig } from '@playwright/test'

// Every spec launches the app with process.env: windows then open without activating it (see src/main/window.ts),
// so a run doesn't steal keyboard focus from whatever you're doing.
process.env.MYSTICALS_E2E = '1'

export default defineConfig({ testDir: 'e2e', timeout: 30_000, workers: 1 })
