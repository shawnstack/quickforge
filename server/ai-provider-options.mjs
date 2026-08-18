export const DEFAULT_AI_MAX_RETRIES = 3
export const DEFAULT_AI_HTTP_TIMEOUT_MS = 2 * 60 * 1000
export const DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000
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
