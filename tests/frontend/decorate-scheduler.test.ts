import { describe, expect, it, vi } from 'vitest'
import { createChatDecorateScheduler } from '../../src/components/chat/panel-decoration/decorate-scheduler'

function createFrameQueue() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextHandle = 1
  return {
    requestFrame: (callback: FrameRequestCallback) => {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancelFrame: (handle: number) => {
      callbacks.delete(handle)
    },
    flush() {
      const pending = [...callbacks.values()]
      callbacks.clear()
      pending.forEach((callback) => callback(0))
    },
    size: () => callbacks.size,
  }
}

describe('createChatDecorateScheduler', () => {
  it('coalesces a streaming request and a full request into one full pass', () => {
    const frames = createFrameQueue()
    const run = vi.fn()
    const scheduler = createChatDecorateScheduler(run, frames.requestFrame, frames.cancelFrame)

    scheduler.schedule('streaming')
    scheduler.schedule('full')

    expect(frames.size()).toBe(1)
    frames.flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('full')
  })

  it('keeps a pending full pass when a streaming request follows it', () => {
    const frames = createFrameQueue()
    const run = vi.fn()
    const scheduler = createChatDecorateScheduler(run, frames.requestFrame, frames.cancelFrame)

    scheduler.schedule('full')
    scheduler.schedule('streaming')

    frames.flush()
    expect(run).toHaveBeenCalledWith('full')
  })

  it('runs a streaming pass alone when no structural pass is pending', () => {
    const frames = createFrameQueue()
    const run = vi.fn()
    const scheduler = createChatDecorateScheduler(run, frames.requestFrame, frames.cancelFrame)

    scheduler.schedule('streaming')
    scheduler.schedule('streaming')

    expect(frames.size()).toBe(1)
    frames.flush()
    expect(run).toHaveBeenCalledWith('streaming')
  })

  it('schedules a fresh frame after the previous one ran', () => {
    const frames = createFrameQueue()
    const run = vi.fn()
    const scheduler = createChatDecorateScheduler(run, frames.requestFrame, frames.cancelFrame)

    scheduler.schedule('streaming')
    frames.flush()
    scheduler.schedule('full')
    frames.flush()

    expect(run.mock.calls).toEqual([['streaming'], ['full']])
  })

  it('drops the pending pass when cancelled', () => {
    const frames = createFrameQueue()
    const run = vi.fn()
    const scheduler = createChatDecorateScheduler(run, frames.requestFrame, frames.cancelFrame)

    scheduler.schedule('streaming')
    scheduler.cancel()
    frames.flush()

    expect(run).not.toHaveBeenCalled()
    expect(frames.size()).toBe(0)
  })
})
