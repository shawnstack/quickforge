import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleComposerDraftRestore } from '../../src/components/chat/panel-decoration/drafts'
import type { ComposerDraft, MessageEditorElement } from '../../src/components/chat/chat-utils'

type FakePanel = HTMLElement & {
  editor?: MessageEditorElement
}

function createPanel(): FakePanel {
  const panel = {
    editor: undefined,
    isConnected: true,
    querySelector: (selector: string) => selector === 'message-editor' ? panel.editor ?? null : null,
  }
  return panel as unknown as FakePanel
}

function createEditor(onInput = vi.fn()): MessageEditorElement {
  return {
    value: '',
    attachments: [],
    onInput,
    onFilesChange: vi.fn(),
    querySelector: () => null,
  } as unknown as MessageEditorElement
}

function installWindowTimers() {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrame: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(0), 16),
    cancelAnimationFrame: (handle: number) => globalThis.clearTimeout(handle),
  })
}

describe('composer draft restoration lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installWindowTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('cancels delayed restoration before an editor becomes available', () => {
    const panel = createPanel()
    const drafts = new Map<string, ComposerDraft>()
    const onInput = vi.fn()
    const handle = scheduleComposerDraftRestore(
      panel,
      { text: 'already sent', attachments: [] },
      drafts,
      'session:one',
    )

    handle.cancel()
    panel.editor = createEditor(onInput)
    vi.advanceTimersByTime(1000)

    expect(onInput).not.toHaveBeenCalled()
    expect(drafts.has('session:one')).toBe(false)
  })

  it('stops delayed restoration when its lifecycle guard becomes stale', () => {
    const panel = createPanel()
    const drafts = new Map<string, ComposerDraft>()
    const onInput = vi.fn()
    let current = true
    scheduleComposerDraftRestore(
      panel,
      { text: 'stale draft', attachments: [] },
      drafts,
      'session:one',
      { shouldApply: () => current },
    )

    current = false
    panel.editor = createEditor(onInput)
    vi.advanceTimersByTime(1000)

    expect(onInput).not.toHaveBeenCalled()
    expect(drafts.has('session:one')).toBe(false)
  })

  it('restores context references onto the message editor', () => {
    const panel = createPanel()
    const drafts = new Map<string, ComposerDraft>()
    panel.editor = createEditor()
    const reference = { type: 'file' as const, projectId: 'project-1', path: 'src/main.ts' }

    scheduleComposerDraftRestore(panel, { text: '', attachments: [], contextReferences: [reference] }, drafts, 'session:one')

    expect(panel.editor.contextReferences).toEqual([reference])
    expect(drafts.get('session:one')?.contextReferences).toEqual([reference])
  })

  it('restores selected capabilities onto the message editor', () => {
    const panel = createPanel()
    const drafts = new Map<string, ComposerDraft>()
    panel.editor = createEditor()
    const capability = { type: 'plugin' as const, pluginName: 'documents', name: 'documents', label: 'Documents' }

    scheduleComposerDraftRestore(panel, { text: '', attachments: [], selectedCapabilities: [capability] }, drafts, 'session:one')

    expect(panel.editor.selectedCapabilities).toEqual([capability])
    expect(drafts.get('session:one')?.selectedCapabilities).toEqual([capability])
  })

  it('applies a ready draft once and clears pending retries', () => {
    const panel = createPanel()
    const drafts = new Map<string, ComposerDraft>()
    const onInput = vi.fn()
    const onApplied = vi.fn()
    panel.editor = createEditor(onInput)

    scheduleComposerDraftRestore(
      panel,
      { text: 'restore once', attachments: [] },
      drafts,
      'session:one',
      { onApplied },
    )
    vi.advanceTimersByTime(1000)

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith('restore once')
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(drafts.get('session:one')?.text).toBe('restore once')
  })
})
