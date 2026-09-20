import { describe, expect, it, vi, beforeEach } from 'vitest'

import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { runSendMessage } from '../../src/components/chat/surface/ChatSurface'
import type { Attachment } from '../../src/components/chat/surface/ChatTypes'

// Surface copy comes from i18n (language falls back to navigator.language).
beforeEach(() => applyAppLanguageFromSnapshot('en'))

const attachment = (id: string): Attachment => ({
  id,
  type: 'image',
  fileName: `${id}.png`,
  mimeType: 'image/png',
  size: 8,
  content: 'aGk=',
  preview: 'aGk=',
})

function createContext(overrides: Partial<Parameters<typeof runSendMessage>[2]> = {}) {
  const prompt = vi.fn(async () => {})
  const clearEditor = vi.fn()
  const enableAutoScroll = vi.fn()
  const onError = vi.fn()
  const context = {
    getApiKey: vi.fn(async () => 'stored-key'),
    isStreaming: () => false,
    getProvider: () => 'anthropic',
    clearEditor,
    enableAutoScroll,
    prompt,
    onError,
    ...overrides,
  }
  return { context, prompt, clearEditor, enableAutoScroll, onError }
}

describe('chat surface sendMessage flow', () => {
  it('prompts with the plain string when the provider key exists', async () => {
    const env = createContext()
    const onApiKeyRequired = vi.fn(async () => true)
    const onBeforeSend = vi.fn()

    await runSendMessage('hello', [], { ...env.context, onApiKeyRequired, onBeforeSend })

    expect(env.prompt).toHaveBeenCalledTimes(1)
    expect(env.prompt).toHaveBeenCalledWith('hello')
    expect(onApiKeyRequired).not.toHaveBeenCalled()
    expect(onBeforeSend).toHaveBeenCalledTimes(1)
    expect(env.clearEditor).toHaveBeenCalledTimes(1)
    expect(env.enableAutoScroll).toHaveBeenCalledTimes(1)
    expect(env.onError).not.toHaveBeenCalled()
  })

  it('prompts with a user-with-attachments message when attachments exist', async () => {
    const env = createContext()
    const attachments = [attachment('a1'), attachment('a2')]

    await runSendMessage('look at this', attachments, env.context)

    expect(env.prompt).toHaveBeenCalledTimes(1)
    const message = env.prompt.mock.calls[0][0] as {
      role: string
      content: string
      attachments: Attachment[]
      timestamp: number
    }
    expect(message.role).toBe('user-with-attachments')
    expect(message.content).toBe('look at this')
    expect(message.attachments).toEqual(attachments)
    expect(message.timestamp).toBeTypeOf('number')
  })

  it('aborts without prompting when the key is missing and onApiKeyRequired resolves false', async () => {
    const env = createContext({ getApiKey: vi.fn(async () => null) })
    const onApiKeyRequired = vi.fn(async () => false)
    const onBeforeSend = vi.fn()

    await runSendMessage('hello', [], { ...env.context, onApiKeyRequired, onBeforeSend })

    expect(onApiKeyRequired).toHaveBeenCalledWith('anthropic')
    expect(env.prompt).not.toHaveBeenCalled()
    expect(onBeforeSend).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
  })

  it('continues the send when onApiKeyRequired resolves true', async () => {
    const env = createContext({ getApiKey: vi.fn(async () => null) })

    await runSendMessage('hello', [], { ...env.context, onApiKeyRequired: vi.fn(async () => true) })

    expect(env.prompt).toHaveBeenCalledWith('hello')
    expect(env.clearEditor).toHaveBeenCalledTimes(1)
  })

  it('aborts (with a console error) when the key is missing and no handler is configured', async () => {
    const env = createContext({ getApiKey: vi.fn(async () => null) })

    await runSendMessage('hello', [], env.context)

    expect(env.prompt).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
    expect(env.onError).toHaveBeenCalledTimes(1)
    expect(env.onError.mock.calls[0][0]).toContain('No API key configured')
  })

  it('skips the send entirely while the agent is streaming', async () => {
    const env = createContext({ isStreaming: () => true })

    await runSendMessage('hello', [], env.context)

    expect(env.prompt).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
  })

  it('skips the send for empty input with no attachments', async () => {
    const env = createContext()

    await runSendMessage('   ', [], env.context)

    expect(env.prompt).not.toHaveBeenCalled()
  })

  it('notifies instead of throwing when no model is set', async () => {
    const env = createContext({ getProvider: () => undefined })

    await runSendMessage('hello', [], env.context)

    expect(env.prompt).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
    expect(env.onError).toHaveBeenCalledTimes(1)
    expect(env.onError.mock.calls[0][0]).toContain('model')
  })

  it('drops the send when streaming started while the API key dialog was open', async () => {
    let streaming = false
    const env = createContext({
      getApiKey: vi.fn(async () => null),
      isStreaming: () => streaming,
    })
    const onBeforeSend = vi.fn()
    const onApiKeyRequired = vi.fn(async () => {
      // The user lingered on the dialog while another turn began streaming.
      streaming = true
      return true
    })

    await runSendMessage('hello', [], { ...env.context, onApiKeyRequired, onBeforeSend })

    expect(env.prompt).not.toHaveBeenCalled()
    expect(onBeforeSend).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
  })

  it('drops the send when streaming starts before the stored key resolves', async () => {
    let streaming = false
    const env = createContext({
      getApiKey: vi.fn(async () => {
        streaming = true
        return 'stored-key'
      }),
      isStreaming: () => streaming,
    })

    await runSendMessage('hello', [], env.context)

    expect(env.prompt).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
  })

  it('blocks blank input when attachments are undefined (not an empty array)', async () => {
    const env = createContext()

    await runSendMessage('   ', undefined, env.context)

    expect(env.prompt).not.toHaveBeenCalled()
    expect(env.clearEditor).not.toHaveBeenCalled()
  })

  it('sends an attachment-only message with blank text', async () => {
    const env = createContext()
    const attachments = [attachment('only')]

    await runSendMessage('   ', attachments, env.context)

    expect(env.prompt).toHaveBeenCalledTimes(1)
    const message = env.prompt.mock.calls[0][0] as { role: string; attachments: Attachment[] }
    expect(message.role).toBe('user-with-attachments')
    expect(message.attachments).toEqual(attachments)
  })

  it('restores the draft and notifies when the prompt rejects', async () => {
    const promptError = new Error('server unreachable')
    const env = createContext({ prompt: vi.fn(async () => { throw promptError }) })
    const restoreEditor = vi.fn()
    const attachments = [attachment('keep')]

    await runSendMessage('please send', attachments, { ...env.context, restoreEditor })

    expect(restoreEditor).toHaveBeenCalledTimes(1)
    expect(restoreEditor).toHaveBeenCalledWith('please send', attachments)
    expect(env.onError).toHaveBeenCalledTimes(1)
    expect(env.onError.mock.calls[0][0]).toContain('server unreachable')
  })

  it('restores a text-only draft when the prompt rejects', async () => {
    const env = createContext({ prompt: vi.fn(async () => { throw new Error('boom') }) })
    const restoreEditor = vi.fn()

    await runSendMessage('hello again', undefined, { ...env.context, restoreEditor })

    expect(restoreEditor).toHaveBeenCalledWith('hello again', undefined)
    expect(env.onError).toHaveBeenCalledTimes(1)
  })

  it('clears the editor only after onBeforeSend completes', async () => {
    const order: string[] = []
    const env = createContext({
      clearEditor: vi.fn(() => order.push('clearEditor')),
      prompt: vi.fn(async () => {
        order.push('prompt')
      }),
    })

    await runSendMessage('hello', [], {
      ...env.context,
      onBeforeSend: async () => {
        order.push('onBeforeSend')
      },
    })

    expect(order).toEqual(['onBeforeSend', 'clearEditor', 'prompt'])
  })
})
