import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  static instances = []

  constructor(options = {}) {
    MockAgent.instances.push(this)
    this.state = {
      ...(options.initialState || {}),
      messages: [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.listeners = new Set()
    this.signal = new AbortController().signal
    this.abort = vi.fn()
    this.waitForIdle = vi.fn(async () => {})
    this.continue = vi.fn()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: MockAgent,
  estimateContextTokens: vi.fn(() => 0),
  estimateTokens: vi.fn(() => 0),
  shouldCompact: vi.fn(() => false),
}))
vi.mock('../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: vi.fn() }))
vi.mock('../../server/mcp/registry.mjs', () => ({
  createMcpToolDefinitions: vi.fn(async () => []),
  isMcpToolName: vi.fn(() => false),
  subscribeMcpToolsetChanged: vi.fn(() => () => {}),
}))
vi.mock('../../server/plugins/registry.mjs', () => ({
  callPluginTool: vi.fn(),
  createPluginToolDefinitions: vi.fn(async () => []),
  getEnabledPluginCommandSources: vi.fn(async () => []),
  getEnabledPluginSkillSources: vi.fn(async () => []),
  isPluginToolName: vi.fn(() => false),
}))

describe('agent manager rollback with compaction', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-rollback-compaction-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    MockAgent.instances = []
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function textMessage(role, text) {
    return { role, content: [{ type: 'text', text }] }
  }

  /** 方案 B：压缩摘要就是数组里的一条消息；滚动压缩每压一次追加一条。 */
  function compactionMessage(text) {
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      details: { quickforgeCompaction: { version: 1, kind: 'summary' } },
    }
  }

  /** 8 messages [u0..a3], compactedUpToIndex 4 → 前 4 条被摘要覆盖，tail 为 [u2,a2,u3,a3] */
  function compactedSession(session) {
    session.agent.state.messages = [
      textMessage('user', 'u0'),
      textMessage('assistant', 'a0'),
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      textMessage('user', 'u2'),
      textMessage('assistant', 'a2'),
      textMessage('user', 'u3'),
      textMessage('assistant', 'a3'),
    ]
    session.contextCompaction = {
      summaryMessage: textMessage('user', 'The previous conversation has been compacted.\n<compact_summary>\nEarlier history.\n</compact_summary>'),
      compactedUpToIndex: 4,
      sourceMessageCount: 8,
    }
  }

  it('keeps compaction when rolling back after the compacted point', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, rollbackSessionMessages } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('rollback-after-compact', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
    })
    compactedSession(session)

    // 撤回最后一条 assistant 消息 → rollbackIndex = 6（u3），在压缩点 4 之后
    await rollbackSessionMessages('rollback-after-compact', 7)

    expect(session.contextCompaction).not.toBeNull()
    expect(session.contextCompaction.compactedUpToIndex).toBe(4)
    expect(session.agent.state.messages).toHaveLength(6)
    expect(session.agent.state.messages[5].content[0].text).toBe('a2')
  })

  it('resets compaction when rolling back before the compacted point', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, rollbackSessionMessages } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('rollback-before-compact', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
    })
    compactedSession(session)

    // 撤回 a1 → rollbackIndex = 2（u1），在压缩点 4 之前
    await rollbackSessionMessages('rollback-before-compact', 3)

    expect(session.contextCompaction).toBeNull()
    expect(session.agent.state.messages).toHaveLength(2)
  })

  it('re-points compaction at the surviving summary when rolling back between two compactions', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, rollbackSessionMessages } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('rollback-between-compactions', {
      scope: 'global',
      model: { provider: 'mock', id: 'mock-model' },
    })
    const firstSummary = compactionMessage('First summary.\n<compact_summary>\nEarlier history.\n</compact_summary>')
    const secondSummary = compactionMessage('Second summary.\n<compact_summary>\nLater history.\n</compact_summary>')
    session.agent.state.messages = [
      textMessage('user', 'u0'),
      textMessage('assistant', 'a0'),
      firstSummary,
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      secondSummary,
      textMessage('user', 'u2'),
      textMessage('assistant', 'a2'),
    ]
    session.contextCompaction = {
      summaryMessage: secondSummary,
      compactedUpToIndex: 6,
      sourceMessageCount: 8,
    }

    // 撤回 u1（下标 3）：secondSummary 被截掉，firstSummary 留下
    await rollbackSessionMessages('rollback-between-compactions', 3)

    expect(session.agent.state.messages).toHaveLength(3)
    expect(session.contextCompaction).not.toBeNull()
    // 下一次压缩会拿 summaryMessage 当 previousSummary 重建摘要源；这里若不换回
    // 现存的 firstSummary，已被回撤掉的内容就会重新出现在新摘要里。
    expect(session.contextCompaction.summaryMessage).toBe(firstSummary)
    expect(session.contextCompaction.compactedUpToIndex).toBe(3)
  })
})
