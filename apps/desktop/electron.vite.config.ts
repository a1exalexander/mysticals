import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @mysticals/core is a devDependency, so it gets bundled; its runtime deps are in `dependencies` and stay external.
const shared = { '@shared': resolve('../../packages/core/src/shared') }

export default defineConfig({
  // Google OAuth client and PostHog key from the repo-root .env (shared with apps/terminal), exposed to main via import.meta.env.
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    envDir: resolve('../..'),
    envPrefix: ['MYSTICALS_GOOGLE_', 'MYSTICALS_POSTHOG_']
  },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
