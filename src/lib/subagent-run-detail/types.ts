import type { AppTextKey } from '@/lib/i18n'
import type { QuickForgeToolTiming } from '@/lib/tool-execution-events'
import { isRecord } from './guards'

export type SubagentRunStatus = 'running' | 'done' | 'error' | 'called'

/** 与 tool-display-settings 的显示模式一致（compact 也视为非详细模式）。 */
export type SubagentToolDisplayMode = 'concise' | 'compact' | 'detailed'

export type SubagentRunI18n = (key: AppTextKey, params?: Record<string, string | number>) => string

export type SubagentRunErrorSource = 'trace' | 'output' | 'details' | 'fallback'

/** 本次 subagent 运行实际使用的模型；继承时 provider/id 为父会话模型，并带 inherited: true。 */
export type SubagentRunModel = {
  mode: 'inherit' | 'fixed'
  inherited?: boolean
  provider?: string
  id?: string
  name?: string
  providerId?: string
  catalogId?: string
  modelId?: string
}

/** 本次运行实际生效的思考等级；inherit 已在服务端解析为具体等级，模型不支持推理时为 off。 */
export type SubagentRunThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

export type SubagentRunPayload = {
  /** 稳定运行 id：新消息以显式 toolCallId / toolResult 顶层 toolCallId / details.toolCallId 为主键；details.sessionId 仅历史兼容 fallback；旧消息回退 `${name}:${task}`。 */
  runId: string
  /** canonical 父工具调用 id；新运行的实时更新和 Tab 主键必须使用它。 */
  canonicalToolCallId?: string
  name: string
  label: string
  task: string
  context: string
  expectedOutput: string
  status: SubagentRunStatus
  statusLabel: string
  timing?: QuickForgeToolTiming
  toolCalls?: number
  allowedTools: string[]
  /** 已按 subagentProcessTraceMessages 过滤、可直接交给 MessageList 组件的过程消息。 */
  traceMessages: unknown[]
  tools: unknown[]
  pendingToolCalls: string[]
  /** Workspace Inspector 运行详情 Tab 展示的 input / details JSON。 */
  input: string
  details: string
  output: string
  /** 失败原因；fallback 表示上游未提供可显示的具体错误正文，由渲染层本地化。 */
  errorMessage: string
  errorSource?: SubagentRunErrorSource
  /** 本次运行实际使用的模型；旧会话或缺失时为 undefined。 */
  model?: SubagentRunModel
  /** 本次运行实际生效的思考等级。 */
  thinkingLevel?: SubagentRunThinkingLevel
  /** 聊天工具显示模式，仅用于兼容统一载荷。 */
  detailed: boolean
  /** 内容指纹，用于去重实时更新事件。 */
  fingerprint: string
}

/** 点击 subagent 运行摘要时派发的桥接事件 detail。 */
export type SubagentRunOpenRequest = {
  runId: string
  payload?: SubagentRunPayload
}

export const OPEN_SUBAGENT_RUN_EVENT = 'quickforge:open-subagent-run'

/** subagent 运行载荷的实时订阅者。 */
export type SubagentRunListener = (payload: SubagentRunPayload) => void

/** 实时快照缓存上限：超过后按插入顺序淘汰最旧运行，避免长期会话内存泄漏。 */
export const MAX_SUBAGENT_RUN_SNAPSHOTS = 100

/** 置顶摘要已结束 subagent 的防御性提取上限。 */
export const MAX_TERMINAL_SUBAGENT_RUNS = 100

const SUBAGENT_THINKING_LEVELS: readonly SubagentRunThinkingLevel[] = ['off', 'low', 'medium', 'high', 'xhigh']

export function subagentRunModelFromDetails(value: unknown): SubagentRunModel | undefined {
  if (!isRecord(value)) return undefined
  const mode = value.mode === 'fixed' ? 'fixed' : value.mode === 'inherit' ? 'inherit' : undefined
  if (!mode) return undefined
  return {
    mode,
    ...(typeof value.inherited === 'boolean' ? { inherited: value.inherited } : {}),
    ...(typeof value.provider === 'string' && value.provider ? { provider: value.provider } : {}),
    ...(typeof value.id === 'string' && value.id ? { id: value.id } : {}),
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(typeof value.providerId === 'string' && value.providerId ? { providerId: value.providerId } : {}),
    ...(typeof value.catalogId === 'string' && value.catalogId ? { catalogId: value.catalogId } : {}),
    ...(typeof value.modelId === 'string' && value.modelId ? { modelId: value.modelId } : {}),
  }
}

export function subagentRunThinkingLevelFromDetails(value: unknown): SubagentRunThinkingLevel | undefined {
  return typeof value === 'string' && (SUBAGENT_THINKING_LEVELS as readonly string[]).includes(value)
    ? value as SubagentRunThinkingLevel
    : undefined
}
