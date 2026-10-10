import type { Api, ClockApi, LocaleApi, LogApi, ReminderApi, ReminderScreenApi, TelemetryApi, ThemeApi, UpdateApi } from '@mysticals/core/shared/ipc'

declare global {
  interface Window {
    api: Api
    update: UpdateApi
    telemetry: TelemetryApi
    locale: LocaleApi
    clock: ClockApi
    reminders: ReminderApi
    reminderScreen: ReminderScreenApi
    appTheme: ThemeApi
    logs: LogApi
  }
}
