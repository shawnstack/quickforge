/**
 * subagent 运行详情的纯逻辑与实时 store（不依赖 DOM/框架/React/i18n 运行时，便于单元测试）。
 *
 * 稳定 run id：新消息以 run_subagent 父工具调用的 `toolCallId` 为主键。
 * tool_execution_start 的 partialResult.details 已带 toolCallId（此时 sessionId 是父
 * 会话），后续 tool_execution_update/end 的 details.sessionId 变为子代理会话 id；若把
 * sessionId 当主键，start 时打开的 Tab 会与后续更新失配。因此 runId 推导顺序为：
 * 显式 toolCallId → toolResult 顶层 toolCallId → details.toolCallId → details.sessionId（仅历史兼容 fallback：旧
 * 消息/旧服务器没有 toolCallId 时才使用，不作为新消息主键）→ `${name}:${task}`
 * （无任何 id 的历史消息安全回退）。
 *
 * 实时数据流：ServerAgent 在 tool_execution_start/update/end SSE 路径主动构建载荷
 * 并发布到 subagentRunStore；tool-renderers/subagent-tool-renderer 的渲染器只在
 * 聊天重渲染（含恢复会话回填）时发布到同一 store，由内容指纹去重，避免重复；
 * Workspace Inspector 订阅 store 按 runId 更新已打开的 Tab。不依赖 ChatPanelHost
 * rAF 或 ToolRenderer.render 作为主通道。
 *
 * i18n 通过 t 参数注入（由 tool-renderers/subagent-tool-renderer.tsx /
 * server-agent.ts 传入真实 t 函数），保持本模块可测试。
 */

// ---------------------------------------------------------------------------
// subagent-run-detail 门面（2026-11-13 拆分）
//
// 原文件已按职责拆分到 `src/lib/subagent-run-detail/` 目录，本文件只保留
// 顶部模块注释与显式 re-export，对外导出面与拆分前完全一致（测试零改动的
// 契约清单；`guards.ts` 中的内部守卫不进门面）。各职责模块分档见
// docs/wiki/src/lib/README.md。
// ---------------------------------------------------------------------------

// types：类型契约 + 模型/思考等级解析
export type { SubagentRunStatus, SubagentToolDisplayMode, SubagentRunI18n, SubagentRunErrorSource, SubagentRunPayload } from './subagent-run-detail/types'
export { OPEN_SUBAGENT_RUN_EVENT, MAX_SUBAGENT_RUN_SNAPSHOTS, MAX_TERMINAL_SUBAGENT_RUNS } from './subagent-run-detail/types'

// store：实时快照 store 与全局单例
export { SubagentRunStore, subagentRunStore } from './subagent-run-detail/store'

// guards：仅 stringifyValue / ToolResultLike 属于历史导出面
export { stringifyValue, type ToolResultLike } from './subagent-run-detail/guards'

// payload：标签/状态错误推导、指纹与载荷构建
export {
  subagentRunModelLabel,
  subagentThinkingLevelLabelKey,
  subagentRunError,
  subagentRunStatus,
  subagentRunId,
  subagentRunFingerprint,
  buildSubagentRunPayload,
  subagentRunPayloadFromToolEvent,
} from './subagent-run-detail/payload'
export { subagentRunTraceMessagesForDisplay } from './subagent-run-detail/view-blocks'

// publish-policy：发布谓词与打开请求规范化
export {
  canPublishSubagentRunPayload,
  canOpenSubagentRunPayload,
  shouldPublishSubagentRunPayload,
  resolveSubagentRunPayloadForOpen,
  normalizeOpenSubagentRunRequest,
} from './subagent-run-detail/publish-policy'

// tool-summaries：跑马灯摘要与记忆
export {
  currentSubagentToolSummaries,
  MAX_SUBAGENT_TOOL_SUMMARY_RUNS,
  SubagentToolSummaryMemory,
  currentSubagentToolSummariesWithMemory,
} from './subagent-run-detail/tool-summaries'

// message-extraction：终态/运行中提取
export {
  extractLatestTerminalSubagentRuns,
  extractRunningSubagentRuns,
} from './subagent-run-detail/message-extraction'

// view-blocks：详情块顺序契约
export { subagentRunBodyBlocks } from './subagent-run-detail/view-blocks'

// event-publisher：SSE 事件 → store 的实时发布器
export { SubagentRunEventPublisher } from './subagent-run-detail/event-publisher'
