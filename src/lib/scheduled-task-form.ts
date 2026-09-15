import type { AppTextKey } from './i18n'

export type ScheduleType = 'once' | 'interval' | 'daily' | 'weekly' | 'monthly' | 'cron'
export type IntervalUnit = 'minute' | 'hour' | 'day'
export type ScheduleFields = {
  scheduleType: ScheduleType
  cronExpression?: string
  scheduleRule?: string
  nextRunAt?: string
  executeAt?: string
  executeTime?: string
  weekDays?: number[]
  weekDay?: number
  monthDay?: number
  intervalValue?: number
  intervalUnit?: IntervalUnit
}
export type ScheduleForm = {
  scheduleType: ScheduleType
  executeAt: string
  // Inactive date drafts are restored when switching back to once / interval.
  onceExecuteAt: string
  intervalExecuteAt: string
  executeTime: string
  weekDays: number[]
  monthDay: string
  intervalValue: string
  intervalUnit: IntervalUnit
  cronExpression: string
  // Allows an existing interval's original anchor to remain in the past when editing.
  originalExecuteAt: string
}

export function localDateTime(value?: string) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function scheduleFormFromTask(task?: ScheduleFields): ScheduleForm {
  const legacy = task?.scheduleRule?.match(/每隔\s*(\d+)\s*(分钟|小时|天)/)
  const executeAt = localDateTime(task?.executeAt ?? task?.nextRunAt)
  return {
    scheduleType: task?.scheduleType ?? 'daily',
    executeAt,
    onceExecuteAt: task?.scheduleType === 'once' ? executeAt : localDateTime(),
    intervalExecuteAt: task?.scheduleType === 'interval' ? executeAt : localDateTime(),
    originalExecuteAt: task?.scheduleType === 'interval' ? (task.executeAt ?? task.nextRunAt ?? '') : '',
    executeTime: task?.executeTime ?? (task?.nextRunAt ? localDateTime(task.nextRunAt).slice(11) : '09:00'),
    weekDays: task?.weekDays ?? [task?.weekDay ?? 1],
    monthDay: String(task?.monthDay ?? 1),
    intervalValue: String(task?.intervalValue ?? legacy?.[1] ?? 30),
    intervalUnit: task?.intervalUnit ?? (legacy?.[2] === '小时' ? 'hour' : legacy?.[2] === '天' ? 'day' : 'minute'),
    cronExpression: task?.cronExpression ?? '',
  }
}

export function scheduleValidationError(form: ScheduleForm, now = Date.now()): AppTextKey | null {
  if (form.scheduleType === 'once' || form.scheduleType === 'interval') {
    const timestamp = new Date(form.executeAt).getTime()
    if (!Number.isFinite(timestamp) || (timestamp <= now && !(form.scheduleType === 'interval' && form.originalExecuteAt && localDateTime(form.originalExecuteAt) === form.executeAt))) return 'taskScheduleFutureError'
  }
  if (form.scheduleType === 'interval') {
    const value = Number(form.intervalValue)
    const multiplier = { minute: 60000, hour: 3600000, day: 86400000 }[form.intervalUnit]
    const anchor = new Date(form.originalExecuteAt && localDateTime(form.originalExecuteAt) === form.executeAt ? form.originalExecuteAt : form.executeAt).getTime()
    if (!/^\d+$/.test(form.intervalValue) || value <= 0 || !Number.isSafeInteger(value * multiplier) || !Number.isFinite(new Date(anchor + value * multiplier).getTime())) return 'taskScheduleIntervalError'
  }
  if (['daily', 'weekly', 'monthly'].includes(form.scheduleType) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.executeTime)) return 'taskScheduleTimeError'
  if (form.scheduleType === 'weekly' && (!form.weekDays.length || form.weekDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) return 'taskScheduleWeekError'
  if (form.scheduleType === 'monthly' && (!/^\d+$/.test(form.monthDay) || Number(form.monthDay) < 1 || Number(form.monthDay) > 31)) return 'taskScheduleMonthError'
  if (form.scheduleType === 'cron' && !validCron(form.cronExpression)) return 'taskScheduleCronError'
  return null
}

function validCron(expression: string) {
  const fields = expression.trim().split(/\s+/)
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]
  return fields.length === 5 && fields.every((field, index) => field.split(',').every((part) => {
    const [min, max] = bounds[index]
    if (part === '*') return field === '*'
    const match = part.match(/^(\*|\d+)(?:([/-])(\d+))?$/)
    if (!match) return false
    const start = match[1] === '*' ? min : Number(match[1])
    if (start < min || start > max) return false
    if (!match[2]) return match[1] !== '*'
    const end = Number(match[3])
    return match[2] === '/' ? end > 0 : match[1] !== '*' && end >= start && end <= max
  }))
}

export function buildSchedulePayload(form: ScheduleForm): ScheduleFields {
  const scheduleType = form.scheduleType
  if (scheduleType === 'cron') return { scheduleType, cronExpression: form.cronExpression.trim(), scheduleRule: form.cronExpression.trim() }
  if (scheduleType === 'once' || scheduleType === 'interval') return {
    scheduleType,
    executeAt: new Date(scheduleType === 'interval' && form.originalExecuteAt && localDateTime(form.originalExecuteAt) === form.executeAt ? form.originalExecuteAt : form.executeAt).toISOString(),
    ...(scheduleType === 'interval' ? { intervalValue: Number(form.intervalValue), intervalUnit: form.intervalUnit } : {}),
  }
  return {
    scheduleType, executeTime: form.executeTime,
    ...(scheduleType === 'weekly' ? { weekDays: [...new Set(form.weekDays)].sort((a, b) => a - b) } : {}),
    ...(scheduleType === 'monthly' ? { monthDay: Number(form.monthDay) } : {}),
  }
}
