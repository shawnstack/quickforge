export const DEFAULT_AI_MAX_RETRIES = 3

export function withDefaultAiProviderOptions(options = {}) {
  return {
    maxRetries: DEFAULT_AI_MAX_RETRIES,
    ...options,
  }
}
