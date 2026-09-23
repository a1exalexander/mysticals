import { useCalendarData } from '../../hooks/useCalendarData'

/** Accounts + calendars, reloaded whenever any account's data changes. */
export const useDirectory = (): ReturnType<typeof useCalendarData> => useCalendarData()
