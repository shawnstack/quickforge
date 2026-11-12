import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSseUpdateThrottle,
  SSE_BACKPRESSURE_BYTES,
  SSE_MESSAGE_UPDATE_THROTTLE_MS,
  writeSseEvent,
  writeSseKeepAlive,
} from '../../server/routes/sse-transport.mjs'

/** 记录写入顺序的假 res；只实现 sse-transport 用到的两个成员。 */
function makeRes(writableLength = 0) {
  const frames = []
  return {
    frames,
    writableLength,
    write(chunk) {
      frames.push(chunk)
      return true
    },
  }
}

describe('createSseUpdateThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst of message_update frames and writes only the last one', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.push({ type: 'message_update', step: 1 })
    throttle.push({ type: 'message_update', step: 2 })
    throttle.push({ type: 'message_update', step: 3 })
    expect(written).toEqual([])

    vi.advanceTimersByTime(49)
    expect(written).toEqual([])

    vi.advanceTimersByTime(1)
    expect(written).toEqual([{ type: 'message_update', step: 3 }])
  })

  it('keeps both streaming slots and writes them in first-arrival order', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    // tool 先到、message 后到且交错——单槽实现会让后到者顶掉前者。
    throttle.push({ type: 'tool_execution_update', step: 1 })
    throttle.push({ type: 'message_update', step: 1 })
    throttle.push({ type: 'tool_execution_update', step: 2 })
    throttle.push({ type: 'message_update', step: 2 })

    vi.advanceTimersByTime(50)
    expect(written).toEqual([
      { type: 'tool_execution_update', step: 2 },
      { type: 'message_update', step: 2 },
    ])
  })

  it('flushes pending frames before a non-coalesced event and cancels the timer', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.push({ type: 'message_update', step: 1 })
    throttle.push({ type: 'message_update', step: 2 })
    throttle.push({ type: 'message_end', step: 3 })

    // 顺序保证：迟到帧不能让客户端先按终态清空容器再收到它。
    expect(written).toEqual([
      { type: 'message_update', step: 2 },
      { type: 'message_end', step: 3 },
    ])

    vi.advanceTimersByTime(1_000)
    expect(written).toHaveLength(2)
  })

  it('writes pending frames immediately on flush() and starts a fresh window afterwards', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.push({ type: 'message_update', step: 1 })
    throttle.push({ type: 'message_update', step: 2 })
    throttle.flush()
    expect(written).toEqual([{ type: 'message_update', step: 2 }])

    // 旧计时器已被丢弃，flush 后不会再多写一帧。
    vi.advanceTimersByTime(1_000)
    expect(written).toHaveLength(1)

    throttle.push({ type: 'message_update', step: 4 })
    vi.advanceTimersByTime(50)
    expect(written).toEqual([
      { type: 'message_update', step: 2 },
      { type: 'message_update', step: 4 },
    ])
  })

  it('is a no-op on flush() when nothing is pending', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.flush()
    throttle.push({ type: 'message_update', step: 1 })
    throttle.flush()
    throttle.flush()
    expect(written).toEqual([{ type: 'message_update', step: 1 }])
  })

  it('drops pending frames and the timer on dispose()', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.push({ type: 'message_update', step: 1 })
    throttle.push({ type: 'tool_execution_update', step: 1 })
    throttle.dispose()

    vi.advanceTimersByTime(1_000)
    expect(written).toEqual([])

    // dispose 之后再 push 仍能工作（计时器已重建）。
    throttle.push({ type: 'message_update', step: 2 })
    vi.advanceTimersByTime(50)
    expect(written).toEqual([{ type: 'message_update', step: 2 }])
  })

  it('passes non-coalesced events through even when they are the only frames', () => {
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event), windowMs: 50 })

    throttle.push({ type: 'agent_end', step: 1 })
    throttle.push({ type: 'state', step: 2 })
    throttle.push({ type: undefined })

    expect(written).toEqual([{ type: 'agent_end', step: 1 }, { type: 'state', step: 2 }, { type: undefined }])
  })

  it('defaults the window to the exported throttle constant', () => {
    expect(SSE_MESSAGE_UPDATE_THROTTLE_MS).toBeGreaterThan(0)
    const written = []
    const throttle = createSseUpdateThrottle({ write: (event) => written.push(event) })

    throttle.push({ type: 'message_update', step: 1 })
    vi.advanceTimersByTime(SSE_MESSAGE_UPDATE_THROTTLE_MS - 1)
    expect(written).toEqual([])
    vi.advanceTimersByTime(1)
    expect(written).toEqual([{ type: 'message_update', step: 1 }])
  })
})

describe('writeSseEvent', () => {
  it('writes id, event, one data line per payload line, then the blank terminator', () => {
    const res = makeRes()
    writeSseEvent(res, 'message_end', 'line one\nline two', 7)

    expect(res.frames).toEqual(['id: 7\n', 'event: message_end\n', 'data: line one\n', 'data: line two\n', '\n'])
  })

  it('omits the id line when the id is absent, zero or not an integer', () => {
    for (const id of [undefined, 0, -3, 1.5, '9']) {
      const res = makeRes()
      writeSseEvent(res, 'state', { ok: true }, id)
      expect(res.frames[0]).toBe('event: state\n')
    }
  })

  it('serializes object payloads as JSON and leaves strings untouched', () => {
    const objectRes = makeRes()
    writeSseEvent(objectRes, 'state', { a: 1 })
    expect(objectRes.frames).toEqual(['event: state\n', 'data: {"a":1}\n', '\n'])

    const stringRes = makeRes()
    writeSseEvent(stringRes, 'state', '{"a":1}')
    expect(stringRes.frames).toEqual(['event: state\n', 'data: {"a":1}\n', '\n'])
  })

  it('serializes null and primitives with JSON semantics', () => {
    const res = makeRes()
    writeSseEvent(res, 'state', null)
    writeSseEvent(res, 'state', 42)
    expect(res.frames).toEqual(['event: state\n', 'data: null\n', '\n', 'event: state\n', 'data: 42\n', '\n'])
  })

  it('produces identical output when the same frame object is written to two connections', () => {
    const event = { type: 'message_update', message: { role: 'assistant', content: [] } }
    const first = makeRes()
    const second = makeRes()
    writeSseEvent(first, 'message_update', event)
    writeSseEvent(second, 'message_update', event)
    // 序列化结果按对象身份共享，两连接写出的字节必须完全一致。
    expect(second.frames).toEqual(first.frames)
  })

  it('drops droppable streaming frames when the client is backpressured', () => {
    const res = makeRes(SSE_BACKPRESSURE_BYTES + 1)
    writeSseEvent(res, 'message_update', { step: 1 })
    writeSseEvent(res, 'tool_execution_update', { step: 1 })
    expect(res.frames).toEqual([])
  })

  it('never drops terminal or interactive frames under backpressure', () => {
    const res = makeRes(SSE_BACKPRESSURE_BYTES + 1)
    writeSseEvent(res, 'message_end', { step: 1 })
    writeSseEvent(res, 'error', { step: 2 })
    expect(res.frames).toContain('event: message_end\n')
    expect(res.frames).toContain('event: error\n')
  })

  it('still writes droppable frames right at the threshold (strictly greater triggers dropping)', () => {
    const res = makeRes(SSE_BACKPRESSURE_BYTES)
    writeSseEvent(res, 'message_update', { step: 1 })
    expect(res.frames).toEqual(['event: message_update\n', 'data: {"step":1}\n', '\n'])
  })

  it('writes everything when the response exposes no writableLength', () => {
    const frames = []
    writeSseEvent({ write: (chunk) => frames.push(chunk) }, 'message_update', { step: 1 })
    expect(frames).toEqual(['event: message_update\n', 'data: {"step":1}\n', '\n'])
  })
})

describe('writeSseKeepAlive', () => {
  it('writes a comment frame for a healthy connection', () => {
    const res = makeRes()
    writeSseKeepAlive(res)
    expect(res.frames).toEqual([': ping\n\n'])
  })

  it('skips the ping when the connection is backpressured', () => {
    const res = makeRes(SSE_BACKPRESSURE_BYTES + 1)
    writeSseKeepAlive(res)
    expect(res.frames).toEqual([])
  })

  it('writes the ping when writableLength is unavailable', () => {
    const frames = []
    writeSseKeepAlive({ write: (chunk) => frames.push(chunk) })
    expect(frames).toEqual([': ping\n\n'])
  })
})
