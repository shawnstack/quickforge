export const DEFAULT_AI_MAX_RETRIES = 3
export const DEFAULT_AI_HTTP_TIMEOUT_MS = 2 * 60 * 1000
// 中断档：模型流已产出实质内容后的静默上限。正常生成的 token 间隔是毫秒级，
// 60s 无任何事件即可判定上游断流（弱网/代理隧道半开/供应商挂起）。
export const DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS = 60 * 1000
// 首事件档：首个实质事件（text/thinking/toolcall delta）之前的等待上限。
// 经用户决策与中断档统一为 60s（观察期；大上下文 prefill 若出现误杀再回调）。
export const DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS = 60 * 1000
export const DEFAULT_AI_STREAM_TOTAL_TIMEOUT_MS = 20 * 60 * 1000
// Backward-compatible alias: deadlineMs now overrides the idle timeout.
export const DEFAULT_AI_STREAM_DEADLINE_MS = DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS

export function withDefaultAiProviderOptions(options = {}) {
  return {
    maxRetries: DEFAULT_AI_MAX_RETRIES,
    timeoutMs: DEFAULT_AI_HTTP_TIMEOUT_MS,
    ...options,
  }
}
