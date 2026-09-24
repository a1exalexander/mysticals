import { defineConfig } from 'astro/config'
export default defineConfig({
  site: 'https://mysticals.sashkoratushnyi.com',
  redirects: { '/desktop': '/install', '/terminal': '/install#terminal' },
})
