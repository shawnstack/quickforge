import { describe, it, expect } from 'vitest'
import {
  cronMatches,
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
