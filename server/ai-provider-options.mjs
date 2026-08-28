export const DEFAULT_AI_MAX_RETRIES = 3
export const DEFAULT_AI_HTTP_TIMEOUT_MS = 2 * 60 * 1000
// 中断档：模型流已产出实质内容后的静默上限。
export const DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS = 3 * 60 * 1000
// 首事件档：首个实质事件（text/thinking/toolcall delta 等非 start 事件）之前的等待上限。
export const DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS = 90 * 1000
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
