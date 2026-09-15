import { describe, expect, it } from 'vitest'
import { buildSchedulePayload, localDateTime, scheduleFormFromTask, scheduleValidationError } from '../../src/lib/scheduled-task-form'

describe('manual scheduled task form', () => {
  it('defaults to an editable daily schedule without AI parsing', () => {
    const form = scheduleFormFromTask()
    expect(form.scheduleType).toBe('daily')
    expect(scheduleValidationError(form)).toBeNull()
    expect(buildSchedulePayload(form)).toEqual({ scheduleType: 'daily', executeTime: '09:00' })
  })

  it.each(['once', 'interval', 'daily', 'weekly', 'monthly', 'cron'] as const)('roundtrips %s and strips inactive fields', (scheduleType) => {
    const form = scheduleFormFromTask({ scheduleType, executeAt: '2099-01-01T09:00:00.000Z', executeTime: '12:30', weekDays: [5, 1, 1], monthDay: 31, intervalValue: 2, intervalUnit: 'hour', cronExpression: '0 9 * * 1,3' })
    expect(scheduleValidationError(form)).toBeNull()
    const payload = buildSchedulePayload(form)
    expect(payload.scheduleType).toBe(scheduleType)
    if (scheduleType !== 'cron') expect(payload.cronExpression).toBeUndefined()
    if (scheduleType !== 'weekly') expect(payload.weekDays).toBeUndefined()
    else expect(payload.weekDays).toEqual([1, 5])
    if (scheduleType !== 'interval') expect(payload.intervalValue).toBeUndefined()
    if (scheduleType !== 'once' && scheduleType !== 'interval') expect(payload.executeAt).toBeUndefined()
  })

  it('hydrates historical intervals and singleton weekdays', () => {
    expect(scheduleFormFromTask({ scheduleType: 'interval', scheduleRule: '每隔 2 小时' })).toMatchObject({ intervalValue: '2', intervalUnit: 'hour' })
    expect(scheduleFormFromTask({ scheduleType: 'weekly', weekDay: 0 }).weekDays).toEqual([0])
    expect(scheduleFormFromTask({ scheduleType: 'weekly', weekDay: 0, weekDays: [1, 3] }).weekDays).toEqual([1, 3])
  })

  it('retains exact historical interval anchor when editing other fields', () => {
    const anchor = '2020-01-01T01:02:03.456Z'
    const form = scheduleFormFromTask({ scheduleType: 'interval', executeAt: anchor })
    expect(form.executeAt).toBe(localDateTime(anchor))
    expect(scheduleValidationError(form)).toBeNull()
    expect(buildSchedulePayload(form).executeAt).toBe(anchor)
    expect(scheduleValidationError({ ...form, executeAt: '2020-02-02T09:00' })).toBe('taskScheduleFutureError')
  })

  it.each(['0', '-1', '1.5', '', 'Infinity', '9007199254740991'])('rejects invalid interval %s', (intervalValue) => {
    const form = { ...scheduleFormFromTask(), scheduleType: 'interval' as const, intervalValue }
    expect(scheduleValidationError(form)).toBe('taskScheduleIntervalError')
  })

  it('rejects intervals whose anchor plus duration exceeds the Date range despite safe integer duration', () => {
    const form = { ...scheduleFormFromTask(), scheduleType: 'interval' as const, executeAt: '2099-01-01T09:00', intervalValue: '100000000', intervalUnit: 'day' as const }
    expect(Number.isSafeInteger(Number(form.intervalValue) * 86400000)).toBe(true)
    expect(scheduleValidationError(form)).toBe('taskScheduleIntervalError')
    expect(scheduleValidationError({ ...form, intervalValue: '30' })).toBeNull()
  })

  it('rejects missing weekdays, out-of-range days, times and past once schedules', () => {
    const form = scheduleFormFromTask()
    expect(scheduleValidationError({ ...form, scheduleType: 'weekly', weekDays: [] })).toBe('taskScheduleWeekError')
    expect(scheduleValidationError({ ...form, scheduleType: 'monthly', monthDay: '32' })).toBe('taskScheduleMonthError')
    expect(scheduleValidationError({ ...form, executeTime: '24:00' })).toBe('taskScheduleTimeError')
    expect(scheduleValidationError({ ...form, scheduleType: 'once', executeAt: '2020-01-01T00:00' })).toBe('taskScheduleFutureError')
  })

  it.each(['*/0 * * * *', '60 * * * *', '0 9 * * 5-1', '0 9 * * 1,no', '* * *', '0 9 * * 7', '*,1 * * * *', '0 9 * * 1,*'])('rejects malformed cron %s', (cronExpression) => {
    expect(scheduleValidationError({ ...scheduleFormFromTask(), scheduleType: 'cron', cronExpression })).toBe('taskScheduleCronError')
  })

  it.each(['0 9 * * 1,3,5', '*/15 * * * *', '5/10 * * * *', '0 9 * * 1-5'])('accepts cron %s', (cronExpression) => {
    expect(scheduleValidationError({ ...scheduleFormFromTask(), scheduleType: 'cron', cronExpression })).toBeNull()
  })
})
