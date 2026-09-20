import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindEditorCallbacks, decorateComposerTextAttachmentTile } from '../../src/components/chat/panel-decoration/editor-bindings'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'

// Copy comes from i18n and the language falls back to navigator.language, so
// pin it: assertions below must not depend on the host locale.
beforeEach(() => {
  applyAppLanguageFromSnapshot('en')
})

afterEach(() => {
  applyAppLanguageFromSnapshot('en')
  vi.unstubAllGlobals()
})

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

  it('blocks attachment sends when capabilities disable attachments', () => {
    const onBeforeSend = vi.fn()
    const { editor, baseOnSend } = bind(onBeforeSend, false)

    editor.onSend?.('caption', [{}])
    editor.onSend?.('', [{}])

    expect(onBeforeSend).not.toHaveBeenCalled()
    expect(baseOnSend).not.toHaveBeenCalled()
  })
})

class FakeTile {
  dataset: Record<string, string> = {}
  attributes = new Map<string, string>()
  listeners: string[] = []

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  addEventListener(type: string) {
    this.listeners.push(type)
  }
}

function stubTimers() {
  const frames: Array<() => void> = []
  const timeouts: Array<{ handler: () => void; delay: number }> = []
  const windowStub = {
    requestAnimationFrame: (handler: () => void) => { frames.push(handler); return frames.length },
    cancelAnimationFrame: vi.fn(),
    setTimeout: (handler: () => void, delay: number) => { timeouts.push({ handler, delay }); return timeouts.length },
    clearTimeout: vi.fn(),
  }
  vi.stubGlobal('window', windowStub)
  return { frames, timeouts, windowStub }
}

describe('composer text attachment tile decoration', () => {
  function editorWith(tile: FakeTile, isCommitted: () => boolean) {
    return {
      querySelector: (selector: string) => (
        selector === '.qf-attachment-tile:last-of-type' && isCommitted() ? tile : null
      ),
    } as unknown as MessageEditorElement
  }

  it('targets the React tile host and retries until the async commit lands', () => {
    const tile = new FakeTile()
    let committed = false
    const { frames, timeouts, windowStub } = stubTimers()
    const onOpenLocalFilePath = vi.fn()

    decorateComposerTextAttachmentTile(
      editorWith(tile, () => committed),
      '/tmp/pasted.txt',
      onOpenLocalFilePath,
    )

    // React has not committed the attachment list yet: nothing applied, retries armed.
    expect(tile.attributes.size).toBe(0)
    expect(tile.listeners).toEqual([])
    expect(frames).toHaveLength(1)
    expect(timeouts.map((entry) => entry.delay)).toEqual([0, 50, 150, 300, 600])

    committed = true
    frames[0]()

    expect(tile.attributes.get('title')).toBe(`${t('openAttachmentInFileManager')}：/tmp/pasted.txt`)
    expect(tile.dataset.quickforgeTextAttachmentPath).toBe('/tmp/pasted.txt')
    expect(tile.dataset.quickforgeTextAttachmentBound).toBe('1')
    expect(tile.listeners).toEqual(['click'])
    // Applied → every armed retry is cleared, and a late retry is a no-op.
    expect(windowStub.clearTimeout).toHaveBeenCalledTimes(5)
    expect(windowStub.cancelAnimationFrame).toHaveBeenCalledTimes(1)
    timeouts.forEach((entry) => entry.handler())
    expect(tile.listeners).toEqual(['click'])
  })

  it('re-decorating the same tile stays idempotent (one listener, fresh path)', () => {
    const tile = new FakeTile()
    const { frames, timeouts, windowStub } = stubTimers()
    const editor = editorWith(tile, () => true)

    decorateComposerTextAttachmentTile(editor, '/tmp/first.txt')
    decorateComposerTextAttachmentTile(editor, '/tmp/second.txt')

    expect(tile.listeners).toEqual(['click'])
    expect(tile.dataset.quickforgeTextAttachmentPath).toBe('/tmp/second.txt')
    expect(timeouts).toHaveLength(0)
    expect(frames).toHaveLength(0)
    expect(windowStub.cancelAnimationFrame).not.toHaveBeenCalled()
  })
})

describe('composer large-paste text attachment fallback', () => {
  // Must clear LARGE_PASTE_ATTACHMENT_THRESHOLD (3000 chars) to hit the handler.
  const LARGE_PASTE = 'pasted line\n'.repeat(300)

  function bindLargePaste(sessionId?: string) {
    const handlers: Array<{ type: string; handler: (event: ClipboardEvent) => void }> = []
    const requestUpdate = vi.fn()
    const editor = {
      value: 'existing draft',
      attachments: [],
      requestUpdate,
      addEventListener: (type: string, handler: (event: ClipboardEvent) => void) => { handlers.push({ type, handler }) },
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
      sessionId,
    })
    return { editor, requestUpdate, handler: handlers.find((entry) => entry.type === 'paste')?.handler }
  }

  function paste(handler: ((event: ClipboardEvent) => void) | undefined, text: string, draft = 'existing draft') {
    handler?.({
      clipboardData: { getData: () => text },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: { value: draft },
    } as unknown as ClipboardEvent)
  }

  it('restores draft and pasted text with a real paragraph break when the upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const { editor, requestUpdate, handler } = bindLargePaste('session-1')

    paste(handler, LARGE_PASTE)
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Regression: the separator used to be the literal two-character sequence
    // "\n\n" (`'\\n\\n'`), so the fallback pasted visible backslash-n text.
    expect(editor.value).toBe(`existing draft\n\n${LARGE_PASTE}`)
    expect(editor.value).not.toContain('\\n')
    expect(requestUpdate).toHaveBeenCalled()
  })

  it('inserts the pasted text without a separator when the composer is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    const { editor, handler } = bindLargePaste('session-1')

    paste(handler, LARGE_PASTE, '')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(editor.value).toBe(LARGE_PASTE)
    expect(editor.value).not.toContain('\\n')
  })

  it('installs no large-paste handler without a session id', () => {
    const { handler } = bindLargePaste(undefined)
    expect(handler).toBeUndefined()
  })
})
