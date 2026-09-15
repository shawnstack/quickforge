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

export function normalizeWeekDays(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((day) => typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6)) {
    throw requestError('weekDays must be a non-empty array of integers between 0 and 6')
  }
  return [...new Set(value)].sort((a, b) => a - b)
}

export function nextWeeklyDaysRun(weekDays, executeTime, base = new Date()) {
  return new Date(Math.min(...normalizeWeekDays(weekDays).map((day) => nextWeeklyRun(day, executeTime, base).getTime())))
}

export function normalizeInterval(task) {
  // Historical tasks only stored a Chinese rule. Explicit fields always take precedence.
  const legacy = String(task.scheduleRule || '').match(/每隔\s*(\d+)\s*(分钟|小时|天)/)
  const intervalValue = task.intervalValue !== undefined ? task.intervalValue : Number(legacy?.[1] ?? 30)
  const intervalUnit = task.intervalUnit !== undefined ? task.intervalUnit : ({ 分钟: 'minute', 小时: 'hour', 天: 'day' }[legacy?.[2]] || 'minute')
  const unitMs = { minute: minuteMs, hour: hourMs, day: dayMs }[intervalUnit]
  if (typeof intervalValue !== 'number' || !Number.isSafeInteger(intervalValue) || intervalValue <= 0 || !unitMs || !Number.isSafeInteger(intervalValue * unitMs)) {
    throw requestError('intervalValue must be a positive integer and intervalUnit must be minute, hour, or day')
  }
  return { intervalValue, intervalUnit, intervalMs: intervalValue * unitMs }
}

export function nextIntervalRun(task, base = new Date()) {
  const { intervalMs } = normalizeInterval(task)
  const anchor = new Date(task.executeAt ?? task.nextRunAt ?? base).getTime()
  if (!Number.isFinite(anchor)) throw requestError('executeAt is invalid')
  // A future anchor is not enough: the first recurring slot must also be representable.
  if (!Number.isFinite(new Date(anchor + intervalMs).getTime())) throw requestError('interval is out of range')
  const steps = anchor > base.getTime() ? 0 : Math.floor((base.getTime() - anchor) / intervalMs) + 1
  const next = new Date(anchor + steps * intervalMs)
  if (!Number.isFinite(next.getTime())) throw requestError('interval is out of range')
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

function parseCronField(field, min, max, strict) {
  if (field === '*') return { any: true, values: [] }
  const values = new Set()
  for (const part of field.split(',')) {
    if (/^\*\/\d+$/.test(part)) {
      const step = Number(part.slice(2))
      if (!Number.isInteger(step) || step <= 0) return null
      for (let value = min; value <= max; value += step) values.add(value)
    } else if (/^\d+\/\d+$/.test(part)) {
      const [start, step] = part.split('/').map(Number)
      if (start < min || start > max || !Number.isInteger(step) || step <= 0) return null
      for (let value = start; value <= max; value += step) values.add(value)
    } else if (/^\d+-\d+$/.test(part)) {
      const [start, end] = part.split('-').map(Number)
      if (strict && (start < min || end > max || start > end)) return null
      // Historical schedules clipped ranges (notably weekday 0-7) to the field bounds.
      for (let value = Math.max(start, min); value <= Math.min(end, max); value += 1) values.add(value)
    } else if (/^\d+$/.test(part)) {
      const value = Number(part)
      if (value >= min && value <= max) values.add(value)
      else if (strict) return null
    } else if (strict) return null
  }
  return values.size ? { any: false, values: [...values] } : null
}

function parseCronExpression(cronExpression, strict = false) {
  const fields = String(cronExpression || '').trim().split(/\s+/)
  if (fields.length !== 5) return null
  const rules = [
    parseCronField(fields[0], 0, 59, strict),
    parseCronField(fields[1], 0, 23, strict),
    parseCronField(fields[2], 1, 31, strict),
    parseCronField(fields[3], 1, 12, strict),
    parseCronField(fields[4], 0, 6, strict),
  ]
  return rules.every(Boolean) ? rules : null
}

// Validate new input strictly without changing execution of already persisted schedules.
export function isValidCronExpression(cronExpression) {
  return Boolean(parseCronExpression(cronExpression, true))
}

function cronRulesMatch(date, rules) {
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()]
  return rules.every((rule, index) => rule.any || rule.values.includes(values[index]))
}

export function cronMatches(date, cronExpression) {
  const rules = parseCronExpression(cronExpression)
  return rules ? cronRulesMatch(date, rules) : false
}

export function nextCronRun(cronExpression, base = new Date()) {
  const rules = parseCronExpression(cronExpression)
  if (!rules) return null
  const cursor = new Date(base.getTime() + minuteMs)
  cursor.setSeconds(0, 0)
  const maxChecks = 366 * 24 * 60
  for (let index = 0; index < maxChecks; index += 1) {
    if (cronRulesMatch(cursor, rules)) return cursor
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}
