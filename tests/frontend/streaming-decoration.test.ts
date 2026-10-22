// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decorateStreamingMessages } from '../../src/components/chat/panel-decoration/message-actions'
import { decorateProcessBlocks } from '../../src/components/chat/panel-decoration/process-folding'

vi.mock('../../src/components/chat/panel-decoration/process-folding', () => ({
  decorateProcessBlocks: vi.fn(),
}))

type StreamingElement = HTMLElement & { isStreaming?: boolean }

function buildPanel() {
  const panel = document.createElement('div')
  const list = document.createElement('div')
  list.className = 'qf-message-list'
  const user = document.createElement('div')
  user.className = 'qf-user-message'
  const assistant = document.createElement('div')
  assistant.className = 'qf-assistant-message'
  const streaming = document.createElement('div') as StreamingElement
  streaming.className = 'qf-assistant-message'
  streaming.isStreaming = true
  list.append(user, assistant, streaming)
  panel.append(list)
  return { panel, user, assistant, streaming }
}

describe('decorateStreamingMessages', () => {
  beforeEach(() => {
    vi.mocked(decorateProcessBlocks).mockClear()
  })

  it('folds committed rows plus the streaming row and skips row-level decoration', () => {
    const { panel, user, assistant, streaming } = buildPanel()

    decorateStreamingMessages(panel)

    expect(decorateProcessBlocks).toHaveBeenCalledTimes(1)
    const [passedPanel, rows, isStreaming] = vi.mocked(decorateProcessBlocks).mock.calls[0]
    expect(passedPanel).toBe(panel)
    expect(rows).toEqual([user, assistant, streaming])
    expect(isStreaming).toBe(true)
    expect(assistant.querySelector('[data-quickforge-action]')).toBeNull()
  })

  it('accepts a cached committed-row list from the last full pass', () => {
    const { panel, user, assistant, streaming } = buildPanel()

    decorateStreamingMessages(panel, [user, assistant])

    expect(vi.mocked(decorateProcessBlocks).mock.calls[0][1]).toEqual([user, assistant, streaming])
  })

  it('does not append the streaming row when the agent is no longer streaming', () => {
    const { panel, user, assistant } = buildPanel()

    decorateStreamingMessages(panel, undefined, false)

    expect(vi.mocked(decorateProcessBlocks).mock.calls[0][1]).toEqual([user, assistant])
    expect(vi.mocked(decorateProcessBlocks).mock.calls[0][2]).toBe(false)
  })
})
