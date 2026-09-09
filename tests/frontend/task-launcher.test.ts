import { describe, expect, it, vi } from 'vitest'
import { createTaskLauncherActions, taskIds } from '../../src/components/chat/task-launcher'
import type { ComposerDraft } from '../../src/components/chat/chat-utils'
import type { createCapabilitySuggestions } from '../../src/components/chat/capability-suggestions'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {} } }))

function setup(enabled = true) {
  let draft: ComposerDraft = { text: '', attachments: [], contextReferences: [], selectedCapabilities: [] }
  let ready = true
  const capabilities = {
    refresh: vi.fn(async () => {}),
    availablePluginRows: vi.fn(() => [{ pluginName: 'documents' }, { pluginName: 'spreadsheets' }, { pluginName: 'presentations' }]),
    replaceTemplatePlugin: vi.fn((selected: unknown[]) => selected),
  }
  const notify = vi.fn()
  const restore = vi.fn((next: ComposerDraft) => { draft = next })
  const interact = vi.fn()
  const actions = createTaskLauncherActions({
    read: () => draft, restore, ready: () => ready, interact, notify,
    capabilities: capabilities as unknown as ReturnType<typeof createCapabilitySuggestions>, capabilitiesEnabled: enabled,
  })
  return { actions, capabilities, notify, restore, interact, getDraft: () => draft, setDraft: (next: ComposerDraft) => { draft = next }, setReady: (value: boolean) => { ready = value } }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('main chat quick tasks', () => {
  it('requests Office deliverables in both languages without a text-only downgrade', async () => {
    const { appTranslations } = await vi.importActual<typeof import('../../src/lib/i18n')>('../../src/lib/i18n')
    for (const language of ['en', 'zh'] as const) {
      const text = appTranslations[language]
      expect(text.taskPptPrompt).toContain('PPTX')
      expect(text.taskWordPrompt).toContain('DOCX')
      expect(text.taskDataPrompt).toContain('XLSX')
      expect(text.taskWeeklyPrompt).not.toContain('DOCX')
      for (const prompt of [text.taskPptPrompt, text.taskWordPrompt, text.taskDataPrompt]) {
        expect(prompt).not.toMatch(/do not promise|do not assume|不承诺|不要假设/)
      }
      expect(text.taskPluginUnavailable).toBeTruthy()
      expect(text.taskRuntimeUnsupported).toBeTruthy()
    }
  })
  it.each(taskIds)('fills editable prompt for %s without a send path', async (id) => {
    const s = setup()
    await s.actions.choose(id)
    expect(s.getDraft().text).toMatch(/^task.+Prompt$/)
    expect(s.restore).toHaveBeenCalledTimes(1)
    expect(s.interact).toHaveBeenCalledOnce()
  })

  it('preserves existing text and does not select plugins until replacement', async () => {
    const s = setup()
    s.setDraft({ text: 'my work', attachments: [] })
    await s.actions.choose('weekly')
    expect(s.notify).toHaveBeenLastCalledWith('conflict')
    expect(s.restore).not.toHaveBeenCalled()
    expect(s.capabilities.replaceTemplatePlugin).not.toHaveBeenCalled()
    s.actions.keep()
    await s.actions.replace()
    expect(s.getDraft().text).toBe('my work')
  })

  it('re-reads latest attachment, reference and unrelated capability on confirmation', async () => {
    const s = setup()
    s.setDraft({ text: 'old', attachments: [] })
    await s.actions.choose('word')
    const latest = { text: 'new text', attachments: [{ name: 'new.txt' }], contextReferences: [{ path: 'new.ts' }], selectedCapabilities: [{ type: 'plugin', pluginName: 'other', name: 'other', label: 'Other' }] } as ComposerDraft
    s.setDraft(latest)
    await s.actions.replace()
    expect(s.getDraft()).toEqual({ ...latest, text: 'taskWordPrompt' })
    expect(s.capabilities.replaceTemplatePlugin).toHaveBeenLastCalledWith(latest.selectedCapabilities, 'documents')
  })

  it('does not treat attachment-only drafts as a text conflict', async () => {
    const s = setup()
    s.setDraft({ text: '', attachments: ['attachment'] })
    await s.actions.choose('explore')
    expect(s.getDraft().attachments).toEqual(['attachment'])
    expect(s.notify).toHaveBeenLastCalledWith('filled')
  })

  it('fills without enabling unavailable plugins or fetching on unsupported runtimes', async () => {
    const s = setup()
    s.capabilities.availablePluginRows.mockReturnValue([])
    await s.actions.choose('ppt')
    expect(s.getDraft().text).toBe('taskPptPrompt')
    expect(s.capabilities.replaceTemplatePlugin).toHaveBeenCalledWith([], undefined)
    expect(s.notify).toHaveBeenLastCalledWith('unavailable')
    const unsupported = setup(false)
    await unsupported.actions.choose('data')
    expect(unsupported.capabilities.refresh).not.toHaveBeenCalled()
    expect(unsupported.capabilities.replaceTemplatePlugin).toHaveBeenCalledWith([], undefined)
    expect(unsupported.getDraft().text).toBe('taskDataPrompt')
    expect(unsupported.notify).toHaveBeenLastCalledWith('unsupported')
  })

  it.each(['dispose', 'new-task', 'keep'] as const)('invalidates delayed plugin loading on %s', async (action) => {
    const s = setup()
    const wait = deferred()
    s.capabilities.refresh.mockReturnValue(wait.promise)
    const old = s.actions.choose('weekly')
    if (action === 'dispose') s.actions.dispose()
    if (action === 'new-task') await s.actions.choose('explore')
    if (action === 'keep') s.actions.keep()
    wait.resolve()
    await old
    expect(s.capabilities.replaceTemplatePlugin).toHaveBeenCalledTimes(action === 'new-task' ? 1 : 0)
    expect(s.getDraft().text).toBe(action === 'new-task' ? 'taskExplorePrompt' : '')
  })

  it('protects typing during asynchronous plugin loading', async () => {
    const s = setup()
    const wait = deferred()
    s.capabilities.refresh.mockReturnValue(wait.promise)
    const old = s.actions.choose('weekly')
    s.setDraft({ text: 'typed while waiting', attachments: [] })
    wait.resolve()
    await old
    expect(s.getDraft().text).toBe('typed while waiting')
    expect(s.notify).toHaveBeenLastCalledWith('conflict')
  })

  it('waits for initial restoration and rejects a no-longer-ready session', async () => {
    const s = setup()
    s.setReady(false)
    await s.actions.choose('explore')
    expect(s.interact).not.toHaveBeenCalled()
    expect(s.restore).not.toHaveBeenCalled()
    s.setReady(true)
    const wait = deferred()
    s.capabilities.refresh.mockReturnValue(wait.promise)
    const old = s.actions.choose('weekly')
    s.setReady(false)
    wait.resolve()
    await old
    expect(s.restore).not.toHaveBeenCalled()
  })
})
