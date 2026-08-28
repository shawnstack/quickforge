import { t } from '@/lib/i18n'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  resolveSubagentRunPayloadForOpen,
  subagentRunStore,
  type SubagentRunPayload,
  type SubagentRunStore,
} from '@/lib/subagent-run-detail'

type SubagentRunStoreReader = Pick<SubagentRunStore, 'get'>

type SubagentRunningMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
  __quickforgeElapsedTimer?: number
  __quickforgeOwnerPanel?: HTMLElement
  __quickforgeOwnerTrigger?: HTMLButtonElement
}

/**
 * 当前会话正在运行的 subagent。只遍历该 agent 的 pendingToolCalls，避免全局
 * subagentRunStore 中其他会话的快照污染 Composer 指示器。
 */
export function getRunningSubagentRuns(
  pendingToolCalls: Iterable<string>,
  store: SubagentRunStoreReader = subagentRunStore,
): SubagentRunPayload[] {
  const runs: SubagentRunPayload[] = []
  for (const toolCallId of pendingToolCalls) {
    const payload = store.get(toolCallId)
    if (payload?.status === 'running') runs.push(payload)
  }
  return runs
}

function elapsedSeconds(payload: SubagentRunPayload, now = Date.now()): number {
  const startedAt = payload.timing?.startedAt
  if (typeof startedAt === 'number') return Math.max(0, Math.floor((now - startedAt) / 1000))
  if (typeof payload.timing?.durationMs === 'number') return Math.max(0, Math.floor(payload.timing.durationMs / 1000))
  return 0
}

function updateElapsedLabels(menu: HTMLElement) {
  const now = Date.now()
  menu.querySelectorAll<HTMLElement>('.quickforge-subagent-running-elapsed').forEach((element) => {
    const startedAt = Number(element.dataset.startedAt)
    const durationMs = Number(element.dataset.durationMs)
    const seconds = Number.isFinite(startedAt) && startedAt > 0
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : Number.isFinite(durationMs) && durationMs > 0
        ? Math.max(0, Math.floor(durationMs / 1000))
        : 0
    element.textContent = t('subagentRunningIndicatorElapsed', { seconds })
  })
}

export function removeSubagentRunningIndicatorMenu(panel: HTMLElement, scoped = false) {
  const menu = document.querySelector<SubagentRunningMenuElement>('.quickforge-subagent-running-menu')
  if (scoped && menu?.__quickforgeOwnerPanel !== panel) {
    panel.querySelector<HTMLButtonElement>('.quickforge-subagent-running-trigger')?.setAttribute('aria-expanded', 'false')
    return
  }
  if (menu?.__quickforgeDismissHandler) {
    document.removeEventListener('pointerdown', menu.__quickforgeDismissHandler, true)
    document.removeEventListener('keydown', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('resize', menu.__quickforgeDismissHandler, true)
    window.removeEventListener('scroll', menu.__quickforgeDismissHandler, true)
    menu.__quickforgeDismissHandler = undefined
  }
  if (menu?.__quickforgeElapsedTimer !== undefined) {
    window.clearInterval(menu.__quickforgeElapsedTimer)
    menu.__quickforgeElapsedTimer = undefined
  }
  menu?.__quickforgeOwnerTrigger?.setAttribute('aria-expanded', 'false')
  menu?.remove()
  panel.querySelector<HTMLButtonElement>('.quickforge-subagent-running-trigger')?.setAttribute('aria-expanded', 'false')
}

export function removeSubagentRunningIndicator(panel: HTMLElement) {
  removeSubagentRunningIndicatorMenu(panel, true)
  panel.querySelector<HTMLButtonElement>('.quickforge-subagent-running-trigger')?.remove()
}

function renderMenuItems(options: {
  menu: HTMLElement
  panel: HTMLElement
  getRunningRuns: () => SubagentRunPayload[]
  store: SubagentRunStoreReader
}) {
  const { menu, panel, getRunningRuns, store } = options
  const runs = getRunningRuns()
  if (runs.length === 0) {
    removeSubagentRunningIndicator(panel)
    return
  }

  const heading = document.createElement('div')
  heading.className = 'quickforge-subagent-running-menu-title'
  heading.textContent = t('subagentRunningIndicatorMenuTitle', { count: runs.length })

  const list = document.createElement('div')
  list.className = 'quickforge-subagent-running-list'
  for (const payload of runs) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'quickforge-subagent-running-item'
    item.setAttribute('role', 'menuitem')
    item.dataset.runId = payload.runId

    const top = document.createElement('span')
    top.className = 'quickforge-subagent-running-item-top'
    const label = document.createElement('span')
    label.className = 'quickforge-subagent-running-item-label'
    label.textContent = payload.label || payload.name
    const elapsed = document.createElement('span')
    elapsed.className = 'quickforge-subagent-running-elapsed'
    if (typeof payload.timing?.startedAt === 'number') elapsed.dataset.startedAt = String(payload.timing.startedAt)
    if (typeof payload.timing?.durationMs === 'number') elapsed.dataset.durationMs = String(payload.timing.durationMs)
    elapsed.textContent = t('subagentRunningIndicatorElapsed', { seconds: elapsedSeconds(payload) })
    top.append(label, elapsed)

    const task = document.createElement('span')
    task.className = 'quickforge-subagent-running-task'
    task.textContent = payload.task
    item.setAttribute('aria-label', t('subagentRunningIndicatorItemAria', {
      name: payload.label || payload.name,
      task: payload.task,
    }))
    item.append(top, task)
    item.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const payloadForOpen = resolveSubagentRunPayloadForOpen(payload, store.get(payload.runId))
      removeSubagentRunningIndicatorMenu(panel)
      window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, {
        detail: { runId: payloadForOpen.runId, payload: payloadForOpen },
      }))
    }
    list.append(item)
  }
  menu.replaceChildren(heading, list)
}

function openSubagentRunningMenu(options: {
  panel: HTMLElement
  trigger: HTMLButtonElement
  getRunningRuns: () => SubagentRunPayload[]
  store: SubagentRunStoreReader
  dismissComposerMenus: () => void
}) {
  const { panel, trigger, getRunningRuns, store, dismissComposerMenus } = options
  const existing = document.querySelector<SubagentRunningMenuElement>('.quickforge-subagent-running-menu')
  if (existing?.__quickforgeOwnerPanel === panel) {
    removeSubagentRunningIndicatorMenu(panel)
    return
  }

  dismissComposerMenus()
  removeSubagentRunningIndicatorMenu(panel)
  if (getRunningRuns().length === 0) {
    removeSubagentRunningIndicator(panel)
    return
  }

  const menu = document.createElement('div') as SubagentRunningMenuElement
  menu.className = 'quickforge-subagent-running-menu'
  menu.__quickforgeOwnerPanel = panel
  menu.__quickforgeOwnerTrigger = trigger
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('subagentRunningIndicatorMenuAria'))
  renderMenuItems({ menu, panel, getRunningRuns, store })

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect()
    const gap = 8
    const width = Math.min(360, window.innerWidth - 24)
    menu.style.width = `${width}px`
    const measuredHeight = Math.min(menu.offsetHeight || 240, 420)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = Math.max(12, rect.top - measuredHeight - gap)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  const dismiss = (event: Event) => {
    if (event.type === 'resize' || event.type === 'scroll') {
      positionMenu()
      return
    }
    if (event.type === 'keydown') {
      if ((event as KeyboardEvent).key !== 'Escape') return
      event.preventDefault()
    } else {
      const target = event.target as Node
      if (menu.contains(target) || trigger.contains(target)) return
    }
    removeSubagentRunningIndicatorMenu(panel)
  }
  menu.__quickforgeDismissHandler = dismiss
  menu.addEventListener('pointerdown', (event) => event.stopPropagation())
  document.addEventListener('pointerdown', dismiss, true)
  document.addEventListener('keydown', dismiss, true)
  window.addEventListener('resize', dismiss, true)
  window.addEventListener('scroll', dismiss, true)
  document.body.append(menu)
  positionMenu()
  trigger.setAttribute('aria-expanded', 'true')
  menu.__quickforgeElapsedTimer = window.setInterval(() => updateElapsedLabels(menu), 1000)
}

export function setupSubagentRunningIndicator(options: {
  panel: HTMLElement
  leftControls: HTMLElement
  enabled: boolean
  getPendingToolCalls: () => Iterable<string>
  dismissComposerMenus: () => void
  store?: SubagentRunStoreReader
}) {
  const {
    panel,
    leftControls,
    enabled,
    getPendingToolCalls,
    dismissComposerMenus,
    store = subagentRunStore,
  } = options
  const getRunningRuns = () => getRunningSubagentRuns(getPendingToolCalls(), store)
  const runs = enabled ? getRunningRuns() : []
  if (runs.length === 0) {
    removeSubagentRunningIndicator(panel)
    return
  }

  let trigger = leftControls.querySelector<HTMLButtonElement>('.quickforge-subagent-running-trigger')
  if (!trigger) {
    removeSubagentRunningIndicatorMenu(panel, true)
    trigger = document.createElement('button')
    trigger.type = 'button'
  }
  trigger.className = 'quickforge-subagent-running-trigger inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 text-xs font-medium text-muted-foreground'
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-label', t('subagentRunningIndicatorTriggerAria', { count: runs.length }))
  const ownedMenu = document.querySelector<SubagentRunningMenuElement>('.quickforge-subagent-running-menu')
  trigger.setAttribute('aria-expanded', String(ownedMenu?.__quickforgeOwnerPanel === panel))
  trigger.title = t('subagentRunningIndicatorTriggerAria', { count: runs.length })

  let spinner = trigger.querySelector<HTMLElement>('.quickforge-subagent-running-spinner')
  let count = trigger.querySelector<HTMLElement>('.quickforge-subagent-running-count')
  let label = trigger.querySelector<HTMLElement>('.quickforge-subagent-running-trigger-label')
  if (!spinner || !count || !label) {
    spinner = document.createElement('span')
    spinner.className = 'quickforge-subagent-running-spinner'
    spinner.setAttribute('aria-hidden', 'true')
    count = document.createElement('span')
    count.className = 'quickforge-subagent-running-count'
    label = document.createElement('span')
    label.className = 'quickforge-subagent-running-trigger-label'
    trigger.replaceChildren(spinner, count, label)
  }
  count.textContent = String(runs.length)
  label.textContent = t('subagentRunningIndicatorTriggerLabel')

  trigger.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    openSubagentRunningMenu({ panel, trigger: trigger!, getRunningRuns, store, dismissComposerMenus })
  }
  trigger.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  trigger.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    event.preventDefault()
    openSubagentRunningMenu({ panel, trigger: trigger!, getRunningRuns, store, dismissComposerMenus })
  }

  const accessButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')
  const planButton = leftControls.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  if (accessButton) {
    if (accessButton.nextSibling !== trigger) leftControls.insertBefore(trigger, accessButton.nextSibling)
  } else if (planButton) leftControls.insertBefore(trigger, planButton)
  else leftControls.append(trigger)
  if (planButton && trigger.nextSibling !== planButton) leftControls.insertBefore(planButton, trigger.nextSibling)

  if (ownedMenu?.__quickforgeOwnerPanel === panel) {
    if (ownedMenu.__quickforgeOwnerTrigger !== trigger) {
      removeSubagentRunningIndicatorMenu(panel)
    } else {
      renderMenuItems({ menu: ownedMenu, panel, getRunningRuns, store })
    }
  }
}
