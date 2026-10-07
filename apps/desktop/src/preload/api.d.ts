import type { Api, LocaleApi, ReminderApi, ReminderScreenApi, TelemetryApi, ThemeApi, UpdateApi } from '@mysticals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
    update: UpdateApi
    telemetry: TelemetryApi
    locale: LocaleApi
    reminders: ReminderApi
    reminderScreen: ReminderScreenApi
    appTheme: ThemeApi
  }
}
