import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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

function controlledStream() {
  const queue = []
  const waiting = []
  let complete = false
  let finalResult
  let resolveResult
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve
  })

  const publish = (value) => {
    const waiter = waiting.shift()
    if (waiter) waiter({ value, done: false })
    else queue.push(value)
  }

  const finish = (result = { stopReason: 'stop' }) => {
    complete = true
    finalResult = result
    resolveResult(result)
    while (waiting.length > 0) waiting.shift()({ value: undefined, done: true })
  }

  return {
    publish,
    finish,
    stream: {
      result: () => resultPromise,
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
            if (complete) return Promise.resolve({ value: finalResult, done: true })
            return new Promise((resolve) => waiting.push(resolve))
          },
        }
      },
    },
  }
}

describe('AI HTTP log header sanitization', () => {
  it('redacts authentication, idempotency, and cookie headers case-insensitively', async () => {
    const { sanitizeHttpHeaders } = await import('../../server/ai-http-logger.mjs')
    expect(sanitizeHttpHeaders({
      Authorization: 'Bearer secret',
      'X-API-Key': 'secret-key',
      'Idempotency-Key': 'request-key',
      Cookie: 'session=secret',
      Accept: 'application/json',
    })).toEqual({
      Authorization: '[REDACTED]',
      'X-API-Key': '[REDACTED]',
      'Idempotency-Key': '[REDACTED]',
      Cookie: '[REDACTED]',
      Accept: 'application/json',
    })
  })
})

describe('AI stream deadline', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-ai-http-logger-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    vi.useFakeTimers()
    mocks.streamSimple.mockReset()
    mocks.resolveManagedCloudProvider.mockReset()
    mocks.streamSimple.mockReturnValue(controlledStream().stream)
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
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

  it('reuses the persisted Cloud key for the same logical message and separates different messages', async () => {
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
    const model = {
      id: 'qf-fast',
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'qf-fast',
    }
    const contextFor = (messageId) => ({
      systemPrompt: '',
      messages: [{
        role: 'user',
        content: 'hello',
        metadata: { quickforgeClientMessageId: messageId },
      }],
      tools: [],
    })
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')

    await streamSimpleWithAiHttpLogging(model, contextFor('qfcm-message-1'), { sessionId: 'session-1' }).result()
    await streamSimpleWithAiHttpLogging(model, contextFor('qfcm-message-1'), { sessionId: 'session-1' }).result()
    await streamSimpleWithAiHttpLogging(model, contextFor('qfcm-message-2'), { sessionId: 'session-1' }).result()

    const keys = mocks.streamSimple.mock.calls.map(([resolvedModel]) => resolvedModel.headers['Idempotency-Key'])
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('keeps non-Cloud provider headers unchanged', async () => {
    mocks.streamSimple.mockReturnValue({
      result: async () => ({ stopReason: 'stop' }),
      async *[Symbol.asyncIterator]() {},
    })
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    await streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model', headers: { 'X-Test': 'yes' } },
      { systemPrompt: '', messages: [{ role: 'user', content: 'hello' }], tools: [] },
      { sessionId: 'session-1' },
    ).result()

    expect(mocks.resolveManagedCloudProvider).not.toHaveBeenCalled()
    expect(mocks.streamSimple.mock.calls[0][0].headers).toEqual({ 'X-Test': 'yes' })
  })

  it('retries idle streams up to the cap, reports progress, then times out', async () => {
    const retryEvents = []
    mocks.streamSimple.mockImplementation(() => controlledStream().stream)
    const { streamSimpleWithAiHttpLogging, MAX_STREAM_RETRIES } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { deadlineMs: 1000, totalTimeoutMs: 60000, onStreamRetry: (info) => retryEvents.push(info) },
    )
    const result = stream.result()

    for (let i = 0; i < MAX_STREAM_RETRIES; i++) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(mocks.streamSimple).toHaveBeenCalledTimes(MAX_STREAM_RETRIES + 1)
    expect(retryEvents).toHaveLength(MAX_STREAM_RETRIES)
    expect(retryEvents[0]).toMatchObject({ attempt: 1, maxAttempts: MAX_STREAM_RETRIES })
    expect(retryEvents[MAX_STREAM_RETRIES - 1]).toMatchObject({ attempt: MAX_STREAM_RETRIES })

    const rejection = expect(result).rejects.toThrow('AI stream idle timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(retryEvents).toHaveLength(MAX_STREAM_RETRIES)
  })

  it('swallows the duplicate start from the retry and keeps publishing one stream', async () => {
    const first = controlledStream()
    const second = controlledStream()
    mocks.streamSimple.mockReturnValueOnce(first.stream).mockReturnValueOnce(second.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 10000 },
    )
    const result = stream.result()
    const iterator = stream[Symbol.asyncIterator]()

    first.publish({ type: 'start' })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'start' }, done: false })

    const firstSignal = mocks.streamSimple.mock.calls[0][2].signal
    await vi.advanceTimersByTimeAsync(1000)
    await Promise.resolve()
    expect(mocks.streamSimple).toHaveBeenCalledTimes(2)
    expect(firstSignal.aborted).toBe(true)
    expect(mocks.streamSimple.mock.calls[1][2].signal.aborted).toBe(false)

    // 重试流的 start 被吞掉，消费者从 text_delta 无缝续上。
    second.publish({ type: 'start' })
    second.publish({ type: 'text_delta', delta: 'hello' })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'text_delta', delta: 'hello' }, done: false })
    second.finish({ stopReason: 'stop' })
    await expect(result).resolves.toMatchObject({ stopReason: 'stop' })
  })

  it.each([
    ['text', { type: 'text_delta', delta: 'partial answer' }],
    ['thinking', { type: 'thinking_delta', delta: 'working' }],
    ['tool call', { type: 'toolcall_delta', delta: '{"name":"read_file"}' }],
  ])('does not retry after substantive %s output and fails on idle', async (_label, event) => {
    const retryEvents = []
    const first = controlledStream()
    mocks.streamSimple.mockReturnValueOnce(first.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 10000, onStreamRetry: (info) => retryEvents.push(info) },
    )
    const result = stream.result()
    const iterator = stream[Symbol.asyncIterator]()
    first.publish(event)
    await expect(iterator.next()).resolves.toMatchObject({ value: event, done: false })

    const rejection = expect(result).rejects.toThrow('AI stream idle timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(retryEvents).toHaveLength(0)
  })

  it('skips the idle retry when the parent signal is aborted', async () => {
    mocks.streamSimple.mockReturnValueOnce(controlledStream().stream)
    const controller = new AbortController()
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { deadlineMs: 1000, totalTimeoutMs: 10000, signal: controller.signal },
    )
    const result = stream.result()
    controller.abort()

    const rejection = expect(result).rejects.toThrow('AI stream idle timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('enforces the total timeout without retrying even before substantive output', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValue(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 5000, totalTimeoutMs: 1000 },
    )
    const result = stream.result()

    const rejection = expect(result).rejects.toThrow('AI stream total timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(1000)
    await rejection
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('applies the 90s first-event budget on the default path', async () => {
    mocks.streamSimple.mockImplementation(() => controlledStream().stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
    )
    stream.result()

    await vi.advanceTimersByTimeAsync(89_999)
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)

    // 默认路径零内容静默满 90s 才触发首事件档的第一次透明重试。
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.streamSimple).toHaveBeenCalledTimes(2)
  })

  it('applies the 180s post-content idle budget on the default path without retrying', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValueOnce(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
    )
    const result = stream.result()
    const rejection = expect(result).rejects.toThrow('AI stream idle timeout after 180000ms')
    const iterator = stream[Symbol.asyncIterator]()

    controlled.publish({ type: 'text_delta', delta: 'partial answer' })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'text_delta', delta: 'partial answer' },
      done: false,
    })

    await vi.advanceTimersByTimeAsync(179_999)
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(mocks.streamSimple.mock.calls[0][2].signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('uses a fresh idempotency key for the managed-cloud retry attempt', async () => {
    mocks.resolveManagedCloudProvider.mockResolvedValue({
      model: {
        id: 'qf-fast',
        provider: 'quickforge-cloud',
        api: 'openai-completions',
        baseUrl: 'https://cloud.example.com/v1',
      },
      apiKey: 'memory-access-token',
    })
    mocks.streamSimple.mockReturnValueOnce(controlledStream().stream).mockReturnValueOnce(controlledStream().stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const model = {
      id: 'qf-fast',
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
      quickforgeCatalogId: 'qf-fast',
    }
    // 不带 quickforgeClientMessageId：两次尝试都走随机幂等键路径，避免真实
    // fs 持久化让第一次链的完成时序在 fake timers 下不可控。
    const context = {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
    }
    const stream = streamSimpleWithAiHttpLogging(model, context, { sessionId: 'session-retry', idleTimeoutMs: 1000 })
    stream.result()

    await vi.advanceTimersByTimeAsync(1000)
    // lazyStream 的多级 promise 链在微任务里才真正调用 streamSimple。
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.streamSimple).toHaveBeenCalledTimes(2)
    const keys = mocks.streamSimple.mock.calls.map(([resolvedModel]) => resolvedModel.headers['Idempotency-Key'])
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('resets the post-content idle budget after each event, then fails without retrying', async () => {
    const first = controlledStream()
    mocks.streamSimple.mockReturnValueOnce(first.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 10000 },
    )
    const result = stream.result()
    const iterator = stream[Symbol.asyncIterator]()

    await vi.advanceTimersByTimeAsync(900)
    first.publish({ type: 'text_delta', delta: 'safe test event' })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await vi.advanceTimersByTimeAsync(900)
    expect(mocks.streamSimple.mock.calls[0][2].signal.aborted).toBe(false)

    const rejection = expect(result).rejects.toThrow('AI stream idle timeout after 1000ms')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
  })

  it('allows continuous output beyond the legacy five-minute deadline', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValue(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 5 * 60 * 1000, totalTimeoutMs: 20 * 60 * 1000 },
    )
    const result = stream.result()

    for (let elapsed = 0; elapsed < 6 * 60 * 1000; elapsed += 60 * 1000) {
      await vi.advanceTimersByTimeAsync(60 * 1000)
      controlled.publish({ type: 'text_delta', sequence: elapsed })
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(mocks.streamSimple.mock.calls[0][2].signal.aborted).toBe(false)
    controlled.finish({ stopReason: 'stop' })
    await expect(result).resolves.toMatchObject({ stopReason: 'stop' })
  })

  it('enforces the total timeout even while events keep resetting the idle timer', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValue(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 2500 },
    )
    const result = stream.result()
    const iterator = stream[Symbol.asyncIterator]()

    await vi.advanceTimersByTimeAsync(800)
    controlled.publish({ type: 'text_delta', sequence: 1 })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await vi.advanceTimersByTimeAsync(800)
    controlled.publish({ type: 'text_delta', sequence: 2 })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })
    await vi.advanceTimersByTimeAsync(800)
    controlled.publish({ type: 'text_delta', sequence: 3 })
    await expect(iterator.next()).resolves.toMatchObject({ done: false })

    const rejection = expect(result).rejects.toThrow('AI stream total timeout after 2500ms')
    await vi.advanceTimersByTimeAsync(100)
    await rejection
  })

  it('cleans up timeout timers after normal completion', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValue(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 2500 },
    )

    controlled.finish({ stopReason: 'stop' })
    await expect(stream.result()).resolves.toMatchObject({ stopReason: 'stop' })
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({ done: true })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(3000)
    expect(mocks.streamSimple.mock.calls[0][2].signal.aborted).toBe(false)
  })

  it('lets iterator return stop iteration without canceling result or leaking timers', async () => {
    const controlled = controlledStream()
    mocks.streamSimple.mockReturnValue(controlled.stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { idleTimeoutMs: 1000, totalTimeoutMs: 2500 },
    )
    const result = stream.result()
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.return()).resolves.toMatchObject({ done: true })
    controlled.finish({ stopReason: 'stop' })
    await expect(result).resolves.toMatchObject({ stopReason: 'stop' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects async iteration on idle timeout without requiring result()', async () => {
    mocks.streamSimple.mockImplementation(() => controlledStream().stream)
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    const stream = streamSimpleWithAiHttpLogging(
      { provider: 'mock', api: 'mock', id: 'mock-model' },
      { systemPrompt: '', messages: [], tools: [] },
      { deadlineMs: 1000, totalTimeoutMs: 60000 },
    )
    const next = stream[Symbol.asyncIterator]().next()

    const rejection = expect(next).rejects.toThrow('AI stream idle timeout after 1000ms')
    // 每次零内容超时触发透明重试，重试额度（2 次）用尽后才真正失败。
    const { MAX_STREAM_RETRIES } = await import('../../server/ai-http-logger.mjs')
    await vi.advanceTimersByTimeAsync((MAX_STREAM_RETRIES + 1) * 1000)

    await rejection
  })
})
