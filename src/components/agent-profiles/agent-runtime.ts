export const DEFAULT_MAX_RUNTIME_MINUTES = 60
export const MIN_RUNTIME_MINUTES = 1000 / 60_000
export const MAX_RUNTIME_MINUTES = 60

const millisecondsPerMinute = 60_000
const minimumRuntimeMs = 1000

export function maxRuntimeMsToMinutes(maxRuntimeMs?: number) {
  const milliseconds = Number.isFinite(maxRuntimeMs) && Number(maxRuntimeMs) > 0
    ? Math.max(Math.round(Number(maxRuntimeMs)), minimumRuntimeMs)
    : DEFAULT_MAX_RUNTIME_MINUTES * millisecondsPerMinute
  return Number((milliseconds / millisecondsPerMinute).toFixed(6)).toString()
}

export function maxRuntimeMinutesToMs(maxRuntimeMinutes: string | number) {
  return Math.max(Math.round(Number(maxRuntimeMinutes) * millisecondsPerMinute), minimumRuntimeMs)
}

export function isMaxRuntimeMinutesValid(maxRuntimeMinutes: string | number) {
  const minutes = Number(maxRuntimeMinutes)
  return Number.isFinite(minutes) && minutes >= MIN_RUNTIME_MINUTES && minutes <= MAX_RUNTIME_MINUTES
}
