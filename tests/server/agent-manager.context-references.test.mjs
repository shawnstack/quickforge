import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  static instances = []
  static mode = 'complete'
  static promptGate = null
  static onContinue = null

  constructor(options = {}) {
    MockAgent.instances.push(this)
    this.options = options
    this.state = {
      ...(options.initialState || {}),
      messages: options.initialState?.messages ? [...options.initialState.messages] : [],
      pendingToolCalls: new Set(),
      isStreaming: false,
    }
    this.signal = new AbortController().signal
    this.listeners = new Set()
    this.lastTransformedMessages = null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt(message) {
    this.state.messages.push(message)
    this.lastTransformedMessages = await this.options.transformContext(this.state.messages, this.signal)
    for (const listener of this.listeners) await listener({ type: 'message_end', message, isInitialUserMessage: this.state.messages.length === 1 })
    if (MockAgent.mode === 'hang') await MockAgent.promptGate
    for (const listener of this.listeners) await listener({ type: 'agent_end', messages: this.state.messages })
  }

  async continue() {
    MockAgent.onContinue?.(this)
    this.lastTransformedMessages = await this.options.transformContext(this.state.messages, this.signal)
    if (MockAgent.mode === 'hang') await MockAgent.promptGate
    for (const listener of this.listeners) await listener({ type: 'agent_end', messages: this.state.messages })
  }

  abort() {}
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
vi.mock('../../server/channels/event-relay.mjs', () => ({ publishChannelSessionChanged: vi.fn(async () => true) }))

describe('agent file context references', () => {
  let tmpDir
  let workspaceRoot
  let databaseModule
  let previousDataDir

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'qf-agent-context-references-'))
    workspaceRoot = path.join(tmpDir, 'workspace')
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'src', 'app.ts'), 'export const app = true\n')
    MockAgent.instances = []
    MockAgent.mode = 'complete'
    MockAgent.promptGate = null
    MockAgent.onContinue = null
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
    const { writeProjectConfigData } = await import('../../server/storage.mjs')
    await writeProjectConfigData({
      activeProjectId: 'project-1',
      globalSkills: [],
      projects: [{ id: 'project-1', name: 'Project', path: workspaceRoot, skills: [] }],
    })
  })

  afterEach(async () => {
    const { shutdown } = await import('../../server/agent-manager.mjs')
    await shutdown().catch(() => {})
    await databaseModule?.closeSqliteStorage().catch(() => {})
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function createProjectSession(sessionId, messages = []) {
    const { createAgent } = await import('../../server/agent-manager.mjs')
    return createAgent(sessionId, {
      scope: 'project',
      projectId: 'project-1',
      model: { provider: 'mock', id: 'mock-model' },
      systemPrompt: '',
      messages,
      idleRetention: 'always',
    })
  }

  it('persists canonical details, injects path-only context with capabilities, restores them, and cleans the turn state', async () => {
    const session = await createProjectSession('context-success')
    const { destroyAgent, getSessionState, restoreAgent, runPrompt } = await import('../../server/agent-manager.mjs')
    const references = [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }]
    const capabilities = [
      { type: 'tool', pluginName: ' demo ', name: ' lint ', label: ' Lint ', description: ' Run lint ' },
      { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Duplicate' },
      { type: 'plugin', pluginName: 'unknown-history-plugin', name: 'unknown-history-plugin', label: 'Historical plugin' },
      { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
      { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
      { type: 'plugin', pluginName: 'ignored', name: 'fifth', label: 'Fifth' },
    ]
    await runPrompt(session.sessionId, {
      role: 'user',
      content: 'inspect this',
      details: {
        contextReferences: [{ path: 'forged' }],
        selectedCapabilities: [{ type: 'plugin', pluginName: 'forged', name: 'forged', label: 'Forged' }],
        keep: true,
      },
    }, capabilities, null, null, null, references)

    await vi.waitFor(() => expect(session.activeTransientContextPrompt).toBeNull())
    const visible = getSessionState(session.sessionId).messages[0]
    expect(visible.content).toBe('inspect this')
    expect(visible.details).toEqual({
      keep: true,
      contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts', name: 'app.ts' }],
      selectedCapabilities: [
        { type: 'tool', pluginName: 'demo', name: 'lint', label: 'Lint' },
        { type: 'plugin', pluginName: 'unknown-history-plugin', name: 'unknown-history-plugin', label: 'Historical plugin' },
        { type: 'skill', pluginName: 'demo', name: 'review', label: 'Review' },
        { type: 'command', pluginName: 'demo', name: 'ship', label: 'Ship' },
      ],
    })
    const transformed = MockAgent.instances[0].lastTransformedMessages[0]
    expect(transformed.content).toContain('src/app.ts')
    expect(transformed.content).toContain('paths only')
    expect(transformed.content).toContain('Lint')
    expect(transformed.content).toContain('Description: Run lint')
    expect(transformed.content).toContain('User request:\ninspect this')

    await destroyAgent(session.sessionId)
    await restoreAgent(session.sessionId)
    expect(getSessionState(session.sessionId).messages[0].details.selectedCapabilities).toEqual(visible.details.selectedCapabilities)

    await destroyAgent(session.sessionId)
    const freshSession = await createProjectSession('context-next')
    await runPrompt(freshSession.sessionId, 'next turn')
    await vi.waitFor(() => expect(MockAgent.instances.at(-1).lastTransformedMessages.at(-1)?.content).toBe('next turn'))
    await vi.waitFor(() => expect(freshSession.activeTransientContextPrompt).toBeNull())
    const nextTransformed = MockAgent.instances.at(-1).lastTransformedMessages.at(-1).content
    expect(nextTransformed).toBe('next turn')
    expect(nextTransformed).not.toContain('src/app.ts')
    expect(nextTransformed).not.toContain('Lint')
  })

  it('removes forged or stale selected capability details when the authoritative request selection is empty', async () => {
    const session = await createProjectSession('capabilities-empty')
    const { getSessionState, runPrompt } = await import('../../server/agent-manager.mjs')

    await runPrompt(session.sessionId, {
      role: 'user',
      content: 'plain request',
      details: {
        keep: true,
        selectedCapabilities: [{ type: 'plugin', pluginName: 'forged', name: 'forged', label: 'Forged' }],
      },
    }, [])

    await vi.waitFor(() => expect(MockAgent.instances.at(-1).lastTransformedMessages).not.toBeNull())
    expect(getSessionState(session.sessionId).messages[0].details).toEqual({ keep: true })
    expect(MockAgent.instances.at(-1).lastTransformedMessages[0].content).toBe('plain request')
  })

  it('fails validation before title, messages, and agent side effects', async () => {
    const session = await createProjectSession('context-invalid')
    const { getSessionState, runPrompt } = await import('../../server/agent-manager.mjs')

    await expect(runPrompt(session.sessionId, 'inspect', [], null, null, null, [
      { type: 'file', projectId: 'project-1', path: '../outside.ts' },
    ])).rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCES_INVALID' })

    expect(getSessionState(session.sessionId).messages).toEqual([])
    expect(session.title).toBe('New chat')
    expect(MockAgent.instances[0].lastTransformedMessages).toBeNull()
  })

  it('revalidates and replays persisted references on retry before truncating history', async () => {
    const refs = [{ type: 'file', projectId: 'project-1', path: 'src/app.ts', name: 'app.ts' }]
    const capabilities = [{
      type: 'plugin',
      pluginName: 'documents',
      name: 'documents',
      label: 'Documents',
      description: 'FORGED_HISTORY_DESCRIPTION_MUST_NOT_REACH_RETRY',
    }]
    const messages = [
      { role: 'user', content: 'inspect', details: { contextReferences: refs, selectedCapabilities: capabilities } },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
    ]
    const session = await createProjectSession('context-retry', messages)
    const { continueSession, getSessionState } = await import('../../server/agent-manager.mjs')

    await continueSession(session.sessionId)
    await vi.waitFor(() => expect(session.activeTransientContextPrompt).toBeNull())
    expect(getSessionState(session.sessionId).messages).toHaveLength(1)
    expect(MockAgent.instances[0].lastTransformedMessages[0].content).toContain('src/app.ts')
    expect(MockAgent.instances[0].lastTransformedMessages[0].content).toContain('Documents')
    expect(MockAgent.instances[0].lastTransformedMessages[0].content).toContain('plugin: documents, name: documents')
    expect(MockAgent.instances[0].lastTransformedMessages[0].content).not.toContain('FORGED_HISTORY_DESCRIPTION_MUST_NOT_REACH_RETRY')
    expect(MockAgent.instances[0].lastTransformedMessages[0].content).not.toContain('Description:')
    expect(getSessionState(session.sessionId).messages[0].details.selectedCapabilities).toEqual([
      { type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' },
    ])

    const failedMessages = [
      { role: 'user', content: 'inspect', details: { contextReferences: refs } },
      { role: 'assistant', content: [{ type: 'text', text: 'keep me' }] },
    ]
    session.agent.state.messages = failedMessages
    await unlink(path.join(workspaceRoot, 'src', 'app.ts'))
    await expect(continueSession(session.sessionId)).rejects.toMatchObject({ errorCode: 'CONTEXT_REFERENCE_NOT_FOUND' })
    expect(session.agent.state.messages).toBe(failedMessages)
    expect(session.agent.state.messages).toHaveLength(2)
  })

  it('keeps the failed turn and appends a continuation message when the retry follows a tool result', async () => {
    await writeFile(path.join(workspaceRoot, 'src', 'retry-append.ts'), 'export const value = 1\n')
    const refs = [{ type: 'file', projectId: 'project-1', path: 'src/retry-append.ts', name: 'retry-append.ts' }]
    const messages = [
      { role: 'user', content: 'edit the file', details: { contextReferences: refs } },
      { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'edit' }], stopReason: 'toolUse' },
      { role: 'toolResult', toolCallId: 'call-1', toolName: 'edit', content: [{ type: 'text', text: 'done' }], isError: false },
      { role: 'assistant', content: [{ type: 'text', text: '' }], stopReason: 'error', errorMessage: 'upstream failed' },
    ]
    const session = await createProjectSession('context-retry-append', messages)
    const { continueSession, getSessionState } = await import('../../server/agent-manager.mjs')

    await continueSession(session.sessionId, null, { role: 'user', content: '继续', timestamp: 1_700_000_000_000 })
    await vi.waitFor(() => expect(session.activeTransientContextPrompt).toBeNull())

    const next = getSessionState(session.sessionId).messages
    // Nothing is trimmed: the completed tool call stays in the transcript, so the
    // model does not redo the side effect it already performed.
    expect(next).toHaveLength(messages.length + 1)
    expect(next[1]).toMatchObject({ role: 'assistant' })
    expect(next[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call-1' })
    expect(next[3]).toMatchObject({ role: 'assistant', stopReason: 'error' })
    // The appended turn keeps the client identity but re-derives the references.
    expect(next[4]).toMatchObject({ role: 'user', content: '继续', timestamp: 1_700_000_000_000 })
    expect(next[4].details.contextReferences).toEqual(refs)
    // The model therefore sees the whole history, tool result included.
    expect(MockAgent.instances[0].lastTransformedMessages.some((message) => message.role === 'toolResult')).toBe(true)
  })

  it('scopes a fresh rollback turn id to each retry run and clears it when the run ends', async () => {
    const session = await createProjectSession('context-retry-turn-id', [
      { role: 'user', content: 'inspect' },
      { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
    ])
    const { continueSession, currentSessionTurnId } = await import('../../server/agent-manager.mjs')
    expect(currentSessionTurnId(session.sessionId)).toBeNull()

    const observed = []
    MockAgent.onContinue = () => observed.push(currentSessionTurnId(session.sessionId))
    for (let retry = 0; retry < 2; retry++) {
      await continueSession(session.sessionId)
      // The hook fires synchronously at the start of the run: the retry is
      // already attributed with its own turn id.
      expect(observed[retry]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      await vi.waitFor(() => expect(currentSessionTurnId(session.sessionId)).toBeNull())
    }
    MockAgent.onContinue = null
    // Each retry run gets its own id; the frontend groups them into one turn.
    expect(observed).toHaveLength(2)
    expect(observed[1]).not.toBe(observed[0])
  })

  // Regression: createAgent 在会话创建时内联调用 createServerTools，options
  // 必须与 rebuildSessionTools 一样传 getTurnId——漏传会让整会话的写盘工具
  // context 没有 turnId getter，版本记录恒为 null（轮级撤销全程不可见）。
  it('passes the live turn id getter on the createAgent tool path too', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const source = readFileSync(fileURLToPath(new URL('../../server/agent-manager.mjs', import.meta.url)), 'utf8')
    const createAgentCall = source.slice(source.indexOf('const tools = await createServerTools'))
    const optionsBlock = createAgentCall.slice(0, createAgentCall.indexOf('  // Resolve API key'))
    expect(optionsBlock).toContain('getTurnId: () => currentSessionTurnId(sessionId)')
    // Both the agent-profile branch and the default branch must pass it.
    const profileBranch = optionsBlock.slice(optionsBlock.indexOf('agentProfile'), optionsBlock.indexOf(': {', optionsBlock.indexOf('mcpWaitForConnections')))
    expect(profileBranch).toContain('getTurnId')
    const occurrences = optionsBlock.split('getTurnId: () => currentSessionTurnId(sessionId)').length - 1
    expect(occurrences).toBe(2)
  })

  // Regression: toolContext 必须持有「活」turnId 访问器。曾用对象展开
  // `...{ get turnId() {...} }` 注入，展开会立即求值并固化为静态值，
  // 使每会话构建一次的 toolContext 永久停在构建时的 turnId（主 Agent 写盘
  // details.turnId 恒为 null，轮级撤销按钮因此永不出现）。
  it('keeps toolContext.turnId a live accessor that follows the current turn', async () => {
    const { attachTurnIdGetter } = await import('../../server/agent-manager.mjs')
    let current = null
    const context = attachTurnIdGetter({ sessionId: 'turn-accessor-session' }, () => current)
    expect(context.turnId).toBeNull()
    current = 'turn-a'
    expect(context.turnId).toBe('turn-a')
    current = 'turn-b'
    expect(context.turnId).toBe('turn-b')
    current = null
    expect(context.turnId).toBeNull()
    // 无 getTurnId 时不应凭空造出 turnId 属性
    const plain = attachTurnIdGetter({ sessionId: 'no-getter' }, null)
    expect('turnId' in plain).toBe(false)
  })
})
