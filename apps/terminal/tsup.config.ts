import { defineConfig } from 'tsup'

// Core is TS source and gets bundled; third-party deps stay external (they are `dependencies`).
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node20',
  noExternal: ['@multicals/core'],
  clean: true
})
