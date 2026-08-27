import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

class MockAgent {
  static instances = []
  static hangPrompts = false
  static promptStarted = null
  static resolvePromptStarted = null

  static reset() {
    for (const instance of MockAgent.instances) instance.resolvePrompt?.()
    MockAgent.instances = []
    MockAgent.hangPrompts = false
    MockAgent.promptStarted = null
    MockAgent.resolvePromptStarted = null
  }

  static configureHangingPrompts() {
    MockAgent.hangPrompts = true
    MockAgent.promptStarted = new Promise((resolve) => {
      MockAgent.resolvePromptStarted = resolve
    })
  }

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
    this.resolvePrompt = null
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async prompt() {
    if (MockAgent.hangPrompts) {
      MockAgent.resolvePromptStarted?.(this)
      return new Promise((resolve) => {
        this.resolvePrompt = resolve
      })
    }

    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'mock completion' }],
      timestamp: Date.now(),
    }
    this.state.messages.push(message)
    for (const listener of this.listeners) await listener({ type: 'message_end', message })
    for (const listener of this.listeners) await listener({ type: 'agent_end', messages: this.state.messages })
  }

  abort() {
    const resolvePrompt = this.resolvePrompt
    this.resolvePrompt = null
    resolvePrompt?.()
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
vi.mock('../../server/channels/event-relay.mjs', () => ({
  publishChannelSessionChanged: vi.fn(async () => true),
}))

function assistantText(message) {
  if (typeof message?.content === 'string') return message.content
  return Array.isArray(message?.content)
    ? message.content.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n')
    : ''
}

function lastAssistant(session) {
  const messages = session.agent.state.messages
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index]
  }
  return null
}

describe('slash /skill, /agent, and /commit command state', () => {
  let tmpDir
  let previousDataDir
  let previousHome
  let previousUserProfile
  let databaseModule

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-slash-skill-agent-'))
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    previousHome = process.env.HOME
    previousUserProfile = process.env.USERPROFILE
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    process.env.HOME = tmpDir
    process.env.USERPROFILE = tmpDir
    MockAgent.reset()
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    MockAgent.reset()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = previousUserProfile
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function enableGlobalSkill(name) {
    const { atomicProjectConfigUpdate } = await import('../../server/storage.mjs')
    await atomicProjectConfigUpdate((config) => {
      config.globalSkills = [name]
      return config
    })
  }

  async function createSession(sessionId, options = {}) {
    const { createAgent } = await import('../../server/agent-manager.mjs')
    return createAgent(sessionId, {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
      ...options,
    })
  }

  it('resolves /commit with its strict command permissions and concise prompt', async () => {
    MockAgent.configureHangingPrompts()
    const workspaceRoot = path.join(tmpDir, 'commit-workspace')
    await mkdir(workspaceRoot, { recursive: true })
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)
    const session = await createSession('slash-commit-success')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/commit feat: add slash commit')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('commit')
      expect(session.activeCommandPermissions).toEqual({ allowEdit: false, allowCommands: true, allowSubagents: false })
      expect(session.activeCommandPrompt).toContain('<commit_command_invocation name="commit">')
      expect(session.activeCommandPrompt).toContain('commit only files related to this task')
      expect(session.activeCommandPrompt).toContain('Never use `git add .`, `git add -A`, or `git add --all`')
      expect(session.activeCommandPrompt).toContain('Run relevant validation before committing and stop if it fails')
      expect(session.activeCommandPrompt).toContain('Do not modify code, bypass hooks, or alter unrelated changes')
      expect(session.activeCommandPrompt).toContain('Create at most one local commit')
      expect(session.activeCommandPrompt).toContain('Do not push, tag, release, publish')
      expect(session.activeCommandPrompt).toContain('Report the commit hash and message, validations run, and any remaining working tree changes')
      expect(session.activeCommandPrompt).toContain('Requested commit message:\nfeat: add slash commit')
      expect(session.activeCommandPrompt.split('\n').length).toBeLessThan(25)
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('lets /commit generate a message when none is supplied', async () => {
    MockAgent.configureHangingPrompts()
    const workspaceRoot = path.join(tmpDir, 'commit-workspace-no-message')
    await mkdir(workspaceRoot, { recursive: true })
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)
    const session = await createSession('slash-commit-no-message')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/commit')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('commit')
      expect(session.activeCommandPrompt).toContain('generate a message from the diff and repository style')
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('resolves /skill into a skill command prompt without command permissions', async () => {
    await enableGlobalSkill('skill-creator')
    MockAgent.configureHangingPrompts()
    const session = await createSession('slash-skill-success')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/skill skill-creator build a docs skill')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('skill')
      expect(session.activeCommandPermissions).toBeNull()
      expect(session.activeCommandPrompt).toContain('<skill_invocation name="skill-creator" source="slash">')
      expect(session.activeCommandPrompt).toContain('activate_skill tool with name="skill-creator"')
      expect(session.activeCommandPrompt).toContain('Task:\nbuild a docs skill')
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('allows /skill without a task and asks the model to clarify after activation', async () => {
    await enableGlobalSkill('skill-creator')
    MockAgent.configureHangingPrompts()
    const session = await createSession('slash-skill-no-task')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/skill skill-creator')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('skill')
      expect(session.activeCommandPrompt).toMatch(/Task:\n\(none [^\n]*ask the user[^\n]*\)\n/)
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('reports usage and enabled skills when /skill has no name', async () => {
    await enableGlobalSkill('skill-creator')
    const session = await createSession('slash-skill-usage')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/skill')

      const text = assistantText(lastAssistant(session))
      expect(text).toBe('Usage: /skill <name> [task]\n\nEnabled skills: skill-creator.')
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('reports no enabled skills when the session has none selected', async () => {
    const session = await createSession('slash-skill-none')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/skill')

      const text = assistantText(lastAssistant(session))
      expect(text).toBe('Usage: /skill <name> [task]\n\nNo skills are currently enabled.')
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('rejects /skill for an unknown or disabled skill', async () => {
    await enableGlobalSkill('skill-creator')
    const session = await createSession('slash-skill-unknown')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/skill missing-skill do something')

      const text = assistantText(lastAssistant(session))
      expect(text).toBe([
        'Unknown or disabled skill: missing-skill',
        '',
        'Usage: /skill <name> [task]',
        '',
        'Enabled skills: skill-creator.',
      ].join('\n'))
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('resolves /agent into a subagent command prompt without command permissions', async () => {
    MockAgent.configureHangingPrompts()
    const session = await createSession('slash-agent-success')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/agent explore inspect the repository')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('agent')
      expect(session.activeCommandPermissions).toBeNull()
      expect(session.activeCommandPrompt).toContain('<subagent_invocation name="explore" source="slash">')
      expect(session.activeCommandPrompt).toContain('run_subagent tool with subagent="explore"')
      expect(session.activeCommandPrompt).toContain('Task:\ninspect the repository')
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('reports usage and available subagents when /agent has no name', async () => {
    const session = await createSession('slash-agent-usage')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/agent')

      const text = assistantText(lastAssistant(session))
      expect(text).toMatch(/^Usage: \/agent <name> <task>\n\nAvailable subagents: [^\n]+\.$/)
      expect(text).toContain('explore')
      expect(text).toContain('general')
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('requires a task when /agent has only a name', async () => {
    const session = await createSession('slash-agent-no-task')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/agent explore')

      expect(assistantText(lastAssistant(session))).toBe('Usage: /agent <name> <task>')
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('rejects /agent for an unknown subagent', async () => {
    const session = await createSession('slash-agent-unknown')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/agent nope do stuff')

      const text = assistantText(lastAssistant(session))
      expect(text).toMatch(/^Unknown subagent: nope\n\nUsage: \/agent <name> <task>\n\nAvailable subagents: [^\n]+\.$/)
      expect(text).toContain('explore')
    } finally {
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })

  it('resolves project-level agent profiles from the session workspace root', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    await mkdir(path.join(workspaceRoot, '.claude', 'agents'), { recursive: true })
    await writeFile(
      path.join(workspaceRoot, '.claude', 'agents', 'qf-slash-researcher.md'),
      [
        '---',
        'name: qf-slash-researcher',
        'description: Test researcher profile',
        'enabled-as-subagent: true',
        'tools: read_file, grep_files',
        '---',
        'You research things carefully.',
        '',
      ].join('\n'),
      'utf8',
    )
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    MockAgent.configureHangingPrompts()
    const session = await createSession('slash-agent-project-profile')

    try {
      const { runPrompt } = await import('../../server/agent-manager.mjs')
      await runPrompt(session.sessionId, '/agent qf-slash-researcher find all call sites')
      await MockAgent.promptStarted

      expect(session.activeCommandName).toBe('agent')
      expect(session.activeCommandPrompt).toContain('<subagent_invocation name="qf-slash-researcher" source="slash">')
      expect(session.activeCommandPrompt).toContain('Task:\nfind all call sites')
    } finally {
      MockAgent.instances.at(-1)?.resolvePrompt?.()
      const { destroyAgent } = await import('../../server/agent-manager.mjs')
      await destroyAgent(session.sessionId)
    }
  })
})
