import type { Api, TelemetryApi, ThemeApi, UpdateApi } from '@mysticals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
    update: UpdateApi
    telemetry: TelemetryApi
    appTheme: ThemeApi
  }
}
