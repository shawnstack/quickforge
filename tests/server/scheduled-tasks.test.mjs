import { describe, it, expect } from 'vitest'
import {
  cronMatches,
  isValidCronExpression,
  normalizeInterval,
  nextIntervalRun,
  normalizeWeekDays,
  nextWeeklyDaysRun,
  nextCronRun,
  nextDailyRun,
  nextMonthlyRun,
  nextWeeklyRun,
  normalizeExecutionMode,
  parseExecuteTime,
} from '../../server/utils/scheduled-tasks.mjs'

function parts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hours: date.getHours(),
    minutes: date.getMinutes(),
  }
}

describe('scheduled task scheduling utilities', () => {
  it.each([['minute', 60000], ['hour', 3600000], ['day', 86400000]])('anchors %s intervals and skips missed slots', (intervalUnit, unitMs) => {
    const executeAt = '2026-01-01T00:00:00.000Z'
    const task = { executeAt, intervalValue: 2, intervalUnit }
    const anchor = new Date(executeAt).getTime()
    expect(nextIntervalRun(task, new Date(anchor - 1)).getTime()).toBe(anchor)
    expect(nextIntervalRun(task, new Date(anchor)).getTime()).toBe(anchor + 2 * unitMs)
    expect(nextIntervalRun(task, new Date(anchor + 5 * unitMs)).getTime()).toBe(anchor + 6 * unitMs)
  })

  it('uses structured intervals before legacy rules and supports historical rules', () => {
    expect(normalizeInterval({ scheduleRule: '每隔 2 小时' })).toMatchObject({ intervalValue: 2, intervalUnit: 'hour' })
    expect(normalizeInterval({ scheduleRule: '每隔 2 小时', intervalValue: 3, intervalUnit: 'day' })).toMatchObject({ intervalValue: 3, intervalUnit: 'day' })
  })

  it.each([0, -1, 1.5, Infinity, NaN, '2', Number.MAX_SAFE_INTEGER])('rejects invalid interval value %s', (intervalValue) => {
    expect(() => normalizeInterval({ intervalValue, intervalUnit: 'minute' })).toThrow('intervalValue')
  })

  it('rejects unsupported interval units and date overflow', () => {
    expect(() => normalizeInterval({ intervalValue: 1, intervalUnit: 'second' })).toThrow('intervalUnit')
    expect(() => nextIntervalRun({ intervalValue: 100000000000, intervalUnit: 'minute', executeAt: 'bad' })).toThrow('executeAt')
    expect(() => nextIntervalRun({ intervalValue: 100000000000, intervalUnit: 'minute', executeAt: '+200000-01-01T00:00:00.000Z' }, new Date('+200000-01-01T00:00:00.000Z'))).toThrow('out of range')
  })

  it('rejects interval overflow even before a valid future anchor is reached', () => {
    const executeAt = '2026-01-02T00:00:00.000Z'
    expect(() => nextIntervalRun({ intervalValue: 150000000000, intervalUnit: 'minute', executeAt }, new Date('2026-01-01T00:00:00.000Z'))).toThrow('interval is out of range')
  })

  it('normalizes weekdays and picks the nearest selected future slot', () => {
    expect(normalizeWeekDays([5, 1, 5])).toEqual([1, 5])
    expect(parts(nextWeeklyDaysRun([1, 3, 5], '09:00', new Date(2026, 0, 5, 10)))).toMatchObject({ day: 7, hours: 9 })
    expect(parts(nextWeeklyDaysRun([0], '09:00', new Date(2026, 0, 5, 10)))).toMatchObject({ day: 11, hours: 9 })
  })

  it.each([[], [7], [-1], [1.5], ['1'], null])('rejects invalid weekDays %j', (weekDays) => {
    expect(() => normalizeWeekDays(weekDays)).toThrow('weekDays')
  })

  it.each(['60 * * * *', '0 9 * * 1,bad', '0 9 * * 5-1', '0 9 * * 0-7', '0 9 * * 1,7', '*/0 * * * *'])('rejects invalid new cron without partial matching: %s', (cron) => {
    expect(isValidCronExpression(cron)).toBe(false)
  })

  it.each(['0 9 * * 0-7', '0 9 * * 1,7', '0 9 * * 1,bad'])('preserves historical cron matching at runtime: %s', (cron) => {
    const monday = new Date(2026, 0, 5, 9)
    expect(cronMatches(monday, cron)).toBe(true)
    expect(nextCronRun(cron, new Date(2026, 0, 5, 8))).toEqual(monday)
  })

  it.each(['0 9 * * 1,3', '5/10 * * * *', '*/15 * * * *', '0 9 * * 0-6'])('accepts supported new cron: %s', (cron) => {
    expect(isValidCronExpression(cron)).toBe(true)
  })

  it('supports cron lists and numeric-start steps', () => {
    expect(cronMatches(new Date(2026, 0, 5, 9, 0), '0 9 * * 1,3')).toBe(true)
    expect(cronMatches(new Date(2026, 0, 5, 9, 15), '5/10 * * * *')).toBe(true)
  })

  describe('normalizeExecutionMode', () => {
    it('defaults to serial and accepts known modes', () => {
      expect(normalizeExecutionMode()).toBe('serial')
      expect(normalizeExecutionMode(null)).toBe('serial')
      expect(normalizeExecutionMode('')).toBe('serial')
      expect(normalizeExecutionMode('serial')).toBe('serial')
      expect(normalizeExecutionMode('parallel')).toBe('parallel')
    })

    it('rejects unsupported modes', () => {
      expect(() => normalizeExecutionMode('fast')).toThrow('executionMode must be serial or parallel')
    })
  })

  describe('parseExecuteTime', () => {
    it('normalizes HH:mm values', () => {
      expect(parseExecuteTime('9:05')).toBe('09:05')
      expect(parseExecuteTime('23:59')).toBe('23:59')
    })

    it('rejects malformed or out-of-range values', () => {
      expect(() => parseExecuteTime('9:5')).toThrow('executeTime must use HH:mm format')
      expect(() => parseExecuteTime('24:00')).toThrow('executeTime is out of range')
      expect(() => parseExecuteTime('12:60')).toThrow('executeTime is out of range')
    })
  })

  describe('nextDailyRun', () => {
    it('uses today when the execute time is still ahead', () => {
      const base = new Date(2026, 0, 2, 10, 0)
      expect(parts(nextDailyRun('10:30', base))).toEqual({
        year: 2026,
        month: 0,
        day: 2,
        hours: 10,
        minutes: 30,
      })
    })

    it('rolls to tomorrow when the execute time has passed', () => {
      const base = new Date(2026, 0, 2, 10, 0)
      expect(parts(nextDailyRun('09:00', base))).toEqual({
        year: 2026,
        month: 0,
        day: 3,
        hours: 9,
        minutes: 0,
      })
    })
  })

  describe('nextWeeklyRun', () => {
    it('rolls same-day past times to the next week', () => {
      const base = new Date(2026, 0, 5, 10, 0)
      const next = nextWeeklyRun(base.getDay(), '09:00', base)
      expect(parts(next)).toEqual({
        year: 2026,
        month: 0,
        day: 12,
        hours: 9,
        minutes: 0,
      })
    })

    it('uses the upcoming target weekday', () => {
      const base = new Date(2026, 0, 5, 10, 0)
      const next = nextWeeklyRun((base.getDay() + 1) % 7, '09:00', base)
      expect(parts(next)).toEqual({
        year: 2026,
        month: 0,
        day: 6,
        hours: 9,
        minutes: 0,
      })
    })

    it('rejects invalid weekdays', () => {
      expect(() => nextWeeklyRun(7, '09:00', new Date(2026, 0, 5, 10, 0))).toThrow('weekDay must be between 0 and 6')
    })
  })

  describe('nextMonthlyRun', () => {
    it('uses the current month when the monthly candidate is still ahead', () => {
      const base = new Date(2026, 0, 30, 10, 0)
      expect(parts(nextMonthlyRun(31, '09:00', base))).toEqual({
        year: 2026,
        month: 0,
        day: 31,
        hours: 9,
        minutes: 0,
      })
    })

    it('clamps overflowing month days in the next month', () => {
      const base = new Date(2026, 0, 31, 10, 0)
      expect(parts(nextMonthlyRun(31, '09:00', base))).toEqual({
        year: 2026,
        month: 1,
        day: 28,
        hours: 9,
        minutes: 0,
      })
    })

    it('rejects invalid month days', () => {
      expect(() => nextMonthlyRun(0, '09:00', new Date(2026, 0, 1))).toThrow('monthDay must be between 1 and 31')
    })
  })

  describe('cronMatches', () => {
    it('matches step and fixed-time expressions', () => {
      const date = new Date(2026, 0, 1, 10, 30)
      expect(cronMatches(date, '*/15 * * * *')).toBe(true)
      expect(cronMatches(date, '*/20 * * * *')).toBe(false)
      expect(cronMatches(date, '30 10 * * *')).toBe(true)
    })

    it('rejects zero step expressions without hanging', () => {
      const date = new Date(2026, 0, 1, 10, 30)
      expect(cronMatches(date, '*/0 * * * *')).toBe(false)
      expect(cronMatches(date, '*/00 * * * *')).toBe(false)
      expect(nextCronRun('*/0 * * * *', date)).toBeNull()
    })

    it('returns false for malformed expressions', () => {
      expect(cronMatches(new Date(2026, 0, 1, 10, 30), '* * *')).toBe(false)
    })
  })

  describe('nextCronRun', () => {
    it('finds the next matching minute for step expressions', () => {
      const next = nextCronRun('*/15 * * * *', new Date(2026, 0, 1, 10, 1, 30))
      expect(parts(next)).toEqual({
        year: 2026,
        month: 0,
        day: 1,
        hours: 10,
        minutes: 15,
      })
    })

    it('finds the next matching fixed time', () => {
      const next = nextCronRun('0 11 * * *', new Date(2026, 0, 1, 10, 59, 30))
      expect(parts(next)).toEqual({
        year: 2026,
        month: 0,
        day: 1,
        hours: 11,
        minutes: 0,
      })
    })
  })
})
