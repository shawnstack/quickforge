import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

class MockAgent {
  static instances = []
  static mode = 'complete'
  static promptGate = null

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
})
