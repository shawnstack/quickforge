import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  streamSimple: vi.fn(),
  resolveManagedCloudProvider: vi.fn(),
}))

vi.mock('../../server/cloud/runtime.mjs', () => ({
  resolveManagedCloudProvider: mocks.resolveManagedCloudProvider,
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

describe('AI HTTP log header sanitization', () => {
  it('redacts authentication and cookie headers case-insensitively', async () => {
    const { sanitizeHttpHeaders } = await import('../../server/ai-http-logger.mjs')
    expect(sanitizeHttpHeaders({
      Authorization: 'Bearer secret',
      'X-API-Key': 'secret-key',
      Cookie: 'session=secret',
      Accept: 'application/json',
    })).toEqual({
      Authorization: '[REDACTED]',
      'X-API-Key': '[REDACTED]',
      Cookie: '[REDACTED]',
      Accept: 'application/json',
    })
  })
})

describe('AI stream deadline', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.streamSimple.mockReset()
    mocks.resolveManagedCloudProvider.mockReset()
    mocks.streamSimple.mockReturnValue(hangingStream())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves managed cloud models lazily and ignores client-controlled transport fields', async () => {
    mocks.resolveManagedCloudProvider.mockResolvedValue({
      model: {
        id: 'qf-fast',
        provider: 'quickforge-cloud',
        api: 'openai-completions',
        baseUrl: 'https://cloud.example.com/v1',
      },
      apiKey: 'memory-access-token',
    })
    mocks.streamSimple.mockReturnValue({
      result: async () => ({ stopReason: 'stop' }),
      async *[Symbol.asyncIterator]() {},
    })
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging({
      id: 'qf-fast',
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'qf-fast',
      baseUrl: 'https://attacker.example/v1',
      headers: { Authorization: 'steal' },
    }, { systemPrompt: '', messages: [], tools: [] })

    await expect(stream.result()).resolves.toMatchObject({ stopReason: 'stop' })
    expect(mocks.resolveManagedCloudProvider).toHaveBeenCalledTimes(1)
    const [resolvedModel, , resolvedOptions] = mocks.streamSimple.mock.calls[0]
    expect(resolvedModel.baseUrl).toBe('https://cloud.example.com/v1')
    expect(resolvedModel.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
    expect(resolvedModel.headers).not.toHaveProperty('Authorization')
    expect(resolvedOptions.apiKey).toBe('memory-access-token')
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
