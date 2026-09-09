import { t } from '@/lib/i18n'
import type { ComposerDraft } from './chat-utils'
import { capabilityIcons } from './capability-icons'
import type { createCapabilitySuggestions } from './capability-suggestions'

export const taskIds = ['explore', 'develop', 'review', 'fix', 'weekly', 'data', 'ppt', 'word'] as const
export type TaskId = typeof taskIds[number]
const plugins: Partial<Record<TaskId, string>> = { weekly: 'documents', data: 'spreadsheets', ppt: 'presentations', word: 'documents' }
const developmentIcons = {
  explore: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  develop: '<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/>',
  review: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 13l2 2 5-5M8 18h7"/>',
  fix: '<path d="M8 8h8v8a4 4 0 0 1-8 0zm2 0V5h4v3M4 12h4m8 0h4M4 17h4m8 0h4M6 5l3 3m9-3-3 3"/>',
} as const
const keys = {
  explore: ['taskExplore', 'taskExploreDescription', 'taskExplorePrompt'],
  develop: ['taskDevelop', 'taskDevelopDescription', 'taskDevelopPrompt'],
  review: ['taskReview', 'taskReviewDescription', 'taskReviewPrompt'],
  fix: ['taskFix', 'taskFixDescription', 'taskFixPrompt'],
  weekly: ['taskWeekly', 'taskWeeklyDescription', 'taskWeeklyPrompt'],
  data: ['taskData', 'taskDataDescription', 'taskDataPrompt'],
  ppt: ['taskPpt', 'taskPptDescription', 'taskPptPrompt'],
  word: ['taskWord', 'taskWordDescription', 'taskWordPrompt'],
} as const

type Options = {
  read: () => ComposerDraft
  restore: (draft: ComposerDraft) => void
  interact: () => void
  ready: () => boolean
  capabilities: ReturnType<typeof createCapabilitySuggestions>
  capabilitiesEnabled: boolean
  notify: (state: 'conflict' | 'filled' | 'unavailable' | 'unsupported' | 'idle') => void
}

/** Owns pending intent, never a stale draft. Every commit re-reads the editor. */
export function createTaskLauncherActions(options: Options) {
  let generation = 0
  let disposed = false
  let pending: TaskId | undefined
  const apply = async (id: TaskId, replace: boolean) => {
    const version = ++generation
    pending = undefined
    if (disposed || !options.ready()) return
    options.interact()
    options.notify('idle')
    const plugin = plugins[id]
    if (plugin && options.capabilitiesEnabled) await options.capabilities.refresh()
    if (disposed || version !== generation || !options.ready()) return
    const draft = options.read()
    const prompt = t(keys[id][2])
    if (!replace && draft.text.trim() && draft.text !== prompt) {
      pending = id
      options.notify('conflict')
      return
    }
    let state: 'filled' | 'unavailable' | 'unsupported' = 'filled'
    if (plugin) {
      if (!options.capabilitiesEnabled) state = 'unsupported'
      else if (!options.capabilities.availablePluginRows().some((row) => row.pluginName === plugin)) state = 'unavailable'
    }
    // Only a committed replacement changes template-owned chips. Synchronize the
    // controller before restore triggers the editor's onInput/onFilesChange callbacks.
    const selectedCapabilities = options.capabilities.replaceTemplatePlugin(
      draft.selectedCapabilities ?? [], state === 'filled' ? plugin : undefined,
    )
    options.restore({ ...draft, text: prompt, selectedCapabilities })
    options.notify(state)
  }
  return {
    choose: (id: TaskId) => apply(id, false),
    replace: () => pending ? apply(pending, true) : Promise.resolve(),
    keep: () => { generation++; pending = undefined; options.notify('idle') },
    dispose: () => { disposed = true; generation++; pending = undefined },
  }
}

let nextLauncherId = 0
export function createTaskLauncher(options: Omit<Options, 'notify'> & { panel: HTMLElement; visible?: () => boolean }) {
  let dismissed = false
  const visible = () => !dismissed && (options.visible?.() ?? true)
  const root = document.createElement('section')
  root.className = 'quickforge-task-launcher'
  root.setAttribute('aria-label', t('taskLauncher'))
  const tabs = document.createElement('div')
  tabs.className = 'quickforge-task-tabs'
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', t('taskLauncher'))
  const grid = document.createElement('div')
  grid.className = 'quickforge-task-grid'
  grid.setAttribute('role', 'tabpanel')
  const uid = `quickforge-tasks-${++nextLauncherId}`
  grid.id = uid
  const notice = document.createElement('div')
  notice.className = 'quickforge-task-notice'
  notice.setAttribute('aria-live', 'polite')
  const message = document.createElement('span')
  const keep = document.createElement('button')
  keep.type = 'button'
  keep.textContent = t('taskKeepDraft')
  const replace = document.createElement('button')
  replace.type = 'button'
  replace.textContent = t('taskReplaceDraft')
  notice.append(message, keep, replace)
  notice.hidden = true
  const actions = createTaskLauncherActions({ ...options, ready: () => visible() && options.ready(), notify: (state) => {
    notice.hidden = state === 'idle'
    keep.hidden = replace.hidden = state !== 'conflict'
    const labels = { conflict: 'taskDraftConflict', filled: 'taskFilled', unavailable: 'taskPluginUnavailable', unsupported: 'taskRuntimeUnsupported', idle: 'taskFilled' } as const
    message.textContent = t(labels[state])
  } })
  keep.onclick = () => actions.keep()
  replace.onclick = () => { void actions.replace() }
  let active = 0
  const tabButtons = [t('taskDevelopment'), t('taskOffice')].map((label, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `${uid}-tab-${index}`
    button.textContent = label
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', uid)
    button.onclick = () => render(index)
    button.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - active
      render(next)
      tabButtons[next].focus()
    }
    tabs.append(button)
    return button
  })
  function render(index: number) {
    active = index
    tabButtons.forEach((button, i) => {
      button.tabIndex = i === index ? 0 : -1
      button.setAttribute('aria-selected', String(i === index))
    })
    grid.setAttribute('aria-labelledby', tabButtons[index].id)
    grid.replaceChildren()
    for (const id of taskIds.slice(index * 4, index * 4 + 4)) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `quickforge-task-card quickforge-task-${id}`
      button.disabled = !options.ready()
      const icon = document.createElement('span')
      icon.className = 'quickforge-task-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = id in developmentIcons
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${developmentIcons[id as keyof typeof developmentIcons]}</svg>`
        : capabilityIcons[id === 'data' ? 'spreadsheet' : id === 'ppt' ? 'presentation' : 'document']
      const label = document.createElement('span')
      label.textContent = t(keys[id][0])
      const description = document.createElement('small')
      description.textContent = t(keys[id][1])
      button.append(icon, label, description)
      button.onclick = () => { void actions.choose(id) }
      grid.append(button)
    }
  }
  root.append(tabs, grid, notice)
  render(0)
  let observedDock: HTMLElement | null = null
  let surface: HTMLElement | null = null
  const resize = new ResizeObserver(() => {
    if (observedDock && surface) {
      surface.style.setProperty('--quickforge-task-dock-height', `${observedDock.getBoundingClientRect().height}px`)
    }
  })
  const detach = () => {
    if (!root.parentElement && !observedDock) return
    actions.keep()
    resize.disconnect()
    surface?.style.removeProperty('--quickforge-task-dock-height')
    surface = null
    observedDock = null
    root.remove()
  }
  return {
    hide: () => { dismissed = true; detach() },
    sync: () => {
      if (options.visible && !options.visible()) { dismissed = false; detach(); return }
      if (!visible()) { detach(); return }
      const shell = options.panel.querySelector('message-editor')?.parentElement
      if (shell && root.parentElement !== shell) shell.prepend(root)
      grid.querySelectorAll('button').forEach((button) => {
        const disabled = !options.ready()
        if (button.disabled !== disabled) button.disabled = disabled
      })
      const dock = root.closest<HTMLElement>('.quickforge-composer-dock')
      const nextSurface = dock?.closest<HTMLElement>('.quickforge-empty-chat') ?? null
      if (dock && (dock !== observedDock || surface !== nextSurface)) {
        resize.disconnect()
        surface?.style.removeProperty('--quickforge-task-dock-height')
        observedDock = dock
        surface = dock.closest<HTMLElement>('.quickforge-empty-chat')
        resize.observe(dock)
      }
    },
    cancel: () => actions.keep(),
    dispose: () => {
      actions.dispose()
      resize.disconnect()
      surface?.style.removeProperty('--quickforge-task-dock-height')
      root.remove()
    },
  }
}
