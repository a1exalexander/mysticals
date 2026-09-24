import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @mysticals/core is a devDependency, so it gets bundled; its runtime deps are in `dependencies` and stay external.
const shared = { '@shared': resolve('../../packages/core/src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared } },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react()]
  }
})
