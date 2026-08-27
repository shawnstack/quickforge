import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_HTTP_TIMEOUT_MS,
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_STREAM_DEADLINE_MS,
  DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS,
  DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_AI_STREAM_TOTAL_TIMEOUT_MS,
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

  it('defines two-tier stream silence budgets and a twenty-minute total timeout', () => {
    // 经用户决策两档统一 60s：中断档（出过内容后）与首事件档（prefill 观察期）。
    expect(DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS).toBe(60 * 1000)
    expect(DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS).toBe(60 * 1000)
    expect(DEFAULT_AI_STREAM_TOTAL_TIMEOUT_MS).toBe(20 * 60 * 1000)
    expect(DEFAULT_AI_STREAM_DEADLINE_MS).toBe(DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS)
  })

  it('preserves explicit retry and timeout values', () => {
    expect(withDefaultAiProviderOptions({ maxRetries: 0, timeoutMs: 1000 })).toMatchObject({
      maxRetries: 0,
      timeoutMs: 1000,
    })
  })
})
