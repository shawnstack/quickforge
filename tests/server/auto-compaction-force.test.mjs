import { beforeEach, describe, expect, it, vi } from 'vitest'

// 压缩链路的两处外部副作用必须打桩：读设置（存储）与调模型/写备份。
// 其余保持真实实现，这样测的是真实 gate + 真实摘要消息落位。
vi.mock('../../server/storage.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    readStore: vi.fn(async () => ({ 'auto-compact-settings': { enabled: true, thresholdPercent: 80 } })),
  }
})

vi.mock('../../server/conversation-compaction.mjs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    compactConversation: vi.fn(async () => ({ summary: 'SUMMARY TEXT' })),
    saveCompactBackup: vi.fn(async () => {}),
  }
})

const { maybeAutoCompactSession, requestForceCompaction } = await import('../../server/auto-compaction.mjs')
const { compactConversation } = await import('../../server/conversation-compaction.mjs')

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }], timestamp: new Date().toISOString() }
}

function makeSession() {
  const messages = [
    textMessage('user', 'first ask'),
    textMessage('assistant', 'first answer'),
    textMessage('user', 'second ask'),
    textMessage('assistant', 'second answer'),
  ]
  return {
    sessionId: 'force-compaction-test',
    model: { id: 'test-model', contextWindow: 200000 },
    thinkingLevel: 'off',
    getApiKey: () => 'test-key',
    agent: { state: { systemPrompt: 'system prompt', tools: [], messages } },
  }
}

function run(session) {
  return maybeAutoCompactSession({
    session,
    messages: session.agent.state.messages,
    emitSessionEvent: () => {},
    persistSession: async () => {},
    logger: { warn: () => {}, info: () => {} },
  })
}

describe('forced compaction bypasses the threshold gate', () => {
  beforeEach(() => {
    compactConversation.mockClear()
  })

  it('leaves a below-threshold session alone when nobody asked', async () => {
    const session = makeSession()
    const result = await run(session)
    expect(result.compacted).toBe(false)
    // 这个桩里没有供应商上报用量，gate 停在 unknown_usage 而不是
    // below_threshold —— 真实链路上「还没拿到真实用量」就是这个状态。
    // 也就是说：没有人主动请求时，这类会话永远不会被压。
    expect(result.reason).toBe('unknown_usage')
    expect(compactConversation).not.toHaveBeenCalled()
    expect(session.contextCompaction).toBeUndefined()
  })

  it('still compacts when the usage is unknown but the session asked', async () => {
    // 强制压缩不依赖可判定的用量：这正是「用量未知就永远不压」的出口。
    const session = makeSession()
    requestForceCompaction(session, { reason: 'agent_request' })
    const result = await run(session)
    expect(result.compacted).toBe(true)
    expect(result.reason).toBe('agent_compact')
  })

  it('compacts a below-threshold session when the session asked for it', async () => {
    const session = makeSession()
    requestForceCompaction(session, { reason: 'agent_request' })
    const result = await run(session)
    expect(result.compacted).toBe(true)
    expect(result.reason).toBe('agent_compact')
    expect(compactConversation).toHaveBeenCalledTimes(1)
    // 摘要落成一条真实消息，插在压缩点。
    const messages = session.agent.state.messages
    const summaryMessage = messages[messages.length - 1]
    expect(summaryMessage.content[0].text).toContain('<compact_summary>')
    expect(summaryMessage.content[0].text).toContain('SUMMARY TEXT')
    // 标记是一次性的：同一个标记不会压第二遍。
    expect(session.forceCompaction).toBeNull()
    const second = await run(session)
    expect(second.compacted).toBe(false)
    expect(compactConversation).toHaveBeenCalledTimes(1)
  })

  it('drops the request when compaction is disabled by the user', async () => {
    const { readStore } = await import('../../server/storage.mjs')
    readStore.mockResolvedValueOnce({ 'auto-compact-settings': { enabled: false, thresholdPercent: 80 } })
    const session = makeSession()
    requestForceCompaction(session, { reason: 'agent_request' })
    const result = await run(session)
    // 关掉自动压缩是用户对自己的上下文说的话，会话的一次请求不越过它。
    expect(result.compacted).toBe(false)
    expect(result.reason).toBe('disabled')
    expect(session.forceCompaction).toBeNull()
  })
})
