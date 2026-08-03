import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_HTTP_TIMEOUT_MS,
  DEFAULT_AI_MAX_RETRIES,
  withDefaultAiProviderOptions,
} from '../../server/ai-provider-options.mjs'

describe('AI provider options', () => {
  it('defaults to three retries and a bounded HTTP timeout', () => {
    expect(DEFAULT_AI_MAX_RETRIES).toBe(3)
    expect(DEFAULT_AI_HTTP_TIMEOUT_MS).toBe(2 * 60 * 1000)
    expect(withDefaultAiProviderOptions({ maxTokens: 100 })).toEqual({
      maxRetries: 3,
      timeoutMs: DEFAULT_AI_HTTP_TIMEOUT_MS,
      maxTokens: 100,
    })
  })

  it('preserves explicit retry and timeout values', () => {
    expect(withDefaultAiProviderOptions({ maxRetries: 0, timeoutMs: 1000 })).toMatchObject({
      maxRetries: 0,
      timeoutMs: 1000,
    })
  })
})
