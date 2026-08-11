import { describe, expect, it, vi } from 'vitest'
import { bindEditorCallbacks } from '../../src/components/chat/panel-decoration/editor-bindings'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'

function bind(onBeforeSend: (input: string) => void, attachmentsEnabled = true) {
  const baseOnSend = vi.fn()
  const editor = {
    onSend: baseOnSend,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MessageEditorElement
  bindEditorCallbacks({
    editor,
    onInput: vi.fn(),
    onFilesChange: vi.fn(),
    removeCommandSuggestions: vi.fn(),
    updateCommandSuggestions: vi.fn(),
    removeCapabilitySuggestions: vi.fn(),
    updateCapabilitySuggestions: vi.fn(),
    attachmentsEnabled,
    onBeforeSend,
  })
  return { editor, baseOnSend }
}

describe('editor bindings', () => {
  it('runs onBeforeSend for attachment-only sends when enabled', () => {
    const onBeforeSend = vi.fn()
    const { editor, baseOnSend } = bind(onBeforeSend)

    editor.onSend?.('', [{}])

    expect(onBeforeSend).toHaveBeenCalledWith('')
    expect(baseOnSend).toHaveBeenCalledWith('', [{}])
  })

  it('blocks attachment sends when the Harness disables attachments', () => {
    const onBeforeSend = vi.fn()
    const { editor, baseOnSend } = bind(onBeforeSend, false)

    editor.onSend?.('caption', [{}])
    editor.onSend?.('', [{}])

    expect(onBeforeSend).not.toHaveBeenCalled()
    expect(baseOnSend).not.toHaveBeenCalled()
  })
})
