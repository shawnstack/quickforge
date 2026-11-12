// ---------------------------------------------------------------------------
// server-agent 门面
//
// 上帝模块治理⑥（2026-11-12）：原 2807 行单文件按职责拆到 `src/lib/server-agent/`
// 目录，本文件只保留门面 re-export，导出面与拆分前完全一致（消费方零改动）：
// - `ServerAgent` 类 → `server-agent/agent.ts`（状态字段、构造、订阅、租约门面、
//   prompt/steer/continue 等委托与静态工厂入口）
// - `fetchActiveAgentStatuses` → `server-agent/runtime-status.ts`（侧栏状态轮询）
// - SSE 连接单例与共享类型本就在 `global-agent-sse-client.ts` / `server-agent-types.ts`
// 职责模块布局见 docs/wiki/src/lib/README.md。
// ---------------------------------------------------------------------------

export { ServerAgent } from './server-agent/agent'
export { fetchActiveAgentStatuses } from './server-agent/runtime-status'

export {
  MAX_SSE_RECONNECT_ATTEMPTS,
  subscribeToAgentEvents,
  subscribeSseConnectionState,
  getSseConnectionState,
  requestSseReconnectNow,
} from './global-agent-sse-client'

export type {
  SseConnectionStatus,
  ActiveAgentStatus,
  ServerAgentContextCompaction,
  ServerAgentContextUsageBreakdown,
  ServerAgentContextUsage,
  ServerAgentPendingToolApproval,
  ServerAgentCompactionNotice,
  ServerAgentPendingAsk,
  ServerAgentAskAnswer,
  ServerAgentConfig,
  ServerTurnRollbackPreview,
  ServerTurnRollbackResult,
  ServerRollbackResult,
  BackgroundCommandSnapshot,
  FileContextReference,
  PromptCapabilitySelection,
  ServerAgentStateSnapshot,
  ServerAgentEvent,
  ServerAgentLocalEvent,
  ServerAgentWireEvent,
} from './server-agent-types'
