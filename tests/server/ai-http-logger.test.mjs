import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamSimple: vi.fn(),
}))

vi.mock('@earendil-works/pi-ai/compat', () => ({
  streamSimple: mocks.streamSimple,
}))

function hangingStream() {
  return {
    result: () => new Promise(() => {}),
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
      }
    },
  }
}

describe('AI stream deadline', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.streamSimple.mockReset()
    mocks.streamSimple.mockReturnValue(hangingStream())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('rejects result and aborts the provider signal at the deadline', async () => {
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { deadlineMs: 1000 },
    )
    const result = stream.result()
    const providerSignal = mocks.streamSimple.mock.calls[0][2].signal

    const rejection = expect(result).rejects.toThrow('AI stream timed out after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)

    await rejection
    expect(providerSignal.aborted).toBe(true)
  })

  it('rejects async iteration at the deadline', async () => {
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { deadlineMs: 1000 },
    )
    const next = stream[Symbol.asyncIterator]().next()

    const rejection = expect(next).rejects.toThrow('AI stream timed out after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)

    await rejection
  })
})
