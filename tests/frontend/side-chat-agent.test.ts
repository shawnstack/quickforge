import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { SideChatStreamOptions } from '../../src/components/workspace/side-chat-client'
import { MAX_SIDE_CHAT_MESSAGES, MAX_SIDE_CHAT_REQUEST_CHARS, SideChatAgent } from '../../src/components/workspace/side-chat-agent'

const model = {
  id: 'model-1',
  name: 'Model 1',
  api: 'openai-completions',
  provider: 'provider-1',
  baseUrl: 'https://example.test/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4096,
} as Model<Api>

const secondModel = {
  ...model,
  id: 'model-2',
  provider: 'provider-2',
  quickforgeModelRef: {
    version: 1 as const,
    source: 'custom' as const,
    providerId: 'provider-2',
    modelId: 'model-2',
  },
} as Model<Api>

const emptyUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function assistantText(message: AgentMessage | undefined) {
  if (!message || message.role !== 'assistant') return ''
  return message.content.filter((part) => part.type === 'text').map((part) => part.text).join('')
}

function requestMessageText(message: AgentMessage) {
  if (message.role === 'user' && typeof message.content === 'string') return message.content
  return message.role === 'assistant' ? assistantText(message) : ''
}

function assistantMessageForTest(text: string, timestamp = 1): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage,
    stopReason: 'stop',
    timestamp,
  }
}

function deltaLifecycle(options: SideChatStreamOptions, text = '你好') {
  options.onDelta?.(text.slice(0, 1))
  options.onDelta?.(text.slice(1))
}

describe('SideChatAgent', () => {
  it('converts plain deltas to the standard display lifecycle with complete assistant usage', async () => {
    const stream = vi.fn(async (_request, options) => deltaLifecycle(options))
    const agent = new SideChatAgent({ model, sessionId: 'session-1', stream })
    const events: AgentEvent[] = []
    agent.subscribe((event) => events.push(event))

    await agent.prompt('问题')

    expect(events.map((event) => event.type)).toEqual([
      'agent_start', 'turn_start', 'message_start', 'message_end',
      'message_start', 'message_update', 'message_update', 'message_end',
      'turn_end', 'agent_end',
    ])
    expect(agent.state.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(agent.state.messages[0]).toMatchObject({ role: 'user', content: '问题' })
    expect(assistantText(agent.state.messages[1])).toBe('你好')
    expect(agent.state.messages[1]).toMatchObject({
      role: 'assistant',
      usage: emptyUsage,
      stopReason: 'stop',
    })
    expect((agent.state.messages[1] as { usage: typeof emptyUsage }).usage.totalTokens).toBe(0)
    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.streamingMessage).toBeUndefined()
    expect(agent.state.pendingToolCalls.size).toBe(0)
  })

  it('sends only plain text messages and inherits session/model through setContext', async () => {
    const stream = vi.fn(async (_request, options) => deltaLifecycle(options, 'ok'))
    const agent = new SideChatAgent({ model, stream })
    agent.setContext({ sessionId: 'session-2', model: secondModel })

    await agent.prompt('plain text')

    expect(stream).toHaveBeenCalledWith({
      sessionId: 'session-2',
      modelRef: secondModel.quickforgeModelRef,
      messages: [{ role: 'user', content: 'plain text', timestamp: expect.any(Number) }],
    }, expect.objectContaining({ signal: expect.any(AbortSignal), onDelta: expect.any(Function) }))
    expect(agent.state.model).toBe(secondModel)
    expect(agent.state.thinkingLevel).toBe('off')
  })

  it('rejects non-string AgentMessage input and clamps string input to 12000 chars', async () => {
    const stream = vi.fn(async (_request, options) => deltaLifecycle(options, 'ok'))
    const agent = new SideChatAgent({ model, stream })

    await agent.prompt({ role: 'user', content: [{ type: 'text', text: 'block' }], timestamp: 1 } as AgentMessage)
    expect(stream).not.toHaveBeenCalled()

    await agent.prompt('x'.repeat(12_001))
    expect(stream.mock.calls[0]?.[0].messages[0].content).toHaveLength(12_000)
  })

  it('keeps tools and pending calls permanently empty', () => {
    const agent = new SideChatAgent({ model, stream: async () => {} })
    expect(agent.state.tools).toEqual([])
    agent.state.tools = [{ name: 'read_file' }] as never
    expect(agent.state.tools).toEqual([])
    expect(agent.state.pendingToolCalls.size).toBe(0)
  })

  it('keeps only the latest 40 messages', async () => {
    const agent = new SideChatAgent({
      model,
      stream: async (_request, options) => deltaLifecycle(options, 'answer'),
    })

    for (let index = 0; index < 25; index += 1) await agent.prompt(`question-${index}`)

    expect(agent.state.messages).toHaveLength(MAX_SIDE_CHAT_MESSAGES)
    expect(agent.state.messages[0]).toMatchObject({ role: 'user', content: 'question-5' })
    expect(agent.state.messages.at(-1)?.role).toBe('assistant')
  })

  it('clips request history to complete newest messages within the 200k server budget', async () => {
    const stream = vi.fn(async (_request, options) => deltaLifecycle(options, 'ok'))
    const agent = new SideChatAgent({ model, stream })
    const seeded: AgentMessage[] = []
    for (let index = 0; index < 39; index += 1) {
      seeded.push({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: index % 2 === 0 ? `user-${index}:${'u'.repeat(11_990)}` : [{ type: 'text', text: `assistant-${index}:${'a'.repeat(11_985)}` }],
        ...(index % 2 === 0 ? {} : {
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: emptyUsage,
          stopReason: 'stop',
        }),
        timestamp: index,
      } as AgentMessage)
    }
    agent.state.messages = seeded

    await agent.prompt('latest-user')

    const requestMessages = stream.mock.calls[0]?.[0].messages
    expect(requestMessages.at(-1)).toMatchObject({ role: 'user', content: 'latest-user' })
    expect(requestMessages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(MAX_SIDE_CHAT_REQUEST_CHARS)
    expect(requestMessages.every((message) => message.content.length > 0)).toBe(true)
    expect(requestMessages).not.toContainEqual(expect.objectContaining({ role: 'assistant', content: '' }))
    const requestContents = requestMessages.map((message) => message.content)
    expect(requestContents.every((content) => seeded.some((message) => requestMessageText(message) === content) || content === 'latest-user')).toBe(true)
    expect(agent.state.messages).toHaveLength(MAX_SIDE_CHAT_MESSAGES)
  })

  it('drops an oversized older boundary message instead of creating a partial or empty assistant', async () => {
    const stream = vi.fn(async (_request, options) => deltaLifecycle(options, 'ok'))
    const agent = new SideChatAgent({ model, stream })
    const olderAssistant = assistantMessageForTest('a'.repeat(12_000))
    const recentMessages: AgentMessage[] = Array.from({ length: 16 }, (_, index) => (
      index % 2 === 0
        ? { role: 'user', content: `u-${index}:${'u'.repeat(11_990)}`, timestamp: index + 2 }
        : assistantMessageForTest(`a-${index}:${'a'.repeat(11_990)}`, index + 2)
    ))
    agent.state.messages = [{ role: 'user', content: 'old-user', timestamp: 0 }, olderAssistant, ...recentMessages]

    await agent.prompt('final-user')

    const messages = stream.mock.calls[0]?.[0].messages
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: 'final-user' })
    expect(messages.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(MAX_SIDE_CHAT_REQUEST_CHARS)
    expect(messages.some((message) => message.content === 'a'.repeat(12_000))).toBe(false)
    expect(messages.every((message) => message.content.length > 0)).toBe(true)
  })

  it('finishes an error run with a standard assistant error and can send again', async () => {
    const stream = vi.fn()
      .mockRejectedValueOnce(new Error('broken'))
      .mockImplementationOnce(async (_request, options) => deltaLifecycle(options, 'recovered'))
    const agent = new SideChatAgent({ model, stream })

    await agent.prompt('first')
    expect(agent.state.errorMessage).toBe('broken')
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      usage: emptyUsage,
      stopReason: 'error',
      errorMessage: 'broken',
    })

    await agent.prompt('second')
    expect(agent.state.errorMessage).toBeUndefined()
    expect(assistantText(agent.state.messages.at(-1))).toBe('recovered')
  })

  it('aborts exactly once and leaves a complete aborted assistant message', async () => {
    const pending = deferred<void>()
    const stream = vi.fn((_request, options) => {
      options.signal?.addEventListener('abort', () => pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
      return pending.promise
    })
    const agent = new SideChatAgent({ model, stream })
    const events: AgentEvent[] = []
    agent.subscribe((event) => events.push(event))

    const running = agent.prompt('stop me')
    agent.abort()
    agent.abort()
    await running

    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      usage: emptyUsage,
      stopReason: 'aborted',
      errorMessage: 'Request aborted',
    })
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1)
    expect(events.filter((event) => (event as { type: string }).type === 'error')).toHaveLength(0)
  })

  it('reset aborts and clears all in-memory state', async () => {
    const pending = deferred<void>()
    const agent = new SideChatAgent({ model, stream: () => pending.promise })
    void agent.prompt('wait')
    agent.reset()
    pending.resolve()
    await Promise.resolve()

    expect(agent.state.messages).toEqual([])
    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.errorMessage).toBeUndefined()
    expect(agent.state.tools).toEqual([])
  })
})
