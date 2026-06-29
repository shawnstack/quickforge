export const minuteMs = 60 * 1000
export const hourMs = 60 * minuteMs
export const dayMs = 24 * hourMs

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function pad(value) {
  return String(value).padStart(2, '0')
}

export function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function timeFromDate(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return undefined
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function normalizeExecutionMode(value) {
  if (value === undefined || value === null || value === '') return 'serial'
  const mode = String(value)
  if (mode === 'serial' || mode === 'parallel') return mode
  throw requestError('executionMode must be serial or parallel')
}

export function parseExecuteTime(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) throw requestError('executeTime must use HH:mm format')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw requestError('executeTime is out of range')
  }
  return `${pad(hours)}:${pad(minutes)}`
}

function dateWithTime(base, executeTime) {
  const [hours, minutes] = parseExecuteTime(executeTime).split(':').map(Number)
  const date = new Date(base)
  date.setHours(hours, minutes, 0, 0)
  return date
}

export function nextDailyRun(executeTime, base = new Date()) {
  const next = dateWithTime(base, executeTime)
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1)
  return next
}

export function nextWeeklyRun(weekDay, executeTime, base = new Date()) {
  const targetDay = Number(weekDay)
  if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 6) {
    throw requestError('weekDay must be between 0 and 6')
  }
  const next = dateWithTime(base, executeTime)
  let daysToAdd = (targetDay - next.getDay() + 7) % 7
  if (daysToAdd === 0 && next.getTime() <= base.getTime()) daysToAdd = 7
  next.setDate(next.getDate() + daysToAdd)
  return next
}

function monthlyCandidate(year, month, monthDay, executeTime) {
  const targetDay = Number(monthDay)
  if (!Number.isInteger(targetDay) || targetDay < 1 || targetDay > 31) {
    throw requestError('monthDay must be between 1 and 31')
  }
  const [hours, minutes] = parseExecuteTime(executeTime).split(':').map(Number)
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(targetDay, lastDay), hours, minutes, 0, 0)
}

export function nextMonthlyRun(monthDay, executeTime, base = new Date()) {
  let next = monthlyCandidate(base.getFullYear(), base.getMonth(), monthDay, executeTime)
  if (next.getTime() <= base.getTime()) {
    next = monthlyCandidate(base.getFullYear(), base.getMonth() + 1, monthDay, executeTime)
  }
  return next
}

function parseCronField(field, min, max) {
  if (field === '*') return { any: true, values: [] }
  const values = new Set()
  for (const part of field.split(',')) {
    if (/^\*\/\d+$/.test(part)) {
      const step = Number(part.slice(2))
      for (let value = min; value <= max; value += step) values.add(value)
    } else if (/^\d+-\d+$/.test(part)) {
      const [start, end] = part.split('-').map(Number)
      for (let value = Math.max(start, min); value <= Math.min(end, max); value += 1) values.add(value)
    } else if (/^\d+$/.test(part)) {
      const value = Number(part)
      if (value >= min && value <= max) values.add(value)
    }
  }
  return { any: false, values: [...values] }
}

export function cronMatches(date, cronExpression) {
  const fields = String(cronExpression || '').trim().split(/\s+/)
  if (fields.length !== 5) return false
  const checks = [
    [date.getMinutes(), parseCronField(fields[0], 0, 59)],
    [date.getHours(), parseCronField(fields[1], 0, 23)],
    [date.getDate(), parseCronField(fields[2], 1, 31)],
    [date.getMonth() + 1, parseCronField(fields[3], 1, 12)],
    [date.getDay(), parseCronField(fields[4], 0, 6)],
  ]
  return checks.every(([value, rule]) => rule.any || rule.values.includes(value))
}

export function nextCronRun(cronExpression, base = new Date()) {
  const cursor = new Date(base.getTime() + minuteMs)
  cursor.setSeconds(0, 0)
  const maxChecks = 366 * 24 * 60
  for (let index = 0; index < maxChecks; index += 1) {
    if (cronMatches(cursor, cronExpression)) return cursor
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}
