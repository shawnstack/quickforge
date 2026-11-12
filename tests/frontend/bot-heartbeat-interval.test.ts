import { describe, expect, it } from 'vitest'
import {
  MIN_HEARTBEAT_MINUTES,
  heartbeatIntervalMinutes,
  splitHeartbeatInterval,
} from '../../src/components/bots/bots-data'

/**
 * 心跳间隔不再只有下拉框那五档：用户要能填任意分钟数。
 * 这两个纯函数是「数值 + 单位 → 分钟」的唯一入口，规则钉在这里：
 * 回显用能整除的最大单位，非法输入返回 null（不猜），低于下限向上夹紧（和服务端一致）。
 */
describe('heartbeat interval input', () => {
  it('splits a stored interval into the largest exact unit', () => {
    expect(splitHeartbeatInterval(1440)).toEqual({ amount: '1', unit: 'days' })
    expect(splitHeartbeatInterval(2880)).toEqual({ amount: '2', unit: 'days' })
    expect(splitHeartbeatInterval(120)).toEqual({ amount: '2', unit: 'hours' })
    expect(splitHeartbeatInterval(90)).toEqual({ amount: '90', unit: 'minutes' })
    expect(splitHeartbeatInterval(7)).toEqual({ amount: '7', unit: 'minutes' })
  })

  it('keeps an arbitrary interval instead of snapping it back to a preset', () => {
    expect(heartbeatIntervalMinutes('7', 'minutes')).toBe(7)
    expect(heartbeatIntervalMinutes('45', 'minutes')).toBe(45)
    expect(heartbeatIntervalMinutes('2', 'hours')).toBe(120)
    expect(heartbeatIntervalMinutes('3', 'days')).toBe(4320)
    expect(heartbeatIntervalMinutes(' 12 ', 'minutes')).toBe(12)
  })

  it('clamps up to the server minimum rather than rejecting a small value', () => {
    expect(heartbeatIntervalMinutes('1', 'minutes')).toBe(MIN_HEARTBEAT_MINUTES)
    expect(heartbeatIntervalMinutes(2, 'minutes')).toBe(MIN_HEARTBEAT_MINUTES)
  })

  it('returns null for input that cannot become an interval, so nothing is committed', () => {
    expect(heartbeatIntervalMinutes('', 'minutes')).toBeNull()
    expect(heartbeatIntervalMinutes('   ', 'minutes')).toBeNull()
    expect(heartbeatIntervalMinutes('abc', 'minutes')).toBeNull()
    expect(heartbeatIntervalMinutes(0, 'hours')).toBeNull()
    expect(heartbeatIntervalMinutes(-3, 'minutes')).toBeNull()
    expect(heartbeatIntervalMinutes(Number.NaN, 'minutes')).toBeNull()
  })

  it('round-trips through the display form', () => {
    for (const minutes of [5, 7, 15, 60, 90, 120, 1440, 2880]) {
      const { amount, unit } = splitHeartbeatInterval(minutes)
      expect(heartbeatIntervalMinutes(amount, unit)).toBe(minutes)
    }
  })
})
