import type { Api } from '@multicals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
  }
}
