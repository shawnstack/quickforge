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

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: MockAgent }))
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
})
