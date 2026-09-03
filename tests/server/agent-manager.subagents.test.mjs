import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const mocks = vi.hoisted(() => {
  const logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  logger.child = vi.fn(() => logger)
  return {
    logger,
    streamSimpleWithAiHttpLogging: vi.fn(),
  }
})

class MockAgent {
  static instances = []
  static hangPrompts = false
  static hangAfterProgress = false
  static failAfterProgress = false
  static failNextConstruction = false
  static promptStarted = null
  static resolvePromptStarted = null

  static reset() {
    for (const instance of MockAgent.instances) instance.resolvePrompt?.()
    MockAgent.instances = []
    MockAgent.hangPrompts = false
    MockAgent.hangAfterProgress = false
    MockAgent.failAfterProgress = false
    MockAgent.failNextConstruction = false
    MockAgent.promptStarted = null
    MockAgent.resolvePromptStarted = null
  }

  static configureHangingPrompts() {
    MockAgent.hangPrompts = true
    MockAgent.hangAfterProgress = false
    MockAgent.failAfterProgress = false
    MockAgent.promptStarted = new Promise((resolve) => {
      MockAgent.resolvePromptStarted = resolve
    })
  }

  // 挂起前先产生一条带文本 + 未完成 toolCall 的 assistant 消息并触发 beforeToolCall，
  // 用于驱动超时错误摘要（toolCalls 计数 / still running / last assistant message）。
  static configureHangingWithProgress() {
    MockAgent.hangPrompts = true
    MockAgent.hangAfterProgress = true
    MockAgent.failAfterProgress = false
    MockAgent.promptStarted = new Promise((resolve) => {
      MockAgent.resolvePromptStarted = resolve
    })
  }

  // 产生同样的进度后让 prompt 以受控错误 reject，驱动"通用运行期失败也应携带
  // 终态 details（错误正文保持上游原文）"的用例。
  static configureFailingAfterProgress() {
    MockAgent.hangPrompts = false
    MockAgent.hangAfterProgress = false
    MockAgent.failAfterProgress = true
    MockAgent.promptStarted = new Promise((resolve) => {
      MockAgent.resolvePromptStarted = resolve
    })
  }

  async pushProgress() {
    await this.options.beforeToolCall?.({ toolCall: { id: 'sub-tool-1', name: 'read_file' }, args: { path: 'a.ts' } })
    const assistant = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Inspecting repository structure so far' },
        { type: 'toolCall', id: 'sub-tool-1', name: 'read_file', arguments: { path: 'a.ts' } },
      ],
      timestamp: Date.now(),
    }
    this.state.messages.push(assistant)
    this.state.pendingToolCalls = new Set(['sub-tool-1'])
    await this.emit({ type: 'message_end', message: assistant })
  }

  constructor(options = {}) {
    if (MockAgent.failNextConstruction) {
      MockAgent.failNextConstruction = false
      throw new TypeError('controlled agent construction failure')
    }
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
    this.abortCount = 0
    this.resolvePrompt = null
    this.streamFnInvoked = false
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async emit(event) {
    for (const listener of this.listeners) await listener(event)
  }

  async prompt() {
    if (!this.streamFnInvoked) {
      this.streamFnInvoked = true
      await this.options.streamFn?.(
        this.state.model,
        { systemPrompt: this.state.systemPrompt, messages: this.state.messages },
        { signal: this.signal },
      )
    }
    if (MockAgent.failAfterProgress) {
      await this.pushProgress()
      MockAgent.resolvePromptStarted?.(this)
      throw new Error('controlled subagent stream failure')
    }
    if (MockAgent.hangPrompts) {
      if (MockAgent.hangAfterProgress) await this.pushProgress()
      MockAgent.resolvePromptStarted?.(this)
      return new Promise((resolve) => {
        this.resolvePrompt = resolve
      })
    }

    const message = {
      role: 'assistant',
      content: [{ type: 'text', text: 'mock subagent completed' }],
      timestamp: Date.now(),
    }
    this.state.messages.push(message)
    for (const listener of this.listeners) listener({ type: 'message_end', message })
    for (const listener of this.listeners) listener({ type: 'agent_end', messages: this.state.messages })
  }

  abort() {
    this.abortCount += 1
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
vi.mock('../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: mocks.streamSimpleWithAiHttpLogging }))
vi.mock('../../server/utils/logger.mjs', () => ({ logger: mocks.logger }))
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

describe('agent manager subagent execution', () => {
  let tmpDir
  let previousDataDir
  let databaseModule

  beforeEach(async () => {
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-agent-manager-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    vi.resetModules()
    databaseModule = await import('../../server/sqlite/database.mjs')
    await databaseModule.initializeSqliteStorage()
    MockAgent.reset()
    for (const method of [mocks.logger.debug, mocks.logger.error, mocks.logger.info, mocks.logger.warn, mocks.logger.child]) method.mockReset()
    mocks.logger.child.mockImplementation(() => mocks.logger)
    mocks.streamSimpleWithAiHttpLogging.mockReset()
    mocks.streamSimpleWithAiHttpLogging.mockResolvedValue({})
  })

  afterEach(async () => {
    await databaseModule?.closeSqliteStorage().catch(() => {})
    vi.useRealTimers()
    MockAgent.reset()
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
      expect(mocks.streamSimpleWithAiHttpLogging).toHaveBeenCalledTimes(1)
      const [streamModel, streamContext, streamOptions] = mocks.streamSimpleWithAiHttpLogging.mock.calls[0]
      expect(streamModel).toBe(MockAgent.instances.at(-1).state.model)
      expect(streamContext).toMatchObject({ messages: expect.any(Array) })
      expect(streamOptions).toMatchObject({
        signal: expect.any(Object),
        quickforgeInternalLogContext: {
          parentSessionId: session.sessionId,
          subagentSessionId: result.details.sessionId,
          toolCallId: 'tool-call-1',
          subagent: 'explore',
          timeoutMs: 2 * 60 * 60 * 1000,
        },
      })
      const lifecycle = [...mocks.logger.info.mock.calls, ...mocks.logger.warn.mock.calls]
        .map(([, fields]) => fields)
        .filter((fields) => fields?.toolCallId === 'tool-call-1')
      expect(lifecycle.map((fields) => fields.lifecycleEvent)).toEqual(['started', 'completed'])
      for (const fields of lifecycle) {
        expect(fields).toMatchObject({
          parentSessionId: session.sessionId,
          subagentSessionId: result.details.sessionId,
          toolCallId: 'tool-call-1',
          subagent: 'explore',
          timeoutMs: 2 * 60 * 60 * 1000,
          durationMs: expect.any(Number),
          toolCalls: 0,
        })
        expect(JSON.stringify(fields)).not.toContain('Inspect the workspace.')
      }
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('caps runtime trace updates at the last 50 messages while the terminal result keeps the full list', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const streamedMessageCount = 60
    mocks.streamSimpleWithAiHttpLogging.mockImplementation(async () => {
      const agent = MockAgent.instances.at(-1)
      for (let index = 0; index < streamedMessageCount; index += 1) {
        const message = {
          role: 'assistant',
          content: [{ type: 'text', text: `trace-message-${index}` }],
          timestamp: Date.now(),
        }
        agent.state.messages.push(message)
        await agent.emit({ type: 'message_end', message })
      }
    })

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-trace-tail-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const updates = []
      const result = await runSubagent.execute(
        'tool-call-trace-tail',
        { subagent: 'explore', task: 'Inspect the workspace.' },
        new AbortController().signal,
        (partialResult) => updates.push(partialResult),
      )

      expect(updates.length).toBeGreaterThan(0)
      const finalUpdate = updates.at(-1)
      expect(finalUpdate.details.messages).toHaveLength(50)
      expect(finalUpdate.details.messagesTotal).toBe(streamedMessageCount + 1)
      expect(finalUpdate.details.messages[0].content[0].text).toBe(`trace-message-${streamedMessageCount - 49}`)
      expect(finalUpdate.details.messages.at(-1).content[0].text).toBe('mock subagent completed')
      expect(result.details.messages).toHaveLength(streamedMessageCount + 1)
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('logs one failed terminal event when subagent initialization fails after started', async () => {
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-initialization-failure', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      MockAgent.failNextConstruction = true
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      await expect(runSubagent.execute(
        'tool-call-init-failure',
        { subagent: 'explore', task: 'Inspect initialization.' },
        new AbortController().signal,
      )).rejects.toThrow('controlled agent construction failure')

      const lifecycle = [...mocks.logger.info.mock.calls, ...mocks.logger.warn.mock.calls]
        .map(([, fields]) => fields)
        .filter((fields) => fields?.toolCallId === 'tool-call-init-failure')
      expect(lifecycle.map((fields) => fields.lifecycleEvent)).toEqual(['started', 'failed'])
      expect(lifecycle.filter((fields) => fields.lifecycleEvent === 'failed')).toHaveLength(1)
      expect(lifecycle[1]).toMatchObject({
        parentSessionId: session.sessionId,
        subagentSessionId: expect.stringContaining(`${session.sessionId}:subagent:explore:`),
        subagent: 'explore',
        timeoutMs: 2 * 60 * 60 * 1000,
        outcome: 'error',
        errorName: 'TypeError',
      })
      expect(JSON.stringify(lifecycle)).not.toContain('controlled agent construction failure')
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('aborts a hanging subagent and reports the real 2-hour default timeout with structured progress', async () => {
    vi.useFakeTimers()
    MockAgent.configureHangingPrompts()
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-timeout-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const rejection = runSubagent.execute(
        'tool-call-timeout',
        { subagent: 'explore', task: 'Keep inspecting.' },
        new AbortController().signal,
      ).then(undefined, (error) => error)
      const subagent = await MockAgent.promptStarted

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)

      const error = await rejection
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Subagent explore timed out after 120 minutes. Progress before timeout: 0 tool calls.')
      expect(error.quickforgeSubagentDetails).toMatchObject({
        subagent: 'explore',
        toolCallId: 'tool-call-timeout',
        timedOut: true,
        toolCalls: 0,
        messages: [],
      })
      expect(subagent.abortCount).toBe(1)

      const afterToolCall = session.agent.options.afterToolCall
      expect(typeof afterToolCall).toBe('function')
      const injected = await afterToolCall({ toolCall: { id: 'tool-call-timeout', name: 'run_subagent' }, isError: true })
      expect(injected).toEqual({ details: expect.objectContaining({ timedOut: true, subagent: 'explore' }) })
      expect(await afterToolCall({ toolCall: { id: 'tool-call-timeout', name: 'run_subagent' }, isError: true })).toBeUndefined()
      expect(await afterToolCall({ toolCall: { id: 'other-tool', name: 'read_file' }, isError: true })).toBeUndefined()

      const lifecycle = mocks.logger.warn.mock.calls
        .map(([, fields]) => fields)
        .filter((fields) => fields?.toolCallId === 'tool-call-timeout')
      expect(lifecycle.map((fields) => fields.lifecycleEvent)).toEqual([
        'timeout_triggered',
        'settled_after_abort',
        'failed',
      ])
      expect(lifecycle[1]).toMatchObject({
        abortReason: 'timeout',
        waitAfterAbortMs: expect.any(Number),
        outcome: 'resolved',
      })
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('summarizes subagent progress and injects terminal details when timing out mid-tool', async () => {
    vi.useFakeTimers()
    MockAgent.configureHangingWithProgress()
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-timeout-progress-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const rejection = runSubagent.execute(
        'tool-call-progress',
        { subagent: 'explore', task: 'Inspect with progress.' },
        new AbortController().signal,
      ).then(undefined, (error) => error)
      const subagent = await MockAgent.promptStarted

      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000)

      const error = await rejection
      expect(error.message).toBe(
        'Subagent explore timed out after 120 minutes. Progress before timeout: 1 tool call; still running: read_file; last assistant message: Inspecting repository structure so far.',
      )
      expect(error.quickforgeSubagentDetails).toMatchObject({
        subagent: 'explore',
        toolCallId: 'tool-call-progress',
        timedOut: true,
        toolCalls: 1,
      })
      expect(error.quickforgeSubagentDetails.messages).toHaveLength(1)
      expect([...error.quickforgeSubagentDetails.pendingToolCalls]).toEqual(['sub-tool-1'])
      expect(subagent.abortCount).toBe(1)

      const injected = await session.agent.options.afterToolCall({ toolCall: { id: 'tool-call-progress', name: 'run_subagent' }, isError: true })
      expect(injected.details).toMatchObject({ timedOut: true, toolCalls: 1 })
      expect(injected.details.messages).toHaveLength(1)
      expect(injected.details.pendingToolCalls).toEqual(['sub-tool-1'])
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('formats singular and fractional timeout minutes through real subagent execution', async () => {
    vi.useFakeTimers()
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    const { createCustomAgentProfile } = await import('../../server/agent-profiles.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)
    await createCustomAgentProfile({
      name: 'one-minute-timeout',
      label: 'One Minute Timeout',
      systemPrompt: 'Wait.',
      allowedTools: ['read_file'],
      maxRuntimeMs: 60_000,
      enabledAsSubagent: true,
    })
    await createCustomAgentProfile({
      name: 'fractional-timeout',
      label: 'Fractional Timeout',
      systemPrompt: 'Wait.',
      allowedTools: ['read_file'],
      maxRuntimeMs: 90_000,
      enabledAsSubagent: true,
    })

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-readable-timeouts-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      for (const [subagentName, timeoutMs, expectedMessage] of [
        ['one-minute-timeout', 60_000, 'Subagent one-minute-timeout timed out after 1 minute.'],
        ['fractional-timeout', 90_000, 'Subagent fractional-timeout timed out after 1.5 minutes.'],
      ]) {
        MockAgent.configureHangingPrompts()
        const resultPromise = runSubagent.execute(
          `tool-call-${subagentName}`,
          { subagent: subagentName, task: 'Wait for timeout.' },
          new AbortController().signal,
        )
        const timeoutExpectation = expect(resultPromise).rejects.toThrow(expectedMessage)
        const subagent = await MockAgent.promptStarted

        await vi.advanceTimersByTimeAsync(timeoutMs)

        await timeoutExpectation
        expect(subagent.abortCount).toBe(1)
      }
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('attaches terminal details to generic subagent failures without changing the upstream error message', async () => {
    MockAgent.configureFailingAfterProgress()
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-generic-failure-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const error = await runSubagent.execute(
        'tool-call-generic-failure',
        { subagent: 'explore', task: 'Inspect until failure.' },
        new AbortController().signal,
      ).then(undefined, (caught) => caught)

      expect(error).toBeInstanceOf(Error)
      // 错误正文保持上游原文：前端 stripTerminalErrorFromTrace 依赖 errorMessage
      // 与 trace 终态错误文本精确相等来去重。
      expect(error.message).toBe('controlled subagent stream failure')
      expect(error.quickforgeSubagentDetails).toMatchObject({
        subagent: 'explore',
        toolCallId: 'tool-call-generic-failure',
        toolCalls: 1,
      })
      expect(error.quickforgeSubagentDetails.timedOut).toBeUndefined()
      expect(error.quickforgeSubagentDetails.aborted).toBeUndefined()
      expect(error.quickforgeSubagentDetails.messages).toHaveLength(1)
      expect(error.quickforgeSubagentDetails.pendingToolCalls).toEqual(['sub-tool-1'])

      const injected = await session.agent.options.afterToolCall({ toolCall: { id: 'tool-call-generic-failure', name: 'run_subagent' }, isError: true })
      expect(injected).toEqual({ details: expect.objectContaining({ subagent: 'explore', toolCalls: 1 }) })
      expect(await session.agent.options.afterToolCall({ toolCall: { id: 'tool-call-generic-failure', name: 'run_subagent' }, isError: true })).toBeUndefined()
    } finally {
      await destroyAgent(session.sessionId)
    }
  })

  it('aborts a hanging subagent with its parent run', async () => {
    MockAgent.configureHangingPrompts()
    const workspaceRoot = path.join(tmpDir, 'workspace')
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(workspaceRoot)

    const { createAgent, destroyAgent } = await import('../../server/agent-manager.mjs')
    const session = await createAgent('subagent-parent-abort-workspace', {
      scope: 'global',
      model: { provider: 'mock', model: 'mock-model' },
      systemPrompt: '',
      idleRetention: 'always',
    })
    const parentController = new AbortController()

    try {
      const runSubagent = session.agent.state.tools.find((tool) => tool.name === 'run_subagent')
      const resultPromise = runSubagent.execute(
        'tool-call-parent-abort',
        { subagent: 'explore', task: 'Keep inspecting.' },
        parentController.signal,
      )
      const rejection = resultPromise.then(undefined, (error) => error)
      const subagent = await MockAgent.promptStarted

      parentController.abort()

      const error = await rejection
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Subagent explore aborted with parent run. Progress before abort: 0 tool calls.')
      expect(error.quickforgeSubagentDetails).toMatchObject({
        subagent: 'explore',
        toolCallId: 'tool-call-parent-abort',
        aborted: true,
        toolCalls: 0,
        messages: [],
      })
      expect(error.quickforgeSubagentDetails.timedOut).toBeUndefined()

      const injected = await session.agent.options.afterToolCall({ toolCall: { id: 'tool-call-parent-abort', name: 'run_subagent' }, isError: true })
      expect(injected).toEqual({ details: expect.objectContaining({ aborted: true, subagent: 'explore' }) })
      expect(await session.agent.options.afterToolCall({ toolCall: { id: 'tool-call-parent-abort', name: 'run_subagent' }, isError: true })).toBeUndefined()

      expect(subagent.abortCount).toBe(1)
      const lifecycle = mocks.logger.warn.mock.calls
        .map(([, fields]) => fields)
        .filter((fields) => fields?.toolCallId === 'tool-call-parent-abort')
      expect(lifecycle.map((fields) => fields.lifecycleEvent)).toEqual([
        'parent_aborted',
        'settled_after_abort',
        'failed',
      ])
      expect(lifecycle[1]).toMatchObject({ abortReason: 'parent_abort', outcome: 'resolved' })
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
