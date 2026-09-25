import { existsSync } from 'node:fs'
import { defineConfig } from 'astro/config'

// MYSTICALS_POSTHOG_KEY may live in the monorepo-root .env; the shell env still wins
const rootEnv = new URL('../../.env', import.meta.url)
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

export default defineConfig({
  site: 'https://mysticals.sashkoratushnyi.com',
  trailingSlash: 'always',
  redirects: { '/desktop': '/install/', '/terminal': '/install/#terminal' },
})
