import { beforeEach, describe, expect, it, vi } from 'vitest'

// 工具装配里两块能脱离真实工具集单独验的逻辑：
//   1) turnId 访问器必须**活着**（每次读都取当前值），不能在建上下文时被求值固化；
//   2) 目标工具必须按「会话引擎 + 目标阶段」挂载，否则 v1 的 goal_report 会漏进
//      v2 会话，模型的完成报告会被一路拒绝而轮次驱动还在排下一轮。
const mocks = vi.hoisted(() => ({
  activeGoalStatus: vi.fn(),
  createGoalReportTool: vi.fn(),
  createGoalControlTools: vi.fn(),
  currentSessionTurnId: vi.fn(),
  deliverBackgroundCommandNotification: vi.fn(),
  agentSessions: new Map(),
}))

vi.mock('../../server/agent-session-store.mjs', () => ({ agentSessions: mocks.agentSessions }))
vi.mock('../../server/agent-subagent-runner.mjs', () => ({ runSubagent: vi.fn() }))
vi.mock('../../server/agent-workflow-runner.mjs', () => ({ runWorkflow: vi.fn() }))
vi.mock('../../server/agent-approval-orchestrator.mjs', () => ({ createAskUserPromise: vi.fn() }))
vi.mock('../../server/tools/index.mjs', () => ({ loadSkillToolContext: vi.fn(async () => ({ globalSkills: [], projectSkills: [] })) }))
vi.mock('../../server/tools/definitions.mjs', () => ({
  createSkillTools: vi.fn(async () => []),
  globalMemoryTool: { name: 'global_memory' },
  memoryNoteTools: [],
  workspaceTools: [],
}))
vi.mock('../../server/mcp/registry.mjs', () => ({ createMcpToolDefinitions: vi.fn(async () => []) }))
vi.mock('../../server/plugins/registry.mjs', () => ({ createPluginToolDefinitions: vi.fn(async () => []) }))
vi.mock('../../server/skills.mjs', () => ({ mergeSkills: vi.fn(() => []) }))
vi.mock('../../server/global-memory.mjs', () => ({ isGlobalMemoryEnabled: vi.fn(async () => false) }))
vi.mock('../../server/working-memory.mjs', () => ({ isWorkingMemoryEnabled: vi.fn(async () => false) }))
vi.mock('../../server/tool-wiring.mjs', () => ({
  wrapToolDefinition: vi.fn((definition) => definition),
  wrapMcpToolDefinition: vi.fn((definition) => definition),
  wrapPluginToolDefinition: vi.fn((definition) => definition),
  sessionSkillsContext: vi.fn(() => ({})),
}))
vi.mock('../../server/approval-store.mjs', () => ({ createCommandToolPermissions: vi.fn(() => ({})) }))
vi.mock('../../server/goal/engine.mjs', () => ({
  activeGoalStatus: mocks.activeGoalStatus,
  createGoalReportTool: mocks.createGoalReportTool,
  createGoalControlTools: mocks.createGoalControlTools,
}))
vi.mock('../../server/agent-turn-ids.mjs', () => ({ currentSessionTurnId: mocks.currentSessionTurnId }))
vi.mock('../../server/agent-background-commands.mjs', () => ({
  deliverBackgroundCommandNotification: mocks.deliverBackgroundCommandNotification,
}))

const { attachTurnIdGetter, appendGoalTools } = await import('../../server/agent-tool-assembly.mjs')

describe('attachTurnIdGetter', () => {
  it('returns the same context object', () => {
    const context = { a: 1 }

    expect(attachTurnIdGetter(context, () => 'turn-1')).toBe(context)
  })

  it('keeps the getter live instead of freezing the value at build time', () => {
    let turn = null
    const context = { a: 1 }

    attachTurnIdGetter(context, () => turn)

    expect(context.turnId).toBeNull()

    // 这一条是那个坑本身：用对象展开会把 getter 求值并固化成普通属性。
    turn = 'turn-2'
    expect(context.turnId).toBe('turn-2')
  })

  it('normalizes a falsy getter result to null', () => {
    const context = attachTurnIdGetter({}, () => undefined)

    expect(context.turnId).toBeNull()
  })

  it('leaves the context untouched when no getter is supplied', () => {
    const context = { a: 1 }

    expect(attachTurnIdGetter(context, null)).toBe(context)
    expect(Object.prototype.hasOwnProperty.call(context, 'turnId')).toBe(false)
  })

  it('defines the property as enumerable so it survives serialization of the context', () => {
    const context = attachTurnIdGetter({ a: 1 }, () => 'turn-1')

    expect(Object.keys(context)).toContain('turnId')
  })
})

describe('appendGoalTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeGoalStatus.mockReturnValue(null)
    mocks.createGoalReportTool.mockReturnValue(null)
    mocks.createGoalControlTools.mockReturnValue([])
  })

  function makeSession(overrides = {}) {
    // 不带 source（或 source === 'scheduled'）才会挂目标工具；其它来源一律跳过。
    return {
      sessionId: 'session-1',
      goalEngine: 'legacy',
      goal: null,
      agent: { state: { tools: [{ name: 'existing' }] } },
      ...overrides,
    }
  }

  it('ignores a missing session', () => {
    expect(() => appendGoalTools(null)).not.toThrow()
    expect(mocks.createGoalReportTool).not.toHaveBeenCalled()
  })

  it('skips sessions that carry another source', () => {
    const session = makeSession({ source: 'subagent' })

    appendGoalTools(session)

    expect(mocks.createGoalReportTool).not.toHaveBeenCalled()
    expect(mocks.createGoalControlTools).not.toHaveBeenCalled()
  })

  it('runs for scheduled sessions', () => {
    const session = makeSession({ source: 'scheduled' })
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })
    mocks.createGoalReportTool.mockReturnValue({ name: 'goal_report' })

    appendGoalTools(session)

    expect(session.agent.state.tools).toContainEqual({ name: 'goal_report' })
  })

  it('bails out when the session has no tool array', () => {
    const session = makeSession({ agent: { state: {} } })

    expect(() => appendGoalTools(session)).not.toThrow()
    expect(mocks.createGoalReportTool).not.toHaveBeenCalled()
  })

  it('mounts the legacy report tool while a goal is active', () => {
    const session = makeSession()
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })
    mocks.createGoalReportTool.mockReturnValue({ name: 'goal_report' })

    appendGoalTools(session)

    expect(mocks.createGoalReportTool).toHaveBeenCalledWith(session)
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(['existing', 'goal_report'])
  })

  it('does not stack a tool that is already mounted', () => {
    const session = makeSession({ agent: { state: { tools: [{ name: 'goal_report' }] } } })
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })
    mocks.createGoalReportTool.mockReturnValue({ name: 'goal_report' })

    appendGoalTools(session)

    expect(session.agent.state.tools).toHaveLength(1)
  })

  it('skips the report tool entirely when the engine yields none (v2 sessions)', () => {
    const session = makeSession()
    mocks.activeGoalStatus.mockReturnValue({ status: 'running' })
    mocks.createGoalReportTool.mockReturnValue(null)

    appendGoalTools(session)

    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(['existing'])
  })

  it('does not even consult the report tool when no goal is active', () => {
    const session = makeSession()

    appendGoalTools(session)

    expect(mocks.createGoalReportTool).not.toHaveBeenCalled()
  })

  it('mounts v2 control tools whenever the engine or the goal phase says v2', () => {
    const byEngine = makeSession({ goalEngine: 'v2' })
    const byPhase = makeSession({ goal: { phase: 'executing' } })
    mocks.createGoalControlTools.mockReturnValue([{ name: 'create_goal' }, { name: 'existing' }])

    appendGoalTools(byEngine)
    appendGoalTools(byPhase)

    for (const session of [byEngine, byPhase]) {
      expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(['existing', 'create_goal'])
    }
  })

  it('leaves legacy sessions without control tools', () => {
    const session = makeSession()

    appendGoalTools(session)

    expect(mocks.createGoalControlTools).not.toHaveBeenCalled()
  })
})
