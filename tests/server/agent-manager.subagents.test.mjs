import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

class MockAgent {
  constructor(options = {}) {
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
})
