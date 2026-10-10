import { describe, expect, it } from 'vitest'

import { isResizeObserverLoopError } from '../../src/lib/error-noise'

describe('isResizeObserverLoopError', () => {
  it.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
    'Uncaught ResizeObserver loop completed with undelivered notifications.',
  ])('匹配 ResizeObserver loop 消息字符串: %s', (message) => {
    expect(isResizeObserverLoopError(message)).toBe(true)
  })

  it('匹配 message 携带该文案的 Error 实例', () => {
    expect(
      isResizeObserverLoopError(
        new Error('ResizeObserver loop completed with undelivered notifications.'),
      ),
    ).toBe(true)
  })

  it.each([
    'ResizeObserver is not defined',
    'Network error',
    '',
    new Error('unrelated failure'),
  ])('忽略无关错误: %s', (value) => {
    expect(isResizeObserverLoopError(value)).toBe(false)
  })

  it('忽略字符串/Error 之外的值（含带 message 字段的普通对象）', () => {
    expect(isResizeObserverLoopError(undefined)).toBe(false)
    expect(isResizeObserverLoopError(null)).toBe(false)
    expect(isResizeObserverLoopError(123)).toBe(false)
    expect(isResizeObserverLoopError({ message: 'ResizeObserver loop' })).toBe(false)
  })
})
