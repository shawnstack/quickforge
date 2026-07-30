import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_MAX_RETRIES,
  withDefaultAiProviderOptions,
} from '../../server/ai-provider-options.mjs'

describe('AI provider options', () => {
  it('defaults to three retries', () => {
    expect(DEFAULT_AI_MAX_RETRIES).toBe(3)
    expect(withDefaultAiProviderOptions({ maxTokens: 100 })).toEqual({
      maxRetries: 3,
      maxTokens: 100,
    })
  })

  it('preserves an explicit retry count', () => {
    expect(withDefaultAiProviderOptions({ maxRetries: 0 })).toMatchObject({
      maxRetries: 0,
    })
  })
})
