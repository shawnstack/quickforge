import { describe, expect, it } from 'vitest'
import { serverConvertToLlm } from '../../server/message-converters.mjs'

describe('serverConvertToLlm', () => {
  function textBlock(text) {
    return { type: 'text', text }
  }

  function toolCallBlock(id, name = 'tool') {
    return { type: 'toolCall', id, name, arguments: {} }
  }

  function assistant(text, toolCallId, stopReason) {
    const content = []
    if (text) content.push(textBlock(text))
    if (toolCallId) content.push(toolCallBlock(toolCallId))
    return {
      role: 'assistant',
      content,
      ...(stopReason ? { stopReason } : {}),
    }
  }

  function toolResult(toolCallId) {
    return { role: 'toolResult', toolCallId, content: [{ type: 'text', text: 'result' }] }
  }

  function user(text) {
    return { role: 'user', content: [{ type: 'text', text }] }
  }

  it('passes through a well-formed tool call sequence unchanged', () => {
    const messages = [user('u1'), assistant('thinking', 'call-1'), toolResult('call-1'), assistant('answer')]
    const converted = serverConvertToLlm(messages)
    expect(converted).toEqual(messages)
  })

  it('drops an orphaned toolResult that has no preceding assistant tool_call', () => {
    const messages = [user('u1'), toolResult('call-1'), assistant('answer')]
    const converted = serverConvertToLlm(messages)
    expect(converted).toEqual([user('u1'), assistant('answer')])
  })

  it('drops a toolResult whose toolCallId does not match any known tool_call', () => {
    const messages = [user('u1'), assistant('thinking', 'call-1'), toolResult('call-999'), assistant('answer')]
    const converted = serverConvertToLlm(messages)
    expect(converted).toEqual([user('u1'), assistant('thinking', 'call-1'), assistant('answer')])
  })

  it('drops toolResults of aborted or errored assistant messages, matching upstream skip logic', () => {
    const messages = [
      user('u1'),
      assistant('thinking', 'call-1', 'aborted'),
      toolResult('call-1'),
      assistant('retry', 'call-2'),
      toolResult('call-2'),
    ]
    const converted = serverConvertToLlm(messages)
    expect(converted).toEqual([
      user('u1'),
      assistant('thinking', 'call-1', 'aborted'),
      assistant('retry', 'call-2'),
      toolResult('call-2'),
    ])
  })

  it('keeps artifact filtering and user-with-attachments conversion intact', () => {
    const messages = [
      { role: 'artifact', content: [] },
      { role: 'user-with-attachments', content: 'hello', attachments: [] },
      assistant('answer'),
    ]
    const converted = serverConvertToLlm(messages)
    expect(converted).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }], attachments: [] },
      assistant('answer'),
    ])
  })
})
