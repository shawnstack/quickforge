import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assistantActionDisplayIndexes } from '../../src/components/chat/panel-decoration/message-action-visibility'

describe('assistant message actions', () => {
  it('only shows actions on the final assistant message of each completed turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'user-with-attachments' },
      { role: 'assistant' },
    ], false)

    expect([...indexes]).toEqual([2, 4])
  })

  it('hides actions for every assistant message in the active streaming turn', () => {
    const indexes = assistantActionDisplayIndexes([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ], true)

    expect([...indexes]).toEqual([1])
  })

  it('shows the final assistant actions after streaming completes', () => {
    const messages = [
      { role: 'user' },
      { role: 'assistant' },
      { role: 'assistant' },
    ]

    expect([...assistantActionDisplayIndexes(messages, true)]).toEqual([])
    expect([...assistantActionDisplayIndexes(messages, false)]).toEqual([2])
  })

  it('does not create assistant action targets before an assistant response exists', () => {
    expect([...assistantActionDisplayIndexes([], false)]).toEqual([])
    expect([...assistantActionDisplayIndexes([{ role: 'user' }], true)]).toEqual([])
  })

  it('does not apply content visibility to message hosts containing rollback popovers', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

    expect(css).not.toMatch(
      /message-list\s+(?:user-message|assistant-message)[^{}]*\{[^{}]*content-visibility\s*:/s,
    )
  })
})
