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

const BOT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'

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

  let heading = menu.querySelector<HTMLElement>('.quickforge-subagent-running-menu-title')
  if (!heading) {
    heading = document.createElement('div')
    heading.className = 'quickforge-subagent-running-menu-title'
    menu.append(heading)
  }
  heading.textContent = t('subagentRunningIndicatorMenuTitle', { count: runs.length })

  let list = menu.querySelector<HTMLElement>('.quickforge-subagent-running-list')
  if (!list) {
    list = document.createElement('div')
    list.className = 'quickforge-subagent-running-list'
    menu.append(list)
  }

  const existing = new Map<string, HTMLButtonElement>()
  for (const item of list.querySelectorAll<HTMLButtonElement>('.quickforge-subagent-running-item')) {
    if (item.dataset.runId) existing.set(item.dataset.runId, item)
  }

  let previous: HTMLElement | null = null
  for (const payload of runs) {
    let item = existing.get(payload.runId)
    if (!item) {
      item = document.createElement('button')
      item.type = 'button'
      item.className = 'quickforge-subagent-running-item'
      item.setAttribute('role', 'menuitem')
      item.dataset.runId = payload.runId

      const top = document.createElement('span')
      top.className = 'quickforge-subagent-running-item-top'
      const label = document.createElement('span')
      label.className = 'quickforge-subagent-running-item-label'
      const elapsed = document.createElement('span')
      elapsed.className = 'quickforge-subagent-running-elapsed'
      top.append(label, elapsed)
      const task = document.createElement('span')
      task.className = 'quickforge-subagent-running-task'
      item.append(top, task)
    }

    const labelText = payload.label || payload.name
    const label = item.querySelector<HTMLElement>('.quickforge-subagent-running-item-label')
    if (label && label.textContent !== labelText) label.textContent = labelText
    const task = item.querySelector<HTMLElement>('.quickforge-subagent-running-task')
    if (task && task.textContent !== payload.task) task.textContent = payload.task
    const elapsed = item.querySelector<HTMLElement>('.quickforge-subagent-running-elapsed')
    if (elapsed) {
      if (typeof payload.timing?.startedAt === 'number') elapsed.dataset.startedAt = String(payload.timing.startedAt)
      else delete elapsed.dataset.startedAt
      if (typeof payload.timing?.durationMs === 'number') elapsed.dataset.durationMs = String(payload.timing.durationMs)
      else delete elapsed.dataset.durationMs
      const elapsedText = t('subagentRunningIndicatorElapsed', { seconds: elapsedSeconds(payload) })
      if (elapsed.textContent !== elapsedText) elapsed.textContent = elapsedText
    }
    const itemAria = t('subagentRunningIndicatorItemAria', { name: labelText, task: payload.task })
    if (item.getAttribute('aria-label') !== itemAria) item.setAttribute('aria-label', itemAria)
    item.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const payloadForOpen = resolveSubagentRunPayloadForOpen(payload, store.get(payload.runId))
      removeSubagentRunningIndicatorMenu(panel)
      window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, {
        detail: { runId: payloadForOpen.runId, payload: payloadForOpen },
      }))
    }

    const reference: ChildNode | null = previous ? previous.nextSibling : (Array.from(list.children)[0] ?? null)
    if (item !== reference) list.insertBefore(item, reference)
    previous = item
  }

  for (const [runId, item] of existing) {
    if (!runs.some((run) => run.runId === runId)) item.remove()
  }
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
    const anchor = menu.__quickforgeOwnerTrigger ?? trigger
    const rect = anchor.getBoundingClientRect()
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
      const ownerTrigger = menu.__quickforgeOwnerTrigger
      if (menu.contains(target) || ownerTrigger?.contains(target)) return
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
    trigger = document.createElement('button')
    trigger.type = 'button'
  }
  trigger.className = 'quickforge-subagent-running-trigger inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground'
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-label', t('subagentRunningIndicatorTriggerAria', { count: runs.length }))
  const ownedMenu = document.querySelector<SubagentRunningMenuElement>('.quickforge-subagent-running-menu')
  trigger.setAttribute('aria-expanded', String(ownedMenu?.__quickforgeOwnerPanel === panel))
  trigger.title = t('subagentRunningIndicatorTriggerAria', { count: runs.length })

  let icon = trigger.querySelector<HTMLElement>('.quickforge-subagent-running-icon')
  let badge = trigger.querySelector<HTMLElement>('.quickforge-subagent-running-badge')
  if (!icon || !badge) {
    icon = document.createElement('span')
    icon.className = 'quickforge-subagent-running-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = BOT_ICON_SVG
    badge = document.createElement('span')
    badge.className = 'quickforge-subagent-running-badge'
    badge.setAttribute('aria-hidden', 'true')
    trigger.replaceChildren(icon, badge)
  }
  badge.textContent = String(runs.length)

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
    ownedMenu.__quickforgeOwnerTrigger = trigger
    renderMenuItems({ menu: ownedMenu, panel, getRunningRuns, store })
  }
}
