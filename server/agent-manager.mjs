// agent-manager.mjs —— facade（god-module-decomposition ⑤ 定形）
//
// 本文件是消费方唯一入口：re-export 既有公开 API（导出面由
// tests/server/agent-manager-exports-contract.test.mjs 锁定，21 个导入方
// 一行不改），并保留两件组合根职责：
//   1. 会话查询工厂的唯一实例（getSessionState / getSessionStatus / SSE 槽
//      / rollback busy / context budget / eventBus）；
//   2. goal runner 的依赖注入接线（goal/engine.mjs 永不反向 import 本模块）。
//
// 职责按模块收口（均为逐字搬移，行为与注释语义不变）：
//   - agent-session-store.mjs     模块级可变状态（agentSessions/pendingRestores/暂存）
//   - agent-session-events.mjs    共享事件核心（agentEvents/emitSessionEvent/分帧与用量）
//   - agent-session-queries.mjs   查询工厂（状态快照/SSE/回滚忙碌判定）
//   - agent-session-lease.mjs     会话写入租约
//   - agent-session-lifecycle.mjs 会话生命周期编排（createAgent/restore/sync/destroy/shutdown）
//   - agent-tool-assembly.mjs     工具装配（createServerTools/goal 工具挂载/工具重建）
//   - agent-turn-ids.mjs          轮级归因状态（sessionTurnIds/currentSessionTurnId）
//   - agent-context-transform.mjs 上下文压缩接线（transformSessionContext）
//   - agent-idle-recycler.mjs     空闲会话回收（resetIdleTimer/touchSession）
//   - agent-run-events.mjs        事件扇出+落库（agent 生命周期订阅/goal 结算/标题）
//   - agent-run-orchestration.mjs run 编排（runPrompt/continue/abort/steer/followUp）
//   - agent-background-commands.mjs 后台命令通知投递
//   - agent-rollback.mjs          消息回滚（下标算术 + rollbackSessionMessages）
//   - agent-session-updaters.mjs  会话 setter 组与模型/工具全量刷新
//   - agent-access-mode.mjs       访问模式纯归一化
//   - agent-approval-responses.mjs / agent-approval-orchestrator.mjs / ask-store.mjs
//                                审批与 ask 应答 / Promise 编排 / ask 存储
//   - agent-compaction.mjs        /summary、/compact、/clear 压缩业务
//   - agent-prompt-commands.mjs   斜杠命令解析与 prompt 模板
//   - agent-subagent-runner.mjs   run_subagent 生命周期
//   - agent-persistence.mjs       会话持久化（persistSessionState 为公共 API
//     经本 facade re-export）

import { createSessionQueries } from './agent-session-queries.mjs'
import { getSessionLease } from './agent-session-lease.mjs'

// ---------------------------------------------------------------------------
// Re-exports：契约锁定的公开面（EXPECTED_EXPORTS + INTERNAL_SHARED_EXPORTS）
// ---------------------------------------------------------------------------

export {
  acquireSessionLease,
  takeOverSessionLease,
  releaseSessionLease,
  getSessionLease,
  canWriteSession,
  clearSessionLease,
} from './agent-session-lease.mjs'
export { approveToolCall, rejectToolCall, answerAsk } from './agent-approval-responses.mjs'
export { getPendingAskForSession, normalizeAskQuestions } from './ask-store.mjs'
export { persistSessionState } from './agent-persistence.mjs'
export { hasFullAccess } from './agent-access-mode.mjs'
export {
  agentEvents,
  appendAssistantErrorMessageOnce,
  markLatestAssistantProcessFinished,
  stripSplitSessionState,
} from './agent-session-events.mjs'
export { currentSessionTurnId } from './agent-turn-ids.mjs'
export { createServerTools, attachTurnIdGetter } from './agent-tool-assembly.mjs'
export { resetIdleTimer, touchSession } from './agent-idle-recycler.mjs'
export { canApplyGeneratedTitle } from './agent-run-events.mjs'
export {
  createAgent,
  destroyAgent,
  restoreAgent,
  syncSessionFromStorage,
  listSessions,
  shutdown,
  resetStaleTaskStatuses,
} from './agent-session-lifecycle.mjs'
export { rollbackStartIndexFromMessage, rollbackSessionMessages } from './agent-rollback.mjs'
export {
  runPrompt,
  continueSession,
  abortRun,
  abortToolCall,
  steerAgent,
  followUpAgent,
  requestSessionCompaction,
} from './agent-run-orchestration.mjs'
export {
  updateSessionTitle,
  updateSessionAccessMode,
  updateSessionYoloMode,
  updateSessionModel,
  updateSessionThinkingLevel,
  refreshAllSessionModels,
  refreshAllSessionTools,
} from './agent-session-updaters.mjs'

// ---------------------------------------------------------------------------
// 组合根 1：会话查询工厂唯一实例
// ---------------------------------------------------------------------------

import { sessionGoal } from './goal/engine.mjs'
import {
  agentEvents,
  emitSessionEvent,
  messagesWithRuntimeToolExecutions,
  runtimePendingToolCalls,
  getSessionContextUsage,
} from './agent-session-events.mjs'
import { listBackgroundCommandTasks } from './tools/index.mjs'

export const { getSessionState, isSessionFileRollbackBusy, getSessionStatus, getSessionContextBudget, tryAcquireSse, isSseConnected, releaseSse, getSessionEventBus } = createSessionQueries({
  sessionGoal, messagesWithRuntimeToolExecutions, runtimePendingToolCalls, getSessionContextUsage,
  listBackgroundCommands: listBackgroundCommandTasks,
  getWriteLease: getSessionLease,
})

// agentEvents 的监听器上限配置（agent-session-events.mjs 持有 emitter 本体）。
agentEvents.setMaxListeners(100)

// ---------------------------------------------------------------------------
// 组合根 2：goal runner 依赖注入
// ---------------------------------------------------------------------------

import { configureGoalRunner } from './goal/engine.mjs'
import { beginSessionTurn, endSessionTurn } from './agent-turn-ids.mjs'
import { rebuildSessionTools } from './agent-tool-assembly.mjs'

// Goal continuations keep the full history and start a fresh turn id; the goal
// runner gets the turn helpers injected so it never imports this module.
configureGoalRunner({
  beginTurn: beginSessionTurn,
  endTurn: endSessionTurn,
  // Goal tools only exist while the session has an active goal (legacy
  // `goal_report`, v2 `get_goal`/`create_goal`/`update_goal`), so the tool set
  // is rebuilt whenever that flips (created/confirmed/finished).
  refreshTools: (session) => rebuildSessionTools(session),
  syncMessages: (session) => emitSessionEvent(session, { type: 'state', ...getSessionState(session.sessionId) }),
})
