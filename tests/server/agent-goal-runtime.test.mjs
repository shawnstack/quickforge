import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

// Keep the real Agent, manager, runner, tools and SQLite. Only the model stream
// and unrelated external integrations are replaced, as in the manager tests.
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
vi.mock('../../server/session-utils.mjs', () => ({
  buildSystemPrompt: vi.fn(async () => 'system prompt'),
  generateAiTitle: vi.fn(async () => null),
  generateTitle: vi.fn(() => 'New chat'),
}))

const PLAN = {
  action: 'plan',
  summary: 'Implement and verify.',
  criteria: [{ description: 'Tests pass', required: true }],
  scope: ['server/'],
}
const PLAN_END = 'Read-only planning finished.'
const toolCall = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args })
const text = (value) => ({ type: 'text', text: value })
const nextTick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

// This is the real Agent's AssistantMessageEventStream protocol, not a fake
// Agent lifecycle. The Agent itself emits tool/turn/agent events and executes
// the real registered tools. Every provider response is explicitly scripted.
function responseStream(model, content) {
  const message = {
    role: 'assistant', content,
    api: model.api, provider: model.provider, model: model.id,
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  }
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'start', partial: message }
      yield { type: 'done', reason: message.stopReason, message }
    },
    result: async () => message,
  }
}

describe('goal runtime with the real Agent and SQLite', () => {
  let tmpDir
  let previousDataDir
  let manager
  let repository
  let stateService
  let session
  let stream
  let releases
  let unsubscribe

  beforeEach(async () => {
    releases = []
    session = null
    unsubscribe = null
    previousDataDir = process.env.QUICKFORGE_DATA_DIR
    tmpDir = await mkdtemp(path.join(process.cwd(), '.goal-runtime-'))
    process.env.QUICKFORGE_DATA_DIR = path.join(tmpDir, 'data')
    await mkdir(path.join(tmpDir, 'workspace'))
    vi.resetModules()
    const { initializeSqliteStorage } = await import('../../server/sqlite/database.mjs')
    const { createSessionStateRepository } = await import('../../server/sqlite/session-state-repository.mjs')
    stateService = await import('../../server/session-state-service.mjs')
    const database = await initializeSqliteStorage({ databasePath: path.join(tmpDir, 'state.sqlite3') })
    repository = createSessionStateRepository(database)
    stateService.configureSessionStateService({ repository })
    const { setDefaultWorkspaceRoot } = await import('../../server/project-config.mjs')
    setDefaultWorkspaceRoot(path.join(tmpDir, 'workspace'))
    manager = await import('../../server/agent-manager.mjs')
    const { streamSimpleWithAiHttpLogging } = await import('../../server/ai-http-logger.mjs')
    stream = streamSimpleWithAiHttpLogging
    stream.mockReset()
    session = await manager.createAgent('goal-real-runtime', {
      scope: 'global',
      model: {
        provider: 'mock', id: 'scripted-model', api: 'openai-completions',
        contextWindow: 128_000, maxTokens: 4096,
      },
      systemPrompt: '', messages: [], title: 'Goal runtime',
    })
    const { Agent } = await import('@earendil-works/pi-agent-core')
    expect(session.agent).toBeInstanceOf(Agent)
  })

  afterEach(async () => {
    const errors = []
    try {
      // Abort before releasing gates so a failing assertion cannot launch retries.
      if (session) session.agent.abort()
      for (const release of releases) release()
      unsubscribe?.()
      if (session) {
        let idleSettled = false
        const idlePromise = session.agent.waitForIdle()
        void idlePromise.then(
          () => { idleSettled = true },
          () => { idleSettled = true },
        )
        // Use waitFor's bounded default instead of hanging on a stuck Agent.
        await vi.waitFor(() => expect(idleSettled).toBe(true))
        await idlePromise
        await vi.waitFor(() => {
          expect(session.goalRun ?? null).toBeNull()
          expect(Boolean(session.goalRunSettling)).toBe(false)
        })
      }
    } catch (error) {
      errors.push(error)
    } finally {
      // Attempt every cleanup step even if waiting or an earlier cleanup failed.
      for (const cleanup of [
        () => session && manager.destroyAgent(session.sessionId),
        () => vi.restoreAllMocks(),
        () => stateService.configureSessionStateService({ repository: null }),
        async () => {
          const { closeSqliteStorage } = await import('../../server/sqlite/database.mjs')
          await closeSqliteStorage()
        },
        () => {
          if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
          else process.env.QUICKFORGE_DATA_DIR = previousDataDir
        },
        () => rm(tmpDir, { recursive: true, force: true }),
      ]) {
        try {
          await cleanup()
        } catch (error) {
          errors.push(error)
        }
      }
    }
    // Do not replace the original wait/assertion error with a cleanup error.
    if (errors.length > 0) throw errors[0]
  })

  function gate() {
    const value = deferred()
    releases.push(value.resolve)
    return value
  }

  function script(steps) {
    const remaining = [...steps]
    stream.mockImplementation(async (model, context, options) => {
      const step = remaining.shift()
      if (!step) throw new Error('Unexpected extra model turn')
      const content = typeof step === 'function' ? await step(context, options) : step
      return responseStream(model, content)
    })
  }

  function executionMessages() {
    return session.agent.state.messages.filter((message) => message.metadata?.quickforgeGoalRun === 'execution')
  }

  function result(id) {
    return session.agent.state.messages.find((message) => message.role === 'toolResult' && message.toolCallId === id)
  }

  it.each(['planning', 'execution'])('persists a %s marker behind a non-tail/non-mid assistant through the real runner', async (kind) => {
    const runner = await import('../../server/agent-goal-runner.mjs')
    const { persistSession } = await import('../../server/agent-persistence.mjs')
    await runner.startGoalPlanning(session, 'Verify marker persistence')
    session.agent.state.messages = Array.from({ length: 5 }, (_, index) => ({ role: 'user', content: `old ${index}`, timestamp: index }))
    runner.beginGoalRun(session, 'planning')
    await runner.createGoalReportTool(session).execute('plan', PLAN)
    if (kind === 'execution') {
      // Settle planning without messages; keep its continuation suppressed.
      session.goalContinuationPending = true
      await runner.finishGoalRun(session, { status: 'idle' })
      session.goalContinuationPending = false
      runner.beginGoalRun(session, 'execution')
    }
    session.agent.state.messages.push(
      { role: 'user', content: 'current', timestamp: 5 },
      { role: 'assistant', content: 'done', timestamp: 6 },
      { role: 'toolResult', toolCallId: 'last', content: 'ok', timestamp: 7 },
    )
    await persistSession(session) // Simulates the manager's final message flush.
    expect((await stateService.readSessionStateValue(session.sessionId)).messages[6].details).toBeUndefined()
    session.goalContinuationPending = true
    await runner.finishGoalRun(session, { status: 'idle' })
    session.goalContinuationPending = false
    const stored = await stateService.readSessionStateValue(session.sessionId)
    expect(stored.messages[6].details.quickforgeGoalIteration).toMatchObject({ kind, iteration: kind === 'planning' ? 0 : 1, outcome: 'running' })
    expect(stored.messages[4].details).toBeUndefined()
    expect(stored.messages[7].details).toBeUndefined()
    expect(session.goal.usage.iterations).toBe(kind === 'planning' ? 0 : 1)
  })

  it.each(['planning', 'completed'].flatMap((kind) =>
    ['append', 'array', 'item', 'clear'].map((mutation) => [kind, mutation]),
  ))('saves current live history, not the %s snapshot, after unexpected %s during I/O', async (kind, mutation) => {
    const runner = await import('../../server/agent-goal-runner.mjs')
    const { persistSession } = await import('../../server/agent-persistence.mjs')
    await runner.startGoalPlanning(session, 'Protect live history')
    runner.beginGoalRun(session, 'planning')
    await runner.createGoalReportTool(session).execute('plan', PLAN)
    session.goalContinuationPending = true
    if (kind === 'completed') {
      await runner.finishGoalRun(session, { status: 'idle' })
      runner.beginGoalRun(session, 'execution')
      runner.recordGoalToolExecution(session, { toolCallId: 'read', toolName: 'read_file', isError: false, result: { content: [text('verified')] } })
      await runner.createGoalReportTool(session).execute('complete', {
        action: 'complete', summary: 'done',
        evidence: [{ id: 'e1', description: 'verified', toolCallId: 'read' }],
        criterionUpdates: [{ id: 'c1', status: 'passed', evidenceIds: ['e1'] }],
      })
    }
    session.agent.state.messages.push({ role: 'assistant', content: [text('settled result')], timestamp: 1 })
    await persistSession(session)
    const persistGate = gate()
    const persistEntered = gate()
    const save = stateService.saveSessionStatePair
    let staged
    const saving = vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      if (args.canPersist) {
        staged = args
        persistEntered.resolve()
        await persistGate.promise
      }
      return save(args)
    })
    const writes = vi.fn((...args) => repository.replaceMessages(...args))
    stateService.configureSessionStateService({ repository: { ...repository, replaceMessages: writes } })
    const finishing = runner.finishGoalRun(session, { status: 'idle' })
    await persistEntered.promise
    if (mutation === 'append') session.agent.state.messages.push({ role: 'user', content: [text('new message')], timestamp: 2 })
    if (mutation === 'array') session.agent.state.messages = [...session.agent.state.messages]
    if (mutation === 'item') session.agent.state.messages[0] = { role: 'user', content: [text('replaced history')], timestamp: 3 }
    if (mutation === 'clear') session.agent.state.messages = []
    const live = session.agent.state.messages
    const contents = live.map((message) => message.content)
    const allowed = staged.canPersist()
    persistGate.resolve()
    await finishing
    session.goalContinuationPending = false
    expect(allowed).toBe(false)
    expect(session.agent.state.messages).toBe(live)
    expect(live.map((message) => message.content)).toEqual(contents)
    const stored = await stateService.readSessionStateValue(session.sessionId)
    expect(stored.goal).toMatchObject({ status: 'paused', blocker: 'persist_failed' })
    expect(stored.messages).toEqual(live)
    expect(saving).toHaveBeenCalledTimes(2)
    // The real service must recheck canPersist after the gate and before SQLite:
    // only the paused/live fallback is dispatched, never the invalid success pair.
    expect(writes).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
  })

  it.each(['/skill', '/clear'])('rejects %s before it can mutate messages during staged planning persistence', async (prompt) => {
    const runner = await import('../../server/agent-goal-runner.mjs')
    const persistGate = gate()
    const persistEntered = gate()
    const save = stateService.saveSessionStatePair
    await runner.startGoalPlanning(session, 'Protect settlement messages')
    runner.beginGoalRun(session, 'planning')
    session.agent.state.messages.push({ role: 'assistant', content: [text('plan result')], timestamp: 1 })
    await runner.createGoalReportTool(session).execute('plan', PLAN)
    vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      if (args.canPersist && args.state.goal?.status === 'running') {
        persistEntered.resolve()
        await persistGate.promise
      }
      return save(args)
    })
    // Suppress only scheduling; exercise the real manager and durable staged save.
    session.goalContinuationPending = true
    const finishing = runner.finishGoalRun(session, { status: 'idle' })
    await persistEntered.promise
    const live = session.agent.state.messages
    expect(session.goalRunSettling).toBe(true)
    expect(session.agent.state.isStreaming).toBe(false)
    let response
    const prompting = manager.runPrompt(session.sessionId, prompt).then(() => { response = null }, (error) => { response = error })
    try {
      await vi.waitFor(() => expect(response).toMatchObject({ statusCode: 409, errorCode: 'GENERATION_ALREADY_RUNNING' }))
    } finally {
      persistGate.resolve()
      await Promise.all([finishing, prompting])
      session.goalContinuationPending = false
    }
    expect(session.agent.state.messages.map((message) => message.content)).toEqual(live.map((message) => message.content))
    const stored = await stateService.readSessionStateValue(session.sessionId)
    expect(stored.messages).toEqual(session.agent.state.messages)
    expect(stored.goal.status).toBe('running')
    expect(stream).not.toHaveBeenCalled()
  })

  it.each([
    ['blocked', 'persist-first'],
    ['needs_review', 'prompt-first'],
  ])('rejects planning %s and starts execution once after both barriers (%s)', async (action, order) => {
    const endGate = gate()
    const persistGate = gate()
    const executionGate = gate()
    const endEntered = gate()
    const persistEntered = gate()
    const executionEntered = gate()
    let finalSaveFinished = false
    let promptSettled = false
    let endStreaming = null
    let planningPromise
    let starts = 0
    const save = stateService.saveSessionStatePair
    vi.spyOn(stateService, 'saveSessionStatePair').mockImplementation(async (args) => {
      const isPlanningEnd = args.state.taskStatus === 'idle'
        && args.state.goal?.status === 'awaiting_confirmation'
        && args.state.messages.some((message) => message.content?.some?.((part) => part.text === PLAN_END))
      if (isPlanningEnd) {
        persistEntered.resolve()
        await persistGate.promise
      }
      const saved = await save(args)
      if (isPlanningEnd) finalSaveFinished = true
      return saved
    })
    unsubscribe = session.agent.subscribe(async (event) => {
      if (event.type === 'agent_start') starts += 1
      if (event.type !== 'agent_end' || session.goalRun?.kind !== 'planning') return
      // pi-agent-core intentionally stays streaming until awaited end listeners
      // return. Never set isStreaming manually or await prompt inside this hook.
      endStreaming = session.agent.state.isStreaming
      planningPromise = session.activePromptPromise
      planningPromise.then(() => { promptSettled = true })
      endEntered.resolve()
      await endGate.promise
    })
    script([
      [toolCall('plan', 'goal_report', PLAN)],
      [toolCall('wait-confirmation', 'goal_report', {
        action, summary: 'Waiting for plan confirmation.', blocker: 'Please confirm the plan.',
      })],
      [text(PLAN_END)],
      async () => {
        executionEntered.resolve()
        await executionGate.promise
        return [text('Execution stopped by test cleanup.')]
      },
    ])

    await manager.runPrompt(session.sessionId, '/goal Implement the requested change')
    await Promise.all([endEntered.promise, persistEntered.promise])
    expect(endStreaming).toBe(true)
    expect(result('plan').isError).toBe(false)
    expect(result('wait-confirmation').isError).toBe(true)
    expect(result('wait-confirmation').content[0].text).toMatch(/planning|plan is already submitted/i)
    expect(session.goal).toMatchObject({ status: 'awaiting_confirmation', planConfirmed: false })
    expect(repository.findBySessionId(session.sessionId).state.goal.status).toBe('awaiting_confirmation')
    expect(finalSaveFinished).toBe(false)
    expect(promptSettled).toBe(false)
    expect(executionMessages()).toHaveLength(0)
    expect(starts).toBe(1)

    if (order === 'persist-first') {
      persistGate.resolve()
      await vi.waitFor(() => expect(finalSaveFinished).toBe(true))
      expect(session.agent.state.isStreaming).toBe(true)
      expect(promptSettled).toBe(false)
      expect(executionMessages()).toHaveLength(0)
      expect(starts).toBe(1)
      endGate.resolve()
    } else {
      endGate.resolve()
      await planningPromise
      await nextTick()
      expect(session.agent.state.isStreaming).toBe(false)
      expect(promptSettled).toBe(true)
      expect(finalSaveFinished).toBe(false)
      expect(executionMessages()).toHaveLength(0)
      expect(starts).toBe(1)
      persistGate.resolve()
    }

    await executionEntered.promise
    // Keep the first execution open: terminal paused/no_progress is not proof
    // that auto-start succeeded exactly once or retained its command ownership.
    await nextTick()
    expect(promptSettled).toBe(true)
    expect(finalSaveFinished).toBe(true)
    expect(session.agent.state.isStreaming).toBe(true)
    expect(session.goalRun).toMatchObject({ kind: 'execution' })
    expect(session.activeCommandName).toBe('goal')
    expect(session.goal).toMatchObject({ status: 'running', planConfirmed: true, usage: { iterations: 1 } })
    const stored = await stateService.readSessionStateValue(session.sessionId)
    expect(stored.goal).toMatchObject({ status: 'running', planConfirmed: true })
    expect(stored.messages.some((message) => message.content?.some?.((part) => part.text === PLAN_END))).toBe(true)
    expect(executionMessages()).toHaveLength(1)
    expect(starts).toBe(2)
    expect(stream).toHaveBeenCalledTimes(4)
    expect(session.agent.state.errorMessage).toBeUndefined()
  })

  it('does not answer or skip a necessary planning question and continues after the user answers', async () => {
    const executionGate = gate()
    const executionEntered = gate()
    const { getPendingAskForSession } = await import('../../server/ask-store.mjs')
    script([
      [toolCall('question', 'ask_user', { questions: [{ question: 'Which target platform?', options: [{ label: 'Windows' }] }] })],
      [toolCall('plan', 'goal_report', PLAN)],
      [text(PLAN_END)],
      async () => {
        executionEntered.resolve()
        await executionGate.promise
        return [text('Execution stopped by test cleanup.')]
      },
    ])
    await manager.runPrompt(session.sessionId, '/goal Implement the requested change')
    await vi.waitFor(() => {
      expect(getPendingAskForSession(session.sessionId)).not.toBeNull()
      // Planning retains its read-only status; the real pending ask is the gate.
      expect(session.goal.status).toBe('planning')
    })
    const pending = getPendingAskForSession(session.sessionId)
    await nextTick()
    expect(getPendingAskForSession(session.sessionId)).toEqual(pending)
    expect(session.agent.state.isStreaming).toBe(true)
    expect(session.agent.state.pendingToolCalls.has('question')).toBe(true)
    expect(result('question')).toBeUndefined()
    expect(stream).toHaveBeenCalledTimes(1)
    expect(executionMessages()).toHaveLength(0)

    expect(manager.answerAsk(session.sessionId, pending.askId, { answers: [{ choices: ['Windows'] }] }).answered).toBe(true)
    await executionEntered.promise
    expect(result('question')).toMatchObject({ isError: false, details: { skipped: false, answers: [{ choices: ['Windows'] }] } })
    expect(getPendingAskForSession(session.sessionId)).toBeNull()
    expect(session.goalRun).toMatchObject({ kind: 'execution' })
    expect(session.agent.state.isStreaming).toBe(true)
    expect(executionMessages()).toHaveLength(1)
    expect(session.goal.usage.iterations).toBe(1)
    expect(stream).toHaveBeenCalledTimes(4)
  })
})
