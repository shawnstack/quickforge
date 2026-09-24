import { t } from '@/lib/i18n'
import {
  OPEN_SUBAGENT_RUN_EVENT,
  resolveSubagentRunPayloadForOpen,
  subagentRunStore,
  type SubagentRunPayload,
  type SubagentRunStore,
} from '@/lib/subagent-run-detail'

type SubagentRunStoreReader = Pick<SubagentRunStore, 'get'>

export type BackgroundCommandSummary = {
  taskId: string
  sessionId?: string | null
  toolCallId?: string | null
  command: string
  description?: string
  outputFile?: string | null
  startedAt?: number
}

type SubagentRunningMenuElement = HTMLDivElement & {
  __quickforgeDismissHandler?: (event: Event) => void
  __quickforgeElapsedTimer?: number
  __quickforgeOwnerPanel?: HTMLElement
  __quickforgeOwnerTrigger?: HTMLButtonElement
}

const BOT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>'
const TERMINAL_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>'

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

function renderBackgroundCommandItems(options: {
  list: HTMLElement
  commands: BackgroundCommandSummary[]
  sessionId: string
  onStopped: () => void
}) {
  const { list, commands, sessionId, onStopped } = options
  const existing = new Map<string, HTMLDivElement>()
  for (const item of list.querySelectorAll<HTMLDivElement>('.quickforge-background-command-item')) {
    if (item.dataset.taskId) existing.set(item.dataset.taskId, item)
  }
  let previous: HTMLElement | null = null
  for (const command of commands) {
    let item = existing.get(command.taskId)
    if (!item) {
      item = document.createElement('div')
      item.className = 'quickforge-background-command-item'
      item.dataset.taskId = command.taskId
      const copy = document.createElement('span')
      copy.className = 'quickforge-background-command-copy'
      const label = document.createElement('span')
      label.className = 'quickforge-subagent-running-item-label'
      const task = document.createElement('span')
      task.className = 'quickforge-subagent-running-task'
      copy.append(label, task)
      const stop = document.createElement('button')
      stop.type = 'button'
      stop.className = 'quickforge-background-command-stop'
      stop.textContent = t('backgroundCommandStop')
      item.append(copy, stop)
    }
    const labelText = command.description || t('backgroundCommandLabel')
    const label = item.querySelector<HTMLElement>('.quickforge-subagent-running-item-label')
    if (label && label.textContent !== labelText) label.textContent = labelText
    const task = item.querySelector<HTMLElement>('.quickforge-subagent-running-task')
    if (task && task.textContent !== command.command) task.textContent = command.command
    const stop = item.querySelector<HTMLButtonElement>('.quickforge-background-command-stop')
    if (stop) {
      stop.setAttribute('aria-label', t('backgroundCommandStopAria', { command: command.command }))
      stop.onclick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        stop.disabled = true
        void stopBackgroundCommand(command.sessionId || sessionId, command).finally(onStopped)
      }
    }
    const reference: ChildNode | null = previous ? previous.nextSibling : (Array.from(list.children)[0] ?? null)
    if (item !== reference) list.insertBefore(item, reference)
    previous = item
  }
  for (const [taskId, item] of existing) {
    if (!commands.some((command) => command.taskId === taskId)) item.remove()
  }
}

function renderMenuItems(options: {
  menu: HTMLElement
  panel: HTMLElement
  getRunningRuns: () => SubagentRunPayload[]
  commands?: BackgroundCommandSummary[]
  sessionId?: string
  store: SubagentRunStoreReader
}) {
  const { menu, panel, getRunningRuns, commands = [], sessionId = '', store } = options
  const runs = getRunningRuns()
  if (runs.length === 0 && commands.length === 0) {
    removeSubagentRunningIndicator(panel)
    return
  }

  let heading = menu.querySelector<HTMLElement>('.quickforge-subagent-running-menu-title')
  if (!heading) {
    heading = document.createElement('div')
    heading.className = 'quickforge-subagent-running-menu-title'
    menu.append(heading)
  }
  heading.textContent = t('subagentRunningIndicatorMenuTitle', { count: runs.length + commands.length })

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
  renderBackgroundCommandItems({
    list,
    commands,
    sessionId,
    onStopped: () => renderMenuItems(options),
  })
}

function openSubagentRunningMenu(options: {
  panel: HTMLElement
  trigger: HTMLButtonElement
  getRunningRuns: () => SubagentRunPayload[]
  commands: BackgroundCommandSummary[]
  sessionId: string
  store: SubagentRunStoreReader
  dismissComposerMenus: () => void
}) {
  const { panel, trigger, getRunningRuns, commands, sessionId, store, dismissComposerMenus } = options
  const existing = document.querySelector<SubagentRunningMenuElement>('.quickforge-subagent-running-menu')
  if (existing?.__quickforgeOwnerPanel === panel) {
    removeSubagentRunningIndicatorMenu(panel)
    return
  }

  dismissComposerMenus()
  removeSubagentRunningIndicatorMenu(panel)
  if (getRunningRuns().length === 0 && commands.length === 0) {
    removeSubagentRunningIndicator(panel)
    return
  }

  const menu = document.createElement('div') as SubagentRunningMenuElement
  menu.className = 'quickforge-subagent-running-menu'
  menu.__quickforgeOwnerPanel = panel
  menu.__quickforgeOwnerTrigger = trigger
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('subagentRunningIndicatorMenuAria'))
  renderMenuItems({ menu, panel, getRunningRuns, commands, sessionId, store })

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

async function stopBackgroundCommand(sessionId: string, command: BackgroundCommandSummary) {
  if (!sessionId || !command.toolCallId) return false
  const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/abort-tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ toolCallId: command.toolCallId }),
  }).catch(() => null)
  return response?.ok === true
}

export function setupSubagentRunningIndicator(options: {
  panel: HTMLElement
  leftControls: HTMLElement
  enabled: boolean
  getPendingToolCalls: () => Iterable<string>
  getBackgroundCommands?: () => BackgroundCommandSummary[]
  sessionId?: string
  dismissComposerMenus: () => void
  store?: SubagentRunStoreReader
}) {
  const {
    panel,
    leftControls,
    enabled,
    getPendingToolCalls,
    getBackgroundCommands = () => [],
    sessionId = '',
    dismissComposerMenus,
    store = subagentRunStore,
  } = options
  const getRunningRuns = () => getRunningSubagentRuns(getPendingToolCalls(), store)
  const commands = enabled ? getBackgroundCommands() : []
  const runs = enabled ? getRunningRuns() : []
  if (runs.length === 0) {
    removeSubagentRunningIndicator(panel)
  } else {

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
    openSubagentRunningMenu({ panel, trigger: trigger!, getRunningRuns, commands, sessionId, store, dismissComposerMenus })
  }
  trigger.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  trigger.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
    event.preventDefault()
    openSubagentRunningMenu({ panel, trigger: trigger!, getRunningRuns, commands, sessionId, store, dismissComposerMenus })
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
    renderMenuItems({ menu: ownedMenu, panel, getRunningRuns, commands, sessionId, store })
  }
  }

  setupBackgroundCommandIndicator({ panel, leftControls, enabled: commands.length > 0, commands, sessionId, dismissComposerMenus })
}

function setupBackgroundCommandIndicator({ panel, leftControls, enabled, commands, sessionId, dismissComposerMenus }: {
  panel: HTMLElement
  leftControls: HTMLElement
  enabled: boolean
  commands: BackgroundCommandSummary[]
  sessionId: string
  dismissComposerMenus: () => void
}) {
  void panel
  let trigger = leftControls.querySelector<HTMLButtonElement>('.quickforge-background-command-trigger')
  if (!enabled) {
    trigger?.remove()
    return
  }
  if (!trigger) trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'quickforge-background-command-trigger relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground'
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-label', t('backgroundCommandIndicatorAria', { count: commands.length }))
  trigger.title = t('backgroundCommandIndicatorAria', { count: commands.length })
  trigger.innerHTML = `<span class="quickforge-background-command-icon" aria-hidden="true">${TERMINAL_ICON_SVG}</span><span class="quickforge-background-command-badge" aria-hidden="true">${commands.length}</span>`
  trigger.onpointerdown = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dismissComposerMenus()
    openBackgroundCommandMenu(trigger!, commands, sessionId)
  }
  const subagentTrigger = leftControls.querySelector('.quickforge-subagent-running-trigger')
  if (subagentTrigger?.nextSibling) leftControls.insertBefore(trigger, subagentTrigger.nextSibling)
  else leftControls.append(trigger)
}

function openBackgroundCommandMenu(trigger: HTMLButtonElement, commands: BackgroundCommandSummary[], sessionId: string) {
  const existing = document.querySelector('.quickforge-background-command-menu')
  if (existing) {
    existing.remove()
    return
  }
  const menu = document.createElement('div')
  menu.className = 'quickforge-background-command-menu quickforge-subagent-running-menu'
  menu.setAttribute('role', 'menu')
  const title = document.createElement('div')
  title.className = 'quickforge-subagent-running-menu-title'
  title.textContent = t('backgroundCommandMenuTitle', { count: commands.length })
  const list = document.createElement('div')
  list.className = 'quickforge-subagent-running-list'
  menu.append(title, list)
  renderBackgroundCommandItems({ list, commands, sessionId, onStopped: () => menu.remove() })
  document.body.append(menu)
  const rect = trigger.getBoundingClientRect()
  menu.style.left = `${Math.max(12, rect.left)}px`
  menu.style.top = `${Math.max(12, rect.top - menu.offsetHeight - 8)}px`
  const dismiss = (event: Event) => {
    if (menu.contains(event.target as Node) || trigger.contains(event.target as Node)) return
    menu.remove()
    document.removeEventListener('pointerdown', dismiss, true)
  }
  document.addEventListener('pointerdown', dismiss, true)
}
