import { describe, expect, it } from 'vitest'
import * as agentManager from '../../server/agent-manager.mjs'
import { agentSessions } from '../../server/agent-session-store.mjs'

// agent-manager 模块拆分（agent-manager-module-split）的导出面契约：
// 拆分全程 agent-manager.mjs 作为 facade re-export 同名符号，消费方零改动。
// 本清单锁定导出符号集合——任何增删都必须是拆分完成后的显式决策，不允许悄悄变化。
const EXPECTED_EXPORTS = [
  'abortRun',
  'abortToolCall',
  'agentEvents',
  'answerAsk',
  'appendAssistantErrorMessageOnce',
  'approveAutoCompact',
  'approveToolCall',
  'canApplyGeneratedTitle',
  'continueSession',
  'createAgent',
  'destroyAgent',
  'followUpAgent',
  'getPendingAskForSession',
  'getSessionEventBus',
  'getSessionState',
  'getSessionStatus',
  'isSessionFileRollbackBusy', // rollback uses actual runtime state, not UI-masked streaming
  'isSseConnected',
  'listSessions',
  'markLatestAssistantProcessFinished',
  'normalizeAskQuestions',
  'persistSessionState',
  'refreshAllSessionModels',
  'refreshAllSessionTools',
  'rejectAutoCompact',
  'rejectToolCall',
  'releaseSse',
  'resetStaleTaskStatuses',
  'restoreAgent',
  'rollbackSessionMessages',
  'rollbackStartIndexFromMessage',
  'runPrompt',
  'shutdown',
  'steerAgent',
  'stripSplitSessionState',
  'syncSessionFromStorage',
  'touchSession',
  'tryAcquireSse',
  'updateSessionAccessMode',
  'updateSessionModel',
  'updateSessionThinkingLevel',
  'updateSessionTitle',
  'updateSessionYoloMode',
]

// 内部共享导出（拆分期间临时暴露给被抽出模块使用，随对应块迁移后收回）。
// 增删任何内部共享导出都必须显式更新本清单并说明理由。
const INTERNAL_SHARED_EXPORTS = [
  'resetIdleTimer', // agent-compaction 使用
  'createServerTools', // agent-subagent-runner 使用；工具构建块迁移后收回
  'currentSessionTurnId', // agent-subagent-runner 透传父会话当前轮 turnId（轮级撤销）
  'attachTurnIdGetter', // toolContext 活 turnId 访问器（轮级撤销写盘归因）；供 context-references 行为断言
  'hasFullAccess', // agent-subagent-runner 临时 subagent 能力策略检查使用（原 agent-harness.mjs 删除后迁回）
]

describe('agent-manager export contract (module split safety net)', () => {
  it('rollback busy guard uses raw streaming, abort and live pending tool states', () => {
    const id = 'rollback-busy-contract'
    const session = { agent: { state: { isStreaming: false, pendingToolCalls: new Set() } }, runtimeToolExecutions: new Map(), abortPending: false }
    agentSessions.set(id, session)
    try {
      expect(agentManager.isSessionFileRollbackBusy(id)).toBe(false)
      session.abortPending = true
      expect(agentManager.isSessionFileRollbackBusy(id)).toBe(true)
      session.abortPending = false
      session.agent.state.isStreaming = true
      expect(agentManager.isSessionFileRollbackBusy(id)).toBe(true)
      session.agent.state.isStreaming = false
      session.agent.state.pendingToolCalls.add('tool')
      expect(agentManager.isSessionFileRollbackBusy(id)).toBe(true)
      session.agent.state.pendingToolCalls.clear()
      session.runtimeToolExecutions.set('runtime-tool', { pending: true })
      expect(agentManager.isSessionFileRollbackBusy(id)).toBe(true)
    } finally {
      agentSessions.delete(id)
    }
    expect(agentManager.isSessionFileRollbackBusy(id)).toBe(false)
  })

  it('exports exactly the expected symbol set', () => {
    expect(Object.keys(agentManager).sort()).toEqual([...EXPECTED_EXPORTS, ...INTERNAL_SHARED_EXPORTS].sort())
  })

  it('exports functions/event emitter values, not undefined', () => {
    for (const name of [...EXPECTED_EXPORTS, ...INTERNAL_SHARED_EXPORTS]) {
      expect(agentManager[name], `export ${name} must be defined`).toBeDefined()
    }
  })

  it('public API entry points remain callable functions', () => {
    const functionExports = [...EXPECTED_EXPORTS, ...INTERNAL_SHARED_EXPORTS].filter((name) => name !== 'agentEvents')
    for (const name of functionExports) {
      expect(typeof agentManager[name], `export ${name} must be a function`).toBe('function')
    }
  })
})
