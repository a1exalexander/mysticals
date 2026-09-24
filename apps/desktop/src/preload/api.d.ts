import type { Api, TelemetryApi, UpdateApi } from '@mysticals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
    update: UpdateApi
    telemetry: TelemetryApi
  }
}
