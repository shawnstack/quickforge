import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilitySuggestions } from '../../src/components/chat/capability-suggestions'
import { loadPlugins } from '@/components/plugins/plugin-api'

vi.mock('@/components/plugins/plugin-api', () => ({ loadPlugins: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

const plugin = { name: 'documents', displayName: 'Documents', version: '1', dir: '/plugins/documents', enabled: true, status: 'loaded', permissions: [], tools: [] }

function node(tag = 'div') {
  const children: ReturnType<typeof node>[] = []
  const item = {
    tagName: tag.toUpperCase(), className: '', dataset: {} as Record<string, string>, title: '', textContent: '', innerHTML: '', children,
    parentElement: null as ReturnType<typeof node> | null,
    value: '', attachments: [] as unknown[], contextReferences: [] as unknown[], selectedCapabilities: [] as unknown[],
    append(...items: ReturnType<typeof node>[]) { for (const child of items) { child.parentElement = this; children.push(child) } },
    prepend(child: ReturnType<typeof node>) { child.parentElement = this; children.unshift(child) },
    replaceChildren(...items: ReturnType<typeof node>[]) { children.length = 0; this.append(...items) },
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1) },
    querySelector(selector: string): ReturnType<typeof node> | null {
      if (selector === 'textarea') return children.find((child) => child.tagName === 'TEXTAREA') ?? null
      if (selector === 'message-editor') return children.find((child) => child.tagName === 'MESSAGE-EDITOR') ?? null
      const className = selector.startsWith('.') ? selector.slice(1) : ''
      for (const child of children) { if (className && child.className.split(/\s+/).includes(className)) return child; const nested = child.querySelector(selector); if (nested) return nested }
      return null
    },
    querySelectorAll(selector: string): ReturnType<typeof node>[] {
      const className = selector.startsWith('.') ? selector.slice(1) : ''
      const result: ReturnType<typeof node>[] = []
      for (const child of children) {
        if (className && child.className.split(/\s+/).includes(className)) result.push(child)
        result.push(...child.querySelectorAll(selector))
      }
      return result
    },
    setAttribute() {}, focus() {}, onpointerdown: undefined as ((event: { preventDefault(): void; stopPropagation(): void }) => void) | undefined,
  }
  return item
}

describe('plugin capability controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: node })
    vi.mocked(loadPlugins).mockResolvedValue({ plugins: [plugin] as never, searchPaths: [], errors: [] })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('does not use @ text and consumes only an explicit + selection once', async () => {
    const panel = node()
    const editor = node('message-editor')
    const textarea = node('textarea')
    editor.append(textarea)
    panel.append(editor)
    const restoreDraftIntoComposer = vi.fn()
    const controller = createCapabilitySuggestions({ panel: panel as unknown as HTMLElement, restoreDraftIntoComposer, enabled: true })
    await controller.refresh()

    controller.update('@Documents')
    expect(panel.querySelector('.quickforge-capability-suggestions')).toBeNull()
    controller.selectPlugin('documents')
    expect(restoreDraftIntoComposer).toHaveBeenCalledWith(expect.objectContaining({
      text: '',
      selectedCapabilities: [expect.objectContaining({ pluginName: 'documents' })],
    }))
    expect(restoreDraftIntoComposer.mock.calls[0][0].text).not.toContain('@Documents')
    expect(controller.consumeSelectedCapabilities()).toEqual([expect.objectContaining({ pluginName: 'documents' })])
    expect(controller.consumeSelectedCapabilities()).toEqual([])
  })

  it('removes only capability chips without deleting file reference chips from the shared container', async () => {
    const panel = node()
    const editor = node('message-editor')
    const textarea = node('textarea')
    const chips = node()
    chips.className = 'quickforge-context-chips'
    const fileChip = node()
    fileChip.className = 'quickforge-context-chip quickforge-file-reference-chip'
    chips.append(fileChip)
    editor.append(chips, textarea)
    panel.append(editor)
    const controller = createCapabilitySuggestions({ panel: panel as unknown as HTMLElement, restoreDraftIntoComposer: vi.fn(), enabled: true })
    await controller.refresh()

    controller.selectPlugin('documents')
    controller.consumeSelectedCapabilities()

    expect(editor.querySelector('.quickforge-file-reference-chip')).toBe(fileChip)
  })
})
