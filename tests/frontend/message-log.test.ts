import { describe, expect, it } from 'vitest'
import {
  applyMessageLogOp,
  createMessageLogWindow,
  localIndexForSeq,
  messageIdentity,
  messageWindowEnd,
  type MessageLogOp,
} from '../../src/lib/message-log'

type Message = { role: string; content: string; timestamp?: number; id?: string; toolCallId?: string }

function msg(label: string): Message {
  return { role: label.startsWith('u') ? 'user' : 'assistant', content: label }
}

function apply(window: ReturnType<typeof createMessageLogWindow<Message>>, op: MessageLogOp<Message>) {
  return applyMessageLogOp(window, op)
}

describe('messageIdentity', () => {
  it('prefers id, then toolCallId, then role+timestamp', () => {
    expect(messageIdentity({ id: 'a1' })).toBe('id:a1')
    expect(messageIdentity({ toolCallId: 't1' })).toBe('tool:t1')
    expect(messageIdentity({ role: 'user', timestamp: 7 })).toBe('user:7')
    expect(messageIdentity(null)).toBe('')
  })
})

describe('message window coordinates', () => {
  it('maps absolute seq to local index and back', () => {
    const window = createMessageLogWindow(10, [msg('u10'), msg('a11')])
    expect(messageWindowEnd(window)).toBe(12)
    expect(localIndexForSeq(window, 10)).toBe(0)
    expect(localIndexForSeq(window, 11)).toBe(1)
    expect(localIndexForSeq(window, 9)).toBe(-1)
    expect(localIndexForSeq(window, 12)).toBe(-1)
  })
})

describe('applyMessageLogOp / snapshot', () => {
  it('takes baseSeq from the server instead of guessing from array length', () => {
    const window = createMessageLogWindow(0, [])
    const result = apply(window, { kind: 'snapshot', baseSeq: 980, messages: [msg('u980'), msg('a981')], logVersion: 4 })
    expect(result.outcome).toBe('applied')
    expect(result.window.baseSeq).toBe(980)
    expect(result.window.messages).toHaveLength(2)
    expect(result.window.logVersion).toBe(4)
  })
})

describe('applyMessageLogOp / append', () => {
  it('adopts the server start for an empty window', () => {
    const result = apply(createMessageLogWindow(0, []), { kind: 'append', after: 5, messages: [msg('u5')] })
    expect(result.window.baseSeq).toBe(5)
    expect(result.window.messages).toEqual([msg('u5')])
  })

  it('appends a contiguous tail', () => {
    const window = createMessageLogWindow(0, [msg('u0')])
    const result = apply(window, { kind: 'append', after: 1, messages: [msg('a1'), msg('u2')] })
    expect(result.outcome).toBe('applied')
    expect(result.window.messages.map((m) => m.content)).toEqual(['u0', 'a1', 'u2'])
    expect(result.window.baseSeq).toBe(0)
  })

  it('overwrites the same position only when the content differs', () => {
    const window = createMessageLogWindow(0, [msg('u0'), msg('a1')])
    const updated = apply(window, { kind: 'append', after: 1, messages: [{ role: 'assistant', content: 'final answer' }] })
    expect(updated.window.messages[1].content).toBe('final answer')

    const same = apply(updated.window, { kind: 'append', after: 1, messages: [{ role: 'assistant', content: 'final answer' }] })
    expect(same.outcome).toBe('noop')
  })

  it('reports a gap instead of guessing when the tail starts past the local end', () => {
    const window = createMessageLogWindow(0, [msg('u0')])
    const result = apply(window, { kind: 'append', after: 5, messages: [msg('u5')] })
    expect(result.outcome).toBe('gap')
    expect(result.gapFrom).toBe(1)
    expect(result.window).toBe(window)
  })

  it('drops a tail that lies entirely before the window', () => {
    const window = createMessageLogWindow(10, [msg('u10')])
    const result = apply(window, { kind: 'append', after: 7, messages: [msg('a7'), msg('u8')] })
    expect(result.outcome).toBe('noop')
    expect(result.window.messages.map((m) => m.content)).toEqual(['u10'])
  })

  it('skips the part of a tail that belongs to the omitted prefix', () => {
    const window = createMessageLogWindow(10, [msg('u10'), msg('a11')])
    const result = apply(window, { kind: 'append', after: 9, messages: [msg('a9'), msg('u10'), msg('a11'), msg('u12')] })
    expect(result.outcome).toBe('applied')
    expect(result.window.messages.map((m) => m.content)).toEqual(['u10', 'a11', 'u12'])
  })

  it('refuses to push when a hole would be created', () => {
    // 本地窗口起点 10，只有 1 条；增量从 12 开始 → 11 缺失，不能直接 append。
    const window = createMessageLogWindow(10, [msg('u10')])
    const result = apply(window, { kind: 'append', after: 12, messages: [msg('u12')] })
    expect(result.outcome).toBe('gap')
    expect(result.gapFrom).toBe(11)
  })
})

describe('applyMessageLogOp / replace', () => {
  it('rebuilds the window after a rollback', () => {
    const window = createMessageLogWindow(0, [msg('u0'), msg('a1'), msg('u2')])
    const result = apply(window, { kind: 'replace', baseSeq: 0, messages: [msg('u0')], logVersion: 9 })
    expect(result.window.messages).toHaveLength(1)
    expect(result.window.logVersion).toBe(9)
  })

  it('keeps a windowed replace anchored at the server start', () => {
    const result = apply(createMessageLogWindow(0, []), { kind: 'replace', baseSeq: 40, messages: [msg('u40')] })
    expect(result.window.baseSeq).toBe(40)
  })
})

describe('applyMessageLogOp / update', () => {
  it('replaces a message at its absolute seq', () => {
    const window = createMessageLogWindow(10, [msg('u10'), msg('a11')])
    const result = apply(window, { kind: 'update', seq: 11, message: { role: 'assistant', content: 'final' } })
    expect(result.outcome).toBe('applied')
    expect(result.window.messages[1].content).toBe('final')
  })

  it('ignores updates outside the window', () => {
    const window = createMessageLogWindow(10, [msg('u10')])
    expect(apply(window, { kind: 'update', seq: 3, message: msg('a3') }).outcome).toBe('noop')
    expect(apply(window, { kind: 'update', seq: 20, message: msg('a20') }).outcome).toBe('noop')
  })
})
