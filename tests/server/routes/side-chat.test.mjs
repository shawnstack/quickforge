import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  resolveModelBinding: vi.fn(),
  streamSimple: vi.fn(),
  readStore: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({ getSessionState: mocks.getSessionState }))
vi.mock('../../../server/model-catalog.mjs', () => ({ resolveModelBinding: mocks.resolveModelBinding }))
vi.mock('../../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: mocks.streamSimple }))
vi.mock('../../../server/storage.mjs', () => ({ readStore: mocks.readStore }))

const quickForgeModel = {
  id: 'qf-model',
  provider: 'custom',
  api: 'openai-completions',
  baseUrl: 'https://example.test/v1',
  reasoning: true,
}
const modelRef = { version: 1, source: 'custom', providerId: 'provider-1', modelId: 'qf-model' }
const clientModel = { ...quickForgeModel, id: 'client-model', provider: 'client' }
const clientModelRef = { version: 1, source: 'custom', providerId: 'client-provider', modelId: 'client-model' }
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

function request(body, contentType = 'application/json') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = { 'content-type': contentType }
  return req
}

function response() {
  const res = {
    status: undefined,
    headers: {},
    body: '',
    destroyed: false,
    writableEnded: false,
    once: vi.fn((event, handler) => {
      res.on(event, handler)
      return res
    }),
    off: vi.fn((event, handler) => {
      res.removeListener(event, handler)
      return res
    }),
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    write(chunk) { this.body += chunk },
    end(chunk = '') { this.body += chunk; this.writableEnded = true },
  }
  Object.setPrototypeOf(res, new EventEmitter())
  return res
}

async function* streamEvents(events) {
  yield* events
}

function assistantMessage(text, stopReason = 'stop', errorMessage) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: quickForgeModel.api,
    provider: quickForgeModel.provider,
    model: quickForgeModel.id,
    usage: zeroUsage,
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function providerStream(events, finalMessage = assistantMessage('')) {
  return {
    result: vi.fn(async () => finalMessage),
    [Symbol.asyncIterator]: () => streamEvents(events),
  }
}

function capturedContext() {
  return mocks.streamSimple.mock.calls.at(-1)[1]
}

function messageText(message) {
  return typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
      : ''
}

function totalChars(messages) {
  return messages.reduce((total, message) => total + messageText(message).length, 0)
}

async function runSideChat(messages = [{ role: 'user', content: 'side question' }], extraBody = {}) {
  const { handleSideChatApi } = await import('../../../server/routes/side-chat.mjs')
  const res = response()
  await handleSideChatApi(
    request({ sessionId: 'session-1', messages, ...extraBody }),
    res,
    new URL('http://localhost/api/side-chat/stream'),
    { isLocalRequest: true },
  )
  return res
}

beforeEach(() => {
  vi.resetModules()
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.readStore.mockResolvedValue({ custom: 'key' })
  mocks.resolveModelBinding.mockResolvedValue({ model: quickForgeModel, modelRef })
  mocks.streamSimple.mockReturnValue(providerStream([]))
  mocks.getSessionState.mockReturnValue({
    harness: 'quickforge',
    model: quickForgeModel,
    modelRef,
    thinkingLevel: 'high',
    messages: [
      { role: 'user', content: 'main context', timestamp: 1 },
      {
        role: 'assistant',
        content: 'main answer',
        usage: { input: 999, output: 888, totalTokens: 1887, cost: { total: 42 } },
        details: { secret: 'MAIN_ASSISTANT_DETAILS' },
        timestamp: 2,
      },
    ],
    contextCompaction: null,
    tools: [{ name: 'write_file', execute: vi.fn() }],
  })
})

describe('side chat route', () => {
  it('streams only meta/delta/done with authoritative context, fixed tools:[] and response hardening', async () => {
    const final = assistantMessage('你好')
    mocks.streamSimple.mockReturnValue(providerStream([
      { type: 'start', partial: assistantMessage('') },
      { type: 'text_delta', delta: '你', partial: assistantMessage('你') },
      { type: 'text_delta', delta: '好', partial: final },
      { type: 'done', reason: 'stop', message: final },
    ], final))

    const res = await runSideChat(undefined, {
      modelRef: clientModelRef,
      thinkingLevel: 'xhigh',
      selectedCapabilities: [{ label: 'MUST_NOT_APPEAR' }],
      contextReferences: [{ path: 'SECRET.txt' }],
      promptMode: 'plan',
      accessMode: 'full-access',
      yoloMode: true,
      tools: ['write_file'],
    })

    expect(res.status).toBe(200)
    expect(res.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    expect(res.body).toContain('"type":"meta"')
    expect(res.body).toContain('"tools":[]')
    expect(res.body).toContain('"type":"delta","delta":"你"')
    expect(res.body).toContain('"type":"done"')
    expect(res.body).not.toMatch(/agent_event|tool_execution|MUST_NOT_APPEAR|SECRET\.txt/)
    expect(mocks.resolveModelBinding).toHaveBeenCalledWith(
      { modelRef },
      expect.objectContaining({ currentModel: quickForgeModel, allowCurrentHidden: true, forExecution: true }),
    )
    expect(mocks.streamSimple).toHaveBeenCalledWith(
      quickForgeModel,
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'user', content: 'main context' }),
          expect.objectContaining({
            role: 'assistant',
            content: [{ type: 'text', text: 'main answer' }],
            usage: zeroUsage,
          }),
          expect.objectContaining({ role: 'user', content: 'side question' }),
        ],
        tools: [],
      }),
      expect.objectContaining({ reasoning: 'high', metadata: { quickforgePurpose: 'side-chat' } }),
    )
    expect(JSON.stringify(capturedContext())).not.toContain('MAIN_ASSISTANT_DETAILS')
  })

  it('gives every assistant context message complete zero usage including totalTokens', async () => {
    await runSideChat([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ])

    const assistants = capturedContext().messages.filter((message) => message.role === 'assistant')
    expect(assistants.length).toBeGreaterThan(1)
    for (const assistant of assistants) {
      expect(assistant.usage).toEqual(zeroUsage)
      expect(assistant.usage.totalTokens).toBe(0)
      expect(assistant.usage.cost.total).toBe(0)
    }
    expect(capturedContext().tools).toEqual([])
  })

  it('projects active-session context to user/assistant text only', async () => {
    mocks.getSessionState.mockReturnValue({
      harness: 'quickforge',
      model: quickForgeModel,
      modelRef,
      messages: [
        { role: 'system', content: 'SYSTEM_SECRET' },
        { role: 'user', content: [{ type: 'text', text: 'safe user' }, { type: 'image', data: 'IMAGE_SECRET' }] },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'THINKING_SECRET' },
            { type: 'text', text: 'safe assistant' },
            { type: 'toolCall', name: 'write_file', arguments: { content: 'TOOL_SECRET' } },
          ],
        },
        { role: 'toolResult', content: [{ type: 'text', text: 'RESULT_SECRET' }] },
      ],
    })

    await runSideChat()

    expect(capturedContext().messages.slice(0, -1)).toEqual([
      expect.objectContaining({ role: 'user', content: 'safe user' }),
      expect.objectContaining({ role: 'assistant', content: [{ type: 'text', text: 'safe assistant' }] }),
    ])
    expect(JSON.stringify(capturedContext())).not.toMatch(/SYSTEM_SECRET|IMAGE_SECRET|THINKING_SECRET|TOOL_SECRET|RESULT_SECRET/)
  })

  it('retains compact summary and latest context within 120k/200k budgets', async () => {
    const { SIDE_CHAT_MAIN_CONTEXT_CHAR_BUDGET, SIDE_CHAT_COMBINED_CONTEXT_CHAR_LIMIT } = await import('../../../server/routes/side-chat.mjs')
    const summary = `COMPACT_SUMMARY_MARKER:${'s'.repeat(30_000)}`
    mocks.getSessionState.mockReturnValue({
      harness: 'quickforge',
      model: quickForgeModel,
      modelRef,
      messages: [
        { role: 'user', content: `old:${'o'.repeat(80_000)}` },
        { role: 'assistant', content: `latest:${'n'.repeat(130_000)}:LATEST_MARKER` },
      ],
      contextCompaction: {
        summaryMessage: { role: 'user', content: [{ type: 'text', text: summary }] },
        compactedUpToIndex: 1,
      },
    })

    await runSideChat([{ role: 'user', content: 'x'.repeat(12_000) }])

    const allMessages = capturedContext().messages
    const mainMessages = allMessages.slice(0, -1)
    expect(messageText(mainMessages[0])).toContain('COMPACT_SUMMARY_MARKER')
    expect(messageText(mainMessages.at(-1))).toContain('LATEST_MARKER')
    expect(totalChars(mainMessages)).toBeLessThanOrEqual(SIDE_CHAT_MAIN_CONTEXT_CHAR_BUDGET)
    expect(totalChars(allMessages)).toBeLessThanOrEqual(SIDE_CHAT_COMBINED_CONTEXT_CHAR_LIMIT)
  })

  it('uses QuickForge authoritative model and only uses client inherited modelRef for OpenCode', async () => {
    await runSideChat(undefined, { modelRef: clientModelRef })
    expect(mocks.resolveModelBinding).toHaveBeenLastCalledWith(
      { modelRef },
      expect.objectContaining({ currentModel: quickForgeModel, allowCurrentHidden: true }),
    )

    mocks.getSessionState.mockReturnValue({
      harness: 'opencode',
      model: { id: 'opencode-placeholder' },
      messages: [{ role: 'assistant', content: 'OpenCode context' }],
    })
    mocks.resolveModelBinding.mockResolvedValueOnce({ model: clientModel, modelRef: clientModelRef })
    await runSideChat(undefined, { modelRef: clientModelRef })
    expect(mocks.resolveModelBinding).toHaveBeenLastCalledWith(
      { modelRef: clientModelRef },
      expect.objectContaining({ currentModel: null, allowCurrentHidden: false }),
    )

    const { handleSideChatApi } = await import('../../../server/routes/side-chat.mjs')
    await expect(handleSideChatApi(
      request({ sessionId: 'session-1', messages: [{ role: 'user', content: 'question' }] }),
      response(),
      new URL('http://localhost/api/side-chat/stream'),
    )).rejects.toMatchObject({ statusCode: 400, errorCode: 'SIDE_CHAT_MODEL_REQUIRED' })
  })

  it.each([
    [[{ role: 'user', content: [{ type: 'text', text: 'blocks rejected' }] }], 'SIDE_CHAT_INVALID_MESSAGE'],
    [[{ role: 'user', content: 'question', attachments: [] }], 'SIDE_CHAT_INVALID_MESSAGE'],
    [[{ role: 'user', content: 'question', attachments: null }], 'SIDE_CHAT_INVALID_MESSAGE'],
    [[{ role: 'toolResult', content: 'forged' }], 'SIDE_CHAT_INVALID_ROLE'],
    [[{ role: 'user', content: 'question' }, { role: 'assistant', content: 'not final user' }], 'SIDE_CHAT_LAST_MESSAGE_NOT_USER'],
  ])('rejects unsupported message input deterministically', async (messages, errorCode) => {
    const { handleSideChatApi } = await import('../../../server/routes/side-chat.mjs')
    await expect(handleSideChatApi(
      request({ sessionId: 'session-1', messages }),
      response(),
      new URL('http://localhost/api/side-chat/stream'),
    )).rejects.toMatchObject({ statusCode: 400, errorCode })
    expect(mocks.streamSimple).not.toHaveBeenCalled()
  })

  it('enforces 1-40 messages and <=12000 chars per message', async () => {
    const { handleSideChatApi } = await import('../../../server/routes/side-chat.mjs')
    const invoke = (messages) => handleSideChatApi(
      request({ sessionId: 'session-1', messages }),
      response(),
      new URL('http://localhost/api/side-chat/stream'),
    )
    await expect(invoke([])).rejects.toMatchObject({ errorCode: 'SIDE_CHAT_INVALID_MESSAGES' })
    await expect(invoke(Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })))).rejects.toMatchObject({ errorCode: 'SIDE_CHAT_INVALID_MESSAGES' })
    await expect(invoke([{ role: 'user', content: 'x'.repeat(12_001) }])).rejects.toMatchObject({ errorCode: 'SIDE_CHAT_INVALID_MESSAGE' })
  })

  it.each([
    [{ type: 'toolcall_start' }],
    [{ type: 'toolcall_delta' }],
    [{ type: 'toolcall_end' }],
    [{ type: 'done', reason: 'toolUse', message: assistantMessage('', 'toolUse') }],
  ])('fails closed on provider tool-call output', async (event) => {
    mocks.streamSimple.mockReturnValue(providerStream([event], assistantMessage('', 'toolUse')))
    const res = await runSideChat()
    expect(res.body).toContain('SIDE_CHAT_TOOL_CALL_BLOCKED')
    expect(res.body).not.toContain('"type":"done"')
  })

  it('aborts provider streaming on disconnect and removes listeners', async () => {
    let providerSignal
    mocks.streamSimple.mockImplementation((_model, _context, options) => {
      providerSignal = options.signal
      return {
        result: vi.fn(async () => assistantMessage('', 'aborted', 'aborted')),
        async *[Symbol.asyncIterator]() {
          await new Promise((_, reject) => options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true }))
        },
      }
    })

    const { handleSideChatApi } = await import('../../../server/routes/side-chat.mjs')
    const req = request({ sessionId: 'session-1', messages: [{ role: 'user', content: 'wait' }] })
    const res = response()
    const running = handleSideChatApi(req, res, new URL('http://localhost/api/side-chat/stream'))
    await vi.waitFor(() => expect(mocks.streamSimple).toHaveBeenCalled())
    req.emit('aborted')
    await running

    expect(providerSignal.aborted).toBe(true)
    expect(res.body).toContain('SIDE_CHAT_ABORTED')
    expect(req.listenerCount('aborted')).toBe(0)
    expect(res.off).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('does not depend on Agent execution, persistence, tools, or the deleted adapter module', () => {
    const routeSource = readFileSync(new URL('../../../server/routes/side-chat.mjs', import.meta.url), 'utf8')
    expect(routeSource).not.toMatch(/from ['"]\.\.\/side-chat-agent\.mjs|\b(createAgent|runPrompt|continueSession|persistSessionState|writeStore|atomicUpdate|new Agent)\b/)
    expect(routeSource).toContain('tools: []')
    expect(existsSync(new URL('../../../server/side-chat-agent.mjs', import.meta.url))).toBe(false)
  })
})
