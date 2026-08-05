import { describe, expect, it, vi } from 'vitest'
import { scheduleAfterPaint } from '../../src/lib/schedule-after-paint'

describe('scheduleAfterPaint', () => {
  it('waits for a full paint opportunity before running', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId
      callbacks.set(frameId, callback)
      return frameId
    })
    const cancelFrame = vi.fn((frameId: number) => callbacks.delete(frameId))
    const callback = vi.fn()

    scheduleAfterPaint(callback, requestFrame, cancelFrame)

    expect(callback).not.toHaveBeenCalled()
    callbacks.get(1)?.(0)
    expect(callback).not.toHaveBeenCalled()
    callbacks.get(2)?.(16)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('cancels the pending callback', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    const requestFrame = (callback: FrameRequestCallback) => {
      const frameId = ++nextFrameId
      callbacks.set(frameId, callback)
      return frameId
    }
    const cancelFrame = vi.fn((frameId: number) => callbacks.delete(frameId))
    const callback = vi.fn()

    const cancel = scheduleAfterPaint(callback, requestFrame, cancelFrame)
    callbacks.get(1)?.(0)
    cancel()
    callbacks.get(2)?.(16)

    expect(cancelFrame).toHaveBeenCalledWith(2)
    expect(callback).not.toHaveBeenCalled()
  })
})
