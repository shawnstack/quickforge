import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

class MockAgent {
  static instances = []

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
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async emit(event) {
    for (const listener of this.listeners) await listener(event)
  }

  async prompt() {
    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'mock subagent completed' }],
      timestamp: Date.now(),
    }
    this.state.messages.push(message)
    for (const listener of this.listeners) listener({ type: 'message_end', message })
    for (const listener of this.listeners) listener({ type: 'agent_end', messages: this.state.messages })
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

describe('agent manager subagent execution', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-manager-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    MockAgent.instances = []
  })

  afterEach(async () => {
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('allows subagents when a session has a workspace context without a project id', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('global-subagent-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      expect(session.projectId).toBeNull()
      expect(session.projectContext?.workspaceRoot).toBe(workspaceRoot)

      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      expect(runSubagent).toBeTruthy()

      const result = await runSubagent.execute(
        'tool-call-1',
        { subagent: 'explore', task: 'Inspect the workspace.' },
        new AbortController().signal,
      )

      expect(result.content[0].text).toBe('mock subagent completed')
      expect(result.details.subagent).toBe('explore')
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('creates a temporary subagent markdown profile and runs it with inherited model', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const parentModel = { provider: 'mock', id: 'mock-model', api: 'mock-api', baseUrl: 'http://mock.local' }
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const { tempAgentsDir } = await import('../../server/storage.mjs')
    const session = await createAgent('temporary-subagent-workspace', {
      scope: 'global',
      model: parentModel,
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const result = await runSubagent.execute(
        'tool-call-temp',
        {
          subagent: {
            type: 'temporary',
            name: 'test-finder',
            label: 'Test Finder',
            description: 'Find tests',
            instructions: 'Only find relevant tests.',
          },
          task: 'Find tests.',
        },
        new AbortController().signal,
      )

      expect(result.content[0].text).toBe('mock subagent completed')
      expect(result.details.subagent).toBe('test-finder')
      expect(result.details.lifecycle).toBe('temporary')
      expect(result.details.model).toMatchObject({ mode: 'inherit', inherited: true })
      expect(result.details.profilePath).toContain(tempAgentsDir)
      const markdown = await readFile(result.details.profilePath, 'utf8')
      expect(markdown).toContain('name: test-finder')
      expect(markdown).toContain('source: temporary')
      expect(markdown).toContain('model:\n  mode: inherit')
      const subagentInstance = MockAgent.instances.at(-1)
      expect(subagentInstance.state.model).toBe(parentModel)
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('uses profile thinking levels and disables thinking for non-reasoning models', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const parentModel = { provider: 'mock', id: 'parent-model', reasoning: true }
    const fixedModel = { provider: 'mock', id: 'fixed-model', api: 'mock-api', baseUrl: 'http://mock.local', reasoning: true }
    const plainModel = { provider: 'mock', id: 'plain-model', api: 'mock-api', baseUrl: 'http://mock.local', reasoning: false }
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    const { createCustomAgentProfile } = await import('../../server/agent-profiles.mjs')
    const { writeStore } = await import('../../server/storage.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)
    await writeStore('custom-providers', { mock: { models: [fixedModel, plainModel] } })
    await createCustomAgentProfile({
      name: 'deep-review',
      label: 'Deep Review',
      systemPrompt: 'Review deeply.',
      allowedTools: ['read_file', 'grep_files'],
      capabilityPolicy: 'review-only',
      thinkingLevel: 'high',
      model: { mode: 'fixed', provider: 'mock', modelId: 'fixed-model', api: 'mock-api', baseUrl: 'http://mock.local' },
    })
    await createCustomAgentProfile({
      name: 'plain-review',
      label: 'Plain Review',
      systemPrompt: 'Review plainly.',
      allowedTools: ['read_file', 'grep_files'],
      capabilityPolicy: 'review-only',
      thinkingLevel: 'high',
      model: { mode: 'fixed', provider: 'mock', modelId: 'plain-model', api: 'mock-api', baseUrl: 'http://mock.local' },
    })

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('profile-thinking-workspace', {
      scope: 'global',
      model: parentModel,
      thinkingLevel: 'medium',
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      await runSubagent.execute('tool-call-deep', { subagent: 'deep-review', task: 'Review.' }, new AbortController().signal)
      expect(MockAgent.instances.at(-1).state).toMatchObject({ model: fixedModel, thinkingLevel: 'high' })

      await runSubagent.execute('tool-call-plain', { subagent: 'plain-review', task: 'Review.' }, new AbortController().signal)
      expect(MockAgent.instances.at(-1).state).toMatchObject({ model: plainModel, thinkingLevel: 'off' })
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('consumes builtin explore/general thinking level overrides in runSubagent', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const parentModel = { provider: 'mock', id: 'parent-model', api: 'mock-api', baseUrl: 'http://mock.local', reasoning: true }
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    const { writeStore } = await import('../../server/storage.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)
    await writeStore('agent-profile-overrides', {
      explore: { thinkingLevel: 'high' },
      general: { thinkingLevel: 'inherit' },
    })

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('builtin-thinking-overrides-workspace', {
      scope: 'global',
      model: parentModel,
      thinkingLevel: 'medium',
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      expect(runSubagent).toBeTruthy()

      await runSubagent.execute('tool-call-builtin-explore', { subagent: 'explore', task: 'Inspect the workspace.' }, new AbortController().signal)
      expect(MockAgent.instances.at(-1).state).toMatchObject({ model: parentModel, thinkingLevel: 'high' })

      await runSubagent.execute('tool-call-builtin-general', { subagent: 'general', task: 'Implement the fix.' }, new AbortController().signal)
      expect(MockAgent.instances.at(-1).state).toMatchObject({ model: parentModel, thinkingLevel: 'medium' })
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('exposes running subagent snapshots across refresh without duplicating the final tool result', async () => {
    const { createAgent, destroyAgent, getSessionState } = await import('../../server/agent-manager.mjs')
    const sessionId = 'running-subagent-snapshot'
    const session = await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'inspect', timestamp: Date.now() }],
      idleRetention: 'always',
    })
    const toolCallId = 'tool-call-running'
    const partialMessages = [{ role: 'assistant', content: 'checking files', timestamp: Date.now() }]
    const tools = [{ name: 'read_file', description: 'Read a file' }]

    try {
      await session.agent.emit({
        type: 'tool_execution_start',
        toolCallId,
        toolName: 'run_subagent',
      })
      await session.agent.emit({
        type: 'tool_execution_update',
        toolCallId,
        toolName: 'run_subagent',
        partialResult: {
          content: [],
          details: {
            sessionId: `${sessionId}:subagent:explore:1`,
            messages: partialMessages,
            tools,
            pendingToolCalls: ['subagent-tool-call'],
          },
        },
      })

      const runningState = getSessionState(sessionId)
      const runningResult = runningState.messages.find((message) => message.role === 'toolResult' && message.toolCallId === toolCallId)
      expect(runningState.pendingToolCalls).toContain(toolCallId)
      expect(runningResult).toMatchObject({
        role: 'toolResult',
        toolCallId,
        toolName: 'run_subagent',
        details: {
          sessionId: `${sessionId}:subagent:explore:1`,
          toolCallId,
          messages: partialMessages,
          tools,
          pendingToolCalls: ['subagent-tool-call'],
          quickforgeTiming: { startedAt: expect.any(Number) },
        },
      })
      expect(session.agent.state.messages.some((message) => message.role === 'toolResult')).toBe(false)

      await session.agent.emit({
        type: 'tool_execution_end',
        toolCallId,
        toolName: 'run_subagent',
        result: {
          content: [{ type: 'text', text: 'completed' }],
          details: {
            sessionId: `${sessionId}:subagent:explore:1`,
            messages: partialMessages,
            tools,
            pendingToolCalls: [],
          },
        },
        isError: false,
      })

      const endedState = getSessionState(sessionId)
      expect(endedState.pendingToolCalls).not.toContain(toolCallId)
      expect(endedState.messages.filter((message) => message.role === 'toolResult' && message.toolCallId === toolCallId)).toHaveLength(1)

      session.agent.state.messages.push({
        role: 'toolResult',
        toolCallId,
        toolName: 'run_subagent',
        content: [{ type: 'text', text: 'completed' }],
        details: { sessionId: `${sessionId}:subagent:explore:1`, messages: partialMessages, tools, pendingToolCalls: [] },
        isError: false,
        timestamp: Date.now(),
      })
      const finalState = getSessionState(sessionId)
      expect(finalState.messages.filter((message) => message.role === 'toolResult' && message.toolCallId === toolCallId)).toHaveLength(1)
    } finally {
      await destroyAgent(sessionId)
    }
  })

  it('preserves the SSE state version when a persisted session is restored', async () => {
    const { createAgent, destroyAgent, getSessionState, restoreAgent } = await import('../../server/agent-manager.mjs')
    const sessionId = 'restored-state-version'
    const session = await createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
      idleRetention: 'always',
    })

    await session.agent.emit({ type: 'agent_start' })
    await session.agent.emit({ type: 'agent_end', messages: session.agent.state.messages })
    const versionBeforeDestroy = getSessionState(sessionId)?.stateVersion
    expect(versionBeforeDestroy).toBe(2)

    await destroyAgent(sessionId)
    const restored = await restoreAgent(sessionId)

    try {
      expect(restored?.stateVersion).toBe(versionBeforeDestroy)
      await restored?.agent.emit({ type: 'agent_start' })
      expect(getSessionState(sessionId)?.stateVersion).toBe(versionBeforeDestroy + 1)
    } finally {
      await destroyAgent(sessionId)
    }
  })
})
