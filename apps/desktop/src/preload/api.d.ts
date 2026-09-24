import type { Api } from '@mysticals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
  }
}
