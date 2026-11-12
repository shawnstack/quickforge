import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'

// i18n 只用来取文案 key，桩掉能把「按 code 查表」和「原样透传」两条路分开看。
vi.mock('@/lib/i18n', () => ({ t: (key: string) => `t:${key}` }))

const { serverErrorMessage, assistantErrorMessage, appendAssistantErrorMessageOnce } = await import(
  '../../src/lib/server-agent/errors'
)

const model = { api: 'anthropic-messages', provider: 'anthropic', id: 'claude-test' } as unknown as Model<Api>

describe('serverErrorMessage', () => {
  it('prefers the translated text for known error codes', () => {
    expect(serverErrorMessage({ error: 'Generation is still running', code: 'GENERATION_ALREADY_RUNNING' }, 'fallback')).toBe(
      't:generationAlreadyRunning',
    )
    expect(serverErrorMessage({ code: 'GENERATION_STILL_RUNNING_BEFORE_ROLLBACK' }, 'fallback')).toBe('t:generationStillRunning')
  })

  it('passes an unknown code through as the raw error', () => {
    expect(serverErrorMessage({ error: 'Something broke', code: 'NOT_A_KNOWN_CODE' }, 'fallback')).toBe('Something broke')
  })

  it('falls back when the payload carries nothing useful', () => {
    expect(serverErrorMessage(null, 'Network error')).toBe('Network error')
    expect(serverErrorMessage({}, 'Network error')).toBe('Network error')
    expect(serverErrorMessage({ error: '' }, 'Network error')).toBe('Network error')
  })
})

describe('assistantErrorMessage', () => {
  it('builds a zero-usage assistant message flagged as an error', () => {
    const before = Date.now()
    const message = assistantErrorMessage('boom', model) as AgentMessage & { timestamp?: number }

    expect(message.role).toBe('assistant')
    expect(message.content).toEqual([{ type: 'text', text: '' }])
    expect(message).toMatchObject({ api: 'anthropic-messages', provider: 'anthropic', model: 'claude-test' })
    expect(message).toMatchObject({ stopReason: 'error', errorMessage: 'boom' })
    expect(message.usage).toMatchObject({ input: 0, output: 0, totalTokens: 0 })
    expect(message.usage?.cost).toMatchObject({ total: 0 })
    // 时间戳要在调用当下，不能恒定。
    expect(message.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('degrades gracefully when the model reference is missing', () => {
    const message = assistantErrorMessage('boom', undefined as unknown as Model<Api>)

    expect(message).toMatchObject({ api: 'openai-completions', provider: 'unknown', model: 'unknown' })
  })
})

describe('appendAssistantErrorMessageOnce', () => {
  const base = [{ role: 'user', content: 'hi' }] as AgentMessage[]

  it('appends the synthesized error without mutating the input', () => {
    const result = appendAssistantErrorMessageOnce(base, 'boom', model)

    expect(result).toHaveLength(2)
    expect(result[0]).toBe(base[0])
    expect(result[1]).toMatchObject({ role: 'assistant', stopReason: 'error', errorMessage: 'boom' })
    expect(base).toHaveLength(1)
  })

  it('does not stack the same error twice in a row', () => {
    const once = appendAssistantErrorMessageOnce(base, 'boom', model)
    const twice = appendAssistantErrorMessageOnce(once, 'boom', model)

    expect(twice).toBe(once)
  })

  it('still appends a different error right after one', () => {
    const once = appendAssistantErrorMessageOnce(base, 'boom', model)
    const different = appendAssistantErrorMessageOnce(once, 'other', model)

    expect(different).toHaveLength(3)
  })

  it('appends again after an ordinary assistant message', () => {
    const withAnswer = [...base, { role: 'assistant', content: 'ok', stopReason: 'stop' }] as AgentMessage[]

    expect(appendAssistantErrorMessageOnce(withAnswer, 'boom', model)).toHaveLength(3)
  })

  it('carries the failed prompt only for client-synthesized errors', () => {
    const failedPrompt = { role: 'user', content: 'retry me' } as AgentMessage

    const result = appendAssistantErrorMessageOnce(base, 'boom', model, failedPrompt)

    expect((result[1] as unknown as Record<string, unknown>).quickforgeFailedPrompt).toBe(failedPrompt)
    expect((appendAssistantErrorMessageOnce(base, 'boom', model)[1] as unknown as Record<string, unknown>).quickforgeFailedPrompt).toBeUndefined()
  })
})
