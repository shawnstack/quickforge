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
      isStreaming: true,
    }
    this.listeners = new Set()
    this.signal = new AbortController().signal
    this.abort = vi.fn()
    this.waitForIdle = vi.fn(() => new Promise(() => {}))
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
vi.mock('../../server/channels/event-relay.mjs', () => ({
  publishChannelSessionChanged: vi.fn(async () => true),
}))

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

async function waitFor(predicate, { timeoutMs = 5000 } = {}) {
  // Date/setImmediate stay real under the fake-timer config used here, so real
  // child-process exit / taskkill / fs I/O can settle while setTimeout stays faked.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setImmediate(resolve))
  }
  return predicate()
}

describe('agent manager idle eviction with background commands', () => {
  let tmpDir
  let previousDataDir

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-bg-idle-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    MockAgent.instances = []
    vi.resetModules()
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previousDataDir
    await rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {})
    vi.restoreAllMocks()
  })

  it('spares an idle session from eviction while a background command runs, and evicts it after the command exits', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent, getSessionStatus } = await import('../../server/agent-manager.mjs')
    const { abortRunningCommand, listBackgroundCommandTasks, toolRunCommand } = await import('../../server/tools/index.mjs')

    const sessionOptions = { scope: 'global', model: { provider: 'mock', id: 'mock-model' }, systemPrompt: '' }
    const bgSessionId = 'bg-idle-session'
    const plainSessionId = 'plain-idle-session'
    await createAgent(bgSessionId, sessionOptions)
    await createAgent(plainSessionId, sessionOptions)

    const result = await toolRunCommand({
      command: 'node -e "setInterval(() => {}, 1000)"',
      run_in_background: true,
    }, { workspaceRoot: path.join(tmpDir, 'workspace'), sessionId: bgSessionId }, { toolCallId: 'tool-bg-idle' })
    expect(result.details.background).toBe(true)
    expect(listBackgroundCommandTasks(bgSessionId)).toHaveLength(1)
    expect(getSessionStatus(plainSessionId)).not.toBeNull()

    // Multiple idle windows must not evict the session while the command runs,
    // while a session without background commands is still evicted.
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1000)
    expect(getSessionStatus(bgSessionId)).not.toBeNull()
    expect(getSessionStatus(plainSessionId)).toBeNull()
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS)
    expect(getSessionStatus(bgSessionId)).not.toBeNull()

    // Once the command is stopped and exits, eviction resumes.
    expect(abortRunningCommand('tool-bg-idle')).toBe(true)
    expect(await waitFor(() => listBackgroundCommandTasks(bgSessionId).length === 0)).toBe(true)
    await vi.advanceTimersByTimeAsync(IDLE_TIMEOUT_MS + 1000)
    expect(await waitFor(() => getSessionStatus(bgSessionId) === null)).toBe(true)
  })

  it('still stops background commands when the session is explicitly destroyed', async () => {
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const { listBackgroundCommandTasks, toolRunCommand } = await import('../../server/tools/index.mjs')

    const sessionId = 'bg-explicit-destroy'
    await createAgent(sessionId, { scope: 'global', model: { provider: 'mock', id: 'mock-model' }, systemPrompt: '' })

    await toolRunCommand({
      command: 'node -e "setInterval(() => {}, 1000)"',
      run_in_background: true,
    }, { workspaceRoot: path.join(tmpDir, 'workspace'), sessionId }, { toolCallId: 'tool-bg-destroy' })
    expect(listBackgroundCommandTasks(sessionId)).toHaveLength(1)

    await destroyAgent(sessionId)
    expect(await waitFor(() => listBackgroundCommandTasks(sessionId).length === 0)).toBe(true)
  })
})
