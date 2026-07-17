import type { MessageWithUsage } from '../chat-utils'
import { t } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'

type ProcessGroupElement = HTMLDivElement

type ToolMessageElement = HTMLElement & {
  result?: unknown
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> }
  tool?: { name?: string }
  pending?: boolean
  aborted?: boolean
  isStreaming?: boolean
}

type ProcessNodeSegment<T> = {
  kind: 'detail' | 'tools'
  items: T[]
}

export type ProcessStageSection<T> = {
  kind: 'detail' | 'stage'
  items: T[]
}

type GroupedProcessNode = {
  node: HTMLElement
  sourceAssistant: AssistantMessageElement
  sourceParent: HTMLElement | null
  sourceNextSibling: ChildNode | null
}

export type ProcessToolSummary = {
  count: number
  errorCount: number
  commandsOnly: boolean
  editedFileCount?: number
}

type AssistantMessageElement = HTMLElement & {
  message?: MessageWithUsage & { stopReason?: string; errorMessage?: string }
  isStreaming?: boolean
}

const PROCESS_GROUP_SELECTOR = '.quickforge-process-group'
const PROCESS_BODY_SELECTOR = '.quickforge-process-body'
const PROCESS_TOOLS_SELECTOR = '.quickforge-process-tools'
const PROCESS_TOOLS_BODY_SELECTOR = '.quickforge-process-tools-body'
const PROCESS_STAGE_SELECTOR = '.quickforge-process-stage'
const PROCESS_STAGE_BODY_SELECTOR = '.quickforge-process-stage-body'
const PROCESS_NODE_SELECTOR = 'thinking-block, tool-message'
const PROCESS_DETAIL_NODE_SELECTOR = 'thinking-block, tool-message, markdown-block'
const PROCESS_FINAL_SUMMARY_ATTR = 'data-quickforge-process-final-summary'
const PROCESS_FOLDED_ATTR = 'data-quickforge-process-folded'
const PROCESS_EXPANDED_STATE_LIMIT = 500
const FILE_EDIT_TOOL_NAMES = new Set(['edit_file', 'write_file'])
const processExpandedStates = new WeakMap<HTMLElement, Map<string, boolean>>()
const processScopeIds = new WeakMap<HTMLElement, number>()
const groupedProcessNodeSequences = new WeakMap<ProcessGroupElement, GroupedProcessNode[]>()
let nextProcessScopeId = 1

function getProcessExpandedStates(panel: HTMLElement) {
  let states = processExpandedStates.get(panel)
  if (!states) {
    states = new Map()
    processExpandedStates.set(panel, states)
  }
  return states
}

function rememberProcessExpandedState(panel: HTMLElement, key: string, expanded: boolean) {
  const states = getProcessExpandedStates(panel)
  states.set(key, expanded)
  if (states.size <= PROCESS_EXPANDED_STATE_LIMIT) return

  const oldestKey = states.keys().next().value
  if (oldestKey) states.delete(oldestKey)
}

export type ProcessGroupAnchorSource = {
  connected: boolean
}

export function processGroupAnchorIndex(sources: ProcessGroupAnchorSource[]) {
  return sources.findIndex((source) => source.connected)
}

export type ProcessGroupTargetSource = {
  streaming: boolean
  hasGroup: boolean
}

export function processGroupTargetIndex(sources: ProcessGroupTargetSource[]) {
  const existingStableGroup = sources.findIndex((source) => !source.streaming && source.hasGroup)
  if (existingStableGroup >= 0) return existingStableGroup

  for (let index = sources.length - 1; index >= 0; index -= 1) {
    if (!sources[index]?.streaming) return index
  }
  return Math.max(0, sources.length - 1)
}

function processScopeId(panel: HTMLElement) {
  let scopeId = processScopeIds.get(panel)
  if (scopeId === undefined) {
    scopeId = nextProcessScopeId++
    processScopeIds.set(panel, scopeId)
  }
  return scopeId
}

function processTurnStateKey(panel: HTMLElement, assistants: AssistantMessageElement[], turnIndex: number) {
  const firstTimestamp = timestampFromUnknown(assistants[0]?.message?.timestamp)
  return `scope:${processScopeId(panel)}:turn:${turnIndex}:started:${firstTimestamp ?? 'unknown'}`
}

export function resolveProcessExpandedState(
  savedExpanded: boolean | undefined,
  previousKeyMatches: boolean,
  currentExpanded: boolean,
  defaultExpanded: boolean,
) {
  if (savedExpanded !== undefined) return savedExpanded
  if (previousKeyMatches) return currentExpanded
  return defaultExpanded
}

function syncProcessGroupExpandedState(
  panel: HTMLElement,
  group: ProcessGroupElement,
  key: string,
  defaultExpanded = false,
) {
  const previousKey = group.dataset.quickforgeProcessKey
  group.dataset.quickforgeProcessKey = key

  const states = getProcessExpandedStates(panel)
  const savedExpanded = states.get(key)
  const expanded = resolveProcessExpandedState(
    savedExpanded,
    previousKey === key,
    group.dataset.expanded === 'true',
    defaultExpanded,
  )
  group.dataset.expanded = String(expanded)
  if (savedExpanded === undefined && defaultExpanded) {
    rememberProcessExpandedState(panel, key, expanded)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestampFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined

    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) return numeric

    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function toolTimingFromResult(result: unknown) {
  if (!isRecord(result)) return undefined
  const details = result.details
  if (!isRecord(details)) return undefined
  const timing = details.quickforgeTiming
  if (!isRecord(timing)) return undefined

  const startedAt = numberFromUnknown(timing.startedAt)
  const finishedAt = numberFromUnknown(timing.finishedAt)
  const durationMs = numberFromUnknown(timing.durationMs)
  return { startedAt, finishedAt, durationMs }
}

function toolMessageFinishedAt(toolMessage: ToolMessageElement): number | undefined {
  const resultTiming = toolTimingFromResult(toolMessage.result)
  if (resultTiming?.finishedAt !== undefined) return resultTiming.finishedAt
  if (resultTiming?.startedAt !== undefined && resultTiming.durationMs !== undefined) {
    return resultTiming.startedAt + resultTiming.durationMs
  }
  return undefined
}

function toolMessageStartedAt(toolMessage: ToolMessageElement): number | undefined {
  return toolTimingFromResult(toolMessage.result)?.startedAt
}

function messageProcessFinishedAt(message: MessageWithUsage) {
  if (!isRecord(message.details)) return undefined
  return timestampFromUnknown(message.details.quickforgeProcessFinishedAt)
}

export function processFinishedAtFromMessages(messages: MessageWithUsage[]) {
  const finishedTimes = messages
    .map(messageProcessFinishedAt)
    .filter((value): value is number => value !== undefined)
  return finishedTimes.length > 0 ? Math.max(...finishedTimes) : undefined
}

export function formatProcessDuration(durationMs?: number) {
  if (durationMs === undefined || durationMs < 1000) return ''
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0
    ? t('processDurationMinutesSeconds', { minutes, seconds })
    : t('processDurationSeconds', { seconds })
}

function toolNameFromMessage(toolMessage: ToolMessageElement) {
  return toolMessage.tool?.name || toolMessage.toolCall?.name || ''
}

export function isProcessToolsGroupMember(toolName: string) {
  return toolName !== 'run_subagent' && toolName !== 'generate_image'
}

function isGroupableProcessTool(node: HTMLElement) {
  return node.tagName.toLowerCase() === 'tool-message'
    && isProcessToolsGroupMember(toolNameFromMessage(node as ToolMessageElement))
}

function toolMessageIsError(toolMessage: ToolMessageElement) {
  if (toolMessage.aborted) return true
  return isRecord(toolMessage.result) && toolMessage.result.isError === true
}

function toolMessageEditedFilePath(toolMessage: ToolMessageElement) {
  if (!FILE_EDIT_TOOL_NAMES.has(toolNameFromMessage(toolMessage))) return undefined

  const argumentPath = toolMessage.toolCall?.arguments?.path
  if (typeof argumentPath === 'string' && argumentPath.trim()) return argumentPath.trim()

  const resultDetails = isRecord(toolMessage.result) ? toolMessage.result.details : undefined
  const resultPath = isRecord(resultDetails) ? resultDetails.path : undefined
  return typeof resultPath === 'string' && resultPath.trim() ? resultPath.trim() : undefined
}

export function summarizeProcessTools(toolMessages: ArrayLike<ToolMessageElement>): ProcessToolSummary {
  const messages = Array.from(toolMessages)
  const editedPaths = messages.map(toolMessageEditedFilePath)
  const editedFilePaths = new Set(editedPaths.filter((path): path is string => Boolean(path)))
  const editsOnly = messages.length > 0 && messages.every((message) => FILE_EDIT_TOOL_NAMES.has(toolNameFromMessage(message)))
  const allEditedPathsKnown = editedPaths.every((path) => path !== undefined)
  return {
    count: messages.length,
    errorCount: messages.filter(toolMessageIsError).length,
    commandsOnly: messages.length > 0 && messages.every((message) => toolNameFromMessage(message) === 'run_command'),
    ...(editsOnly && allEditedPathsKnown ? { editedFileCount: editedFilePaths.size } : {}),
  }
}

export type ProcessStageSummary = {
  toolCallCount: number
  commandCount: number
  editedFileCount: number
}

export function summarizeProcessStageTools(toolMessages: ArrayLike<ToolMessageElement>): ProcessStageSummary {
  const messages = Array.from(toolMessages)
  const editedPaths = messages.map(toolMessageEditedFilePath)
  const editedFilePaths = new Set(editedPaths.filter((path): path is string => Boolean(path)))
  return {
    toolCallCount: messages.length,
    commandCount: messages.filter((message) => toolNameFromMessage(message) === 'run_command').length,
    editedFileCount: editedFilePaths.size,
  }
}

export function processStageLabel(summary: ProcessStageSummary, isStreaming: boolean) {
  const details: string[] = []
  if (summary.toolCallCount > 0) details.push(t('processGroupToolsCalled', { count: summary.toolCallCount }))
  if (summary.commandCount > 0) details.push(t('processGroupCommandsRan', { count: summary.commandCount }))
  if (summary.editedFileCount > 0) details.push(t('processGroupFilesEdited', { count: summary.editedFileCount }))
  const status = isStreaming ? t('processExecuting') : t('processExecuted')
  return details.length > 0 ? `${status}  ${details.join(' · ')}` : status
}

function processToolsLabel(summary: ProcessToolSummary) {
  const key = summary.commandsOnly
    ? 'processCommandsRan'
    : summary.editedFileCount !== undefined
      ? 'processFilesEdited'
      : 'processToolsCalled'
  const count = summary.editedFileCount ?? summary.count
  const base = t(key, { count })
  return summary.errorCount > 0
    ? `${base} · ${t('processToolsFailedCount', { count: summary.errorCount })}`
    : base
}

export function processStatusLabel(status: string, duration: string) {
  return [status, duration].filter(Boolean).join(' · ')
}

function processGroupLabel(
  assistants: AssistantMessageElement[],
  group: ProcessGroupElement,
  isAgentStreaming: boolean,
) {
  const groupedNodes = groupedProcessNodes(group).map(({ node }) => node)
  const toolMessages = groupedNodes.filter(
    (node): node is ToolMessageElement => node.tagName.toLowerCase() === 'tool-message',
  )
  const starts = [
    ...assistants.map((assistant) => timestampFromUnknown(assistant.message?.timestamp)),
    ...toolMessages.map(toolMessageStartedAt),
  ].filter((value): value is number => value !== undefined)
  const finishedTimes = [
    processFinishedAtFromMessages(assistants.map((assistant) => assistant.message ?? {})),
    ...toolMessages.map(toolMessageFinishedAt),
  ].filter((value): value is number => value !== undefined)
  const startedAt = starts.length > 0 ? Math.min(...starts) : undefined
  let finishedAt = finishedTimes.length > 0 ? Math.max(...finishedTimes) : undefined

  if (isAgentStreaming) {
    finishedAt = Date.now()
  } else {
    const cachedFinishedAt = timestampFromUnknown(group.dataset.quickforgeFinishedAt)
    if (cachedFinishedAt !== undefined && cachedFinishedAt > 0) {
      finishedAt = cachedFinishedAt
    } else {
      finishedAt = finishedAt ?? Date.now()
      group.dataset.quickforgeFinishedAt = String(finishedAt)
    }
  }

  const duration = startedAt !== undefined && finishedAt !== undefined
    ? formatProcessDuration(Math.max(0, finishedAt - startedAt))
    : ''
  const stopReason = [...assistants].reverse().find((assistant) => assistant.message?.stopReason)?.message?.stopReason
  const status = stopReason === 'error'
    ? t('processFailed')
    : stopReason === 'aborted'
      ? t('processAborted')
      : isAgentStreaming
        ? t('processExecuting')
        : t('processExecuted')
  return processStatusLabel(status, duration)
}

function assistantMessageList(assistant: AssistantMessageElement) {
  return assistant.closest('message-list')
}

function processDetailIsInAssistantScope(node: HTMLElement, assistant: AssistantMessageElement) {
  return node.closest('message-list') === assistantMessageList(assistant) && isTopLevelProcessDetail(node)
}

function processGroupsOwnedByAssistant(assistant: AssistantMessageElement) {
  return Array.from(assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR))
    .filter((group) => group.closest('assistant-message') === assistant)
}

function assistantContentContainer(assistant: AssistantMessageElement) {
  const contentNode = assistant.querySelector<HTMLElement>(`${PROCESS_DETAIL_NODE_SELECTOR}, ${PROCESS_GROUP_SELECTOR}`)
  return contentNode?.closest<HTMLElement>('.px-4.flex.flex-col') ?? contentNode?.parentElement ?? null
}

function createProcessStep() {
  const step = document.createElement('div')
  step.className = 'quickforge-process-step'
  return step
}

function thinkingIconMarkup() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></svg>'
}

function toolsIconMarkup() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/></svg>'
}

export type ProcessThinkingChild = {
  quickforgeIcon?: boolean
  markedChevron?: boolean
  markedLabel?: boolean
  hasSvg?: boolean
  rotated?: boolean
}

export function processThinkingChildIndexes(children: ProcessThinkingChild[]) {
  const candidates = children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => !child.quickforgeIcon)
  const chevron = candidates.find(({ child }) => child.markedChevron)
    ?? candidates.find(({ child }) => child.hasSvg)
  const label = candidates.find(({ child, index }) => child.markedLabel && index !== chevron?.index)
    ?? candidates.find(({ index }) => index !== chevron?.index)
  return {
    chevronIndex: chevron?.index,
    labelIndex: label?.index,
    chevronExpanded: chevron?.child.rotated === true,
  }
}

function decorateProcessThinkingBlocks(group: ProcessGroupElement) {
  group.querySelectorAll<HTMLElement>('thinking-block').forEach((thinkingBlock) => {
    if (thinkingBlock.closest(PROCESS_GROUP_SELECTOR) !== group) return
    const header = thinkingBlock.querySelector<HTMLElement>(':scope > .thinking-block > .thinking-header')
    if (!header) return

    const children = Array.from(header.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
    const { chevronIndex, labelIndex, chevronExpanded } = processThinkingChildIndexes(children.map((child) => ({
      quickforgeIcon: child.dataset.quickforgeThinkingRole === 'icon' || child.classList.contains('quickforge-process-thinking-icon'),
      markedChevron: child.dataset.quickforgeThinkingRole === 'chevron',
      markedLabel: child.dataset.quickforgeThinkingRole === 'label',
      hasSvg: Boolean(child.querySelector('svg')),
      rotated: child.classList.contains('rotate-90') || child.classList.contains('quickforge-process-thinking-chevron-expanded'),
    })))
    const chevron = chevronIndex === undefined ? undefined : children[chevronIndex]
    const label = labelIndex === undefined ? undefined : children[labelIndex]
    if (!chevron || !label) return

    chevron.dataset.quickforgeThinkingRole = 'chevron'
    label.dataset.quickforgeThinkingRole = 'label'
    chevron.className = 'quickforge-process-thinking-chevron'
    chevron.classList.toggle('quickforge-process-thinking-chevron-expanded', chevronExpanded)
    label.className = 'quickforge-process-thinking-label'
    label.textContent = t('processThinking')

    let icon = children.find((child) => (
      child.dataset.quickforgeThinkingRole === 'icon'
      || child.classList.contains('quickforge-process-thinking-icon')
    ))
    if (!icon) {
      icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = thinkingIconMarkup()
    }
    icon.dataset.quickforgeThinkingRole = 'icon'
    icon.classList.add('quickforge-process-thinking-icon')

    header.prepend(icon)
    header.append(label, chevron)
    header.className = 'thinking-header quickforge-process-thinking-header'
  })
}

function createProcessToolsGroup() {
  const tools = document.createElement('div')
  tools.className = 'quickforge-process-tools'
  tools.dataset.expanded = 'false'

  const toolsSummary = document.createElement('button')
  toolsSummary.type = 'button'
  toolsSummary.className = 'quickforge-process-tools-summary'
  toolsSummary.innerHTML = `
    <span class="quickforge-process-tools-icon" aria-hidden="true">
      ${toolsIconMarkup()}
    </span>
    <span class="quickforge-process-tools-label"></span>
    <span class="quickforge-process-tools-chevron" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </span>
  `

  const toolsBody = document.createElement('div')
  toolsBody.className = 'quickforge-process-tools-body'
  tools.append(toolsSummary, toolsBody)
  return tools
}

function createProcessStage() {
  const stage = document.createElement('div')
  stage.className = 'quickforge-process-stage'
  stage.dataset.expanded = 'false'

  const summary = document.createElement('button')
  summary.type = 'button'
  summary.className = 'quickforge-process-stage-summary'
  summary.innerHTML = `
    <span class="quickforge-process-stage-label"></span>
    <span class="quickforge-process-stage-chevron" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </span>
  `

  const body = document.createElement('div')
  body.className = 'quickforge-process-stage-body'
  stage.append(summary, body)
  return stage
}

function createProcessGroup() {
  const group = document.createElement('div') as ProcessGroupElement
  group.className = 'quickforge-process-group'
  group.dataset.expanded = 'false'

  const summary = document.createElement('button')
  summary.type = 'button'
  summary.className = 'quickforge-process-summary'
  summary.innerHTML = `
    <span class="quickforge-process-label"></span>
    <span class="quickforge-process-chevron" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
    </span>
  `

  const body = document.createElement('div')
  body.className = 'quickforge-process-body'

  group.append(summary, body)
  return group
}

export function processStageDefaultExpanded() {
  return false
}

export function processStageStateKey(processKey: string, index: number) {
  return `${processKey}:stage:${index}`
}

function updateProcessStageGroups(
  panel: HTMLElement,
  processKey: string,
  group: ProcessGroupElement,
  isAgentStreaming: boolean,
) {
  const stages = Array.from(group.querySelectorAll<HTMLElement>(PROCESS_STAGE_SELECTOR))
    .filter((stage) => stage.closest(PROCESS_GROUP_SELECTOR) === group)
  stages.forEach((stage, index) => {
    const stageBody = stage.querySelector<HTMLElement>(`:scope > ${PROCESS_STAGE_BODY_SELECTOR}`)
    const stageSummary = stage.querySelector<HTMLButtonElement>(':scope > .quickforge-process-stage-summary')
    const stageLabel = stage.querySelector<HTMLElement>(':scope > .quickforge-process-stage-summary > .quickforge-process-stage-label')
    if (!stageBody || !stageSummary || !stageLabel) return

    const stageKey = processStageStateKey(processKey, index)
    const stageBodyId = `quickforge-${stageKey.replace(/[^a-z0-9_-]+/gi, '-')}`
    const previousStageKey = stage.dataset.quickforgeProcessKey
    stage.dataset.quickforgeProcessKey = stageKey
    const expanded = resolveProcessExpandedState(
      getProcessExpandedStates(panel).get(stageKey),
      previousStageKey === stageKey,
      stage.dataset.expanded === 'true',
      processStageDefaultExpanded(),
    )
    stage.dataset.expanded = String(expanded)
    const stageStreaming = isAgentStreaming && index === stages.length - 1
    stageLabel.textContent = processStageLabel(summarizeProcessStageTools(
      stageBody.querySelectorAll<ToolMessageElement>('tool-message'),
    ), stageStreaming)
    stageBody.id = stageBodyId
    stageSummary.setAttribute('aria-controls', stageBodyId)
    stageSummary.setAttribute('aria-expanded', String(expanded))
    stageSummary.setAttribute('aria-label', `${stageLabel.textContent} · ${expanded ? t('collapseProcess') : t('expandProcess')}`)
    stageSummary.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const nextExpanded = stage.dataset.expanded !== 'true'
      stage.dataset.expanded = String(nextExpanded)
      rememberProcessExpandedState(panel, stageKey, nextExpanded)
      stageSummary.setAttribute('aria-expanded', String(nextExpanded))
      stageSummary.setAttribute('aria-label', `${stageLabel.textContent} · ${nextExpanded ? t('collapseProcess') : t('expandProcess')}`)
    }
  })
}

export function processToolGroupStateKey(processKey: string, firstToolId: string | undefined, index: number) {
  return firstToolId
    ? `${processKey}:tools:${firstToolId}`
    : `${processKey}:tools:${index}`
}

function toolGroupStateKey(processKey: string, tools: HTMLElement, index: number) {
  const toolMessages = Array.from(tools.querySelectorAll<ToolMessageElement>('tool-message'))
  return processToolGroupStateKey(processKey, toolMessages[0]?.toolCall?.id, index)
}

function updateProcessToolsGroups(panel: HTMLElement, processKey: string, group: ProcessGroupElement) {
  group.querySelectorAll<HTMLElement>(PROCESS_TOOLS_SELECTOR).forEach((tools, index) => {
    if (tools.closest(PROCESS_GROUP_SELECTOR) !== group) return
    const toolsBody = tools.querySelector<HTMLElement>(`:scope > ${PROCESS_TOOLS_BODY_SELECTOR}`)
    const toolsSummary = tools.querySelector<HTMLButtonElement>('.quickforge-process-tools-summary')
    const toolsLabel = tools.querySelector<HTMLElement>('.quickforge-process-tools-label')
    if (!toolsBody || !toolsSummary || !toolsLabel) return

    const summary = summarizeProcessTools(toolsBody.querySelectorAll<ToolMessageElement>(':scope > tool-message'))
    tools.hidden = summary.count === 0
    if (summary.count === 0) return

    const toolsKey = toolGroupStateKey(processKey, tools, index)
    const toolsBodyId = `quickforge-${toolsKey.replace(/[^a-z0-9_-]+/gi, '-')}`
    toolsBody.id = toolsBodyId
    toolsSummary.setAttribute('aria-controls', toolsBodyId)
    const detailed = getCachedToolDisplaySettings().toolDisplayMode === 'detailed'
    const displayMode = detailed ? 'detailed' : 'compact'
    const previousToolsKey = tools.dataset.quickforgeProcessKey
    const previousDisplayMode = tools.dataset.quickforgeToolDisplayMode
    tools.dataset.quickforgeProcessKey = toolsKey
    tools.dataset.quickforgeToolDisplayMode = displayMode
    const expanded = resolveProcessExpandedState(
      getProcessExpandedStates(panel).get(toolsKey),
      previousToolsKey === toolsKey && previousDisplayMode === displayMode,
      tools.dataset.expanded === 'true',
      detailed,
    )
    tools.dataset.expanded = String(expanded)
    toolsLabel.textContent = processToolsLabel(summary)
    toolsSummary.setAttribute('aria-expanded', String(expanded))
    toolsSummary.setAttribute('aria-label', expanded ? t('collapseProcessTools') : t('expandProcessTools'))
    toolsSummary.onclick = (event) => {
      event.preventDefault()
      event.stopPropagation()
      const nextExpanded = tools.dataset.expanded === 'false'
      tools.dataset.expanded = String(nextExpanded)
      rememberProcessExpandedState(panel, toolsKey, nextExpanded)
      toolsSummary.setAttribute('aria-expanded', String(nextExpanded))
      toolsSummary.setAttribute('aria-label', nextExpanded ? t('collapseProcessTools') : t('expandProcessTools'))
    }
  })
}

export function shouldToggleProcessSummary(
  isStreaming: boolean,
  eventType: 'pointerdown' | 'click',
  options: { button?: number; isPrimary?: boolean; detail?: number } = {},
) {
  if (eventType === 'pointerdown') {
    return isStreaming && (options.button ?? 0) === 0 && options.isPrimary !== false
  }
  return !isStreaming || (options.detail ?? 0) === 0
}

function updateProcessGroup(
  panel: HTMLElement,
  processKey: string,
  assistants: AssistantMessageElement[],
  group: ProcessGroupElement,
  isAgentStreaming: boolean,
) {
  syncProcessGroupExpandedState(panel, group, processKey, isAgentStreaming)
  group.dataset.streaming = String(isAgentStreaming)
  const body = group.querySelector<HTMLElement>(`:scope > ${PROCESS_BODY_SELECTOR}`)
  const summary = group.querySelector<HTMLButtonElement>('.quickforge-process-summary')
  const label = group.querySelector<HTMLElement>('.quickforge-process-label')
  if (!body || !summary || !label) return

  const nextLabel = processGroupLabel(assistants, group, isAgentStreaming)
  if (label.textContent !== nextLabel) label.textContent = nextLabel

  const expanded = group.dataset.expanded === 'true'
  const bodyId = `quickforge-${processKey.replace(/[^a-z0-9_-]+/gi, '-')}`
  body.id = bodyId
  summary.setAttribute('aria-controls', bodyId)
  summary.setAttribute('aria-expanded', String(expanded))
  summary.setAttribute('aria-label', `${nextLabel} · ${expanded ? t('collapseProcess') : t('expandProcess')}`)

  const toggleExpanded = () => {
    const nextExpanded = group.dataset.expanded !== 'true'
    group.dataset.expanded = String(nextExpanded)
    rememberProcessExpandedState(panel, processKey, nextExpanded)
    summary.setAttribute('aria-expanded', String(nextExpanded))
    summary.setAttribute('aria-label', `${nextLabel} · ${nextExpanded ? t('collapseProcess') : t('expandProcess')}`)
  }
  summary.onpointerdown = (event) => {
    if (!shouldToggleProcessSummary(isAgentStreaming, 'pointerdown', event)) return
    event.stopPropagation()
    toggleExpanded()
  }
  summary.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!shouldToggleProcessSummary(isAgentStreaming, 'click', event)) return
    toggleExpanded()
  }

  updateProcessStageGroups(panel, processKey, group, isAgentStreaming)
  updateProcessToolsGroups(panel, processKey, group)
  decorateProcessThinkingBlocks(group)
}

function setProcessFlag(node: HTMLElement, attr: string, enabled: boolean) {
  if (enabled) {
    if (!node.hasAttribute(attr)) node.setAttribute(attr, 'true')
    return
  }
  if (node.hasAttribute(attr)) node.removeAttribute(attr)
}

export function isTopLevelProcessDetail(node: HTMLElement) {
  const processScope = node.closest('message-list')
  const parentProcessDetail = node.parentElement?.closest(PROCESS_DETAIL_NODE_SELECTOR)
  return !parentProcessDetail || parentProcessDetail.closest('message-list') !== processScope
}

function markdownCandidates(target: AssistantMessageElement) {
  const processScope = assistantMessageList(target)
  return Array.from(target.querySelectorAll<HTMLElement>('markdown-block'))
    .filter((node) => {
      if (node.closest('message-list') !== processScope) return false
      const parentProcessNode = node.parentElement?.closest(PROCESS_NODE_SELECTOR)
      return !parentProcessNode || parentProcessNode.closest('message-list') !== processScope
    })
}

function lastNonEmptyOrLast(candidates: HTMLElement[]) {
  const nonEmptyCandidates = candidates.filter((node) => (node.textContent ?? '').trim().length > 0)
  return nonEmptyCandidates[nonEmptyCandidates.length - 1] ?? candidates[candidates.length - 1] ?? null
}

function hasFollowingTopLevelProcessDetail(target: AssistantMessageElement, candidate: HTMLElement) {
  return Array.from(target.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR))
    .filter((node) => node !== candidate && processDetailIsInAssistantScope(node, target))
    .some((node) => Boolean(candidate.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
}

function findFinalSummaryMarkdown(target: AssistantMessageElement, isAgentStreaming: boolean) {
  const candidates = markdownCandidates(target)
  if (isAgentStreaming) {
    const candidate = lastNonEmptyOrLast(candidates)
    return candidate && !hasFollowingTopLevelProcessDetail(target, candidate) ? candidate : null
  }

  const markedFinalSummary = lastNonEmptyOrLast(candidates.filter((node) => node.hasAttribute(PROCESS_FINAL_SUMMARY_ATTR)))
  if (markedFinalSummary) return markedFinalSummary

  const visibleCandidates = candidates.filter((node) => !node.closest(PROCESS_BODY_SELECTOR))
  return lastNonEmptyOrLast(visibleCandidates) ?? lastNonEmptyOrLast(candidates)
}

function markFinalSummaryMarkdown(target: AssistantMessageElement, finalSummaryMarkdown: HTMLElement | null) {
  markdownCandidates(target).forEach((node) => {
    setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, node === finalSummaryMarkdown)
    if (node === finalSummaryMarkdown) setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
  })
}

function hasTurnProcessSignals(assistants: AssistantMessageElement[]) {
  return assistants.length > 1 || assistants.some((assistant) => (
    Array.from(assistant.querySelectorAll<HTMLElement>(PROCESS_NODE_SELECTOR))
      .some((node) => node.closest('message-list') === assistantMessageList(assistant))
  ))
}

function collectProcessTimeline(assistants: AssistantMessageElement[]) {
  const previousByNode = new Map<HTMLElement, GroupedProcessNode>()
  assistants.forEach((assistant) => {
    processGroupsOwnedByAssistant(assistant).forEach((group) => {
      groupedProcessNodeSequences.get(group)?.forEach((item) => previousByNode.set(item.node, item))
    })
  })

  return assistants.flatMap((renderedAssistant) => (
    Array.from(renderedAssistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR))
      .filter((node) => processDetailIsInAssistantScope(node, renderedAssistant))
      .map((node) => previousByNode.get(node) ?? {
        node,
        sourceAssistant: renderedAssistant,
        sourceParent: node.parentElement,
        sourceNextSibling: node.nextSibling,
      })
  ))
}

export function selectFoldableProcessItems<T>(
  items: T[],
  isFinalSummary: (item: T) => boolean,
  isMarkdown: (item: T) => boolean,
  canFoldMarkdown: boolean,
) {
  return items.filter((item) => !isFinalSummary(item) && (!isMarkdown(item) || canFoldMarkdown))
}

function collectFoldableProcessNodes(
  assistants: AssistantMessageElement[],
  finalSummaryMarkdown: HTMLElement | null,
  canFoldMarkdown: boolean,
) {
  return selectFoldableProcessItems(
    collectProcessTimeline(assistants),
    (item) => item.node === finalSummaryMarkdown,
    (item) => item.node.tagName.toLowerCase() === 'markdown-block',
    canFoldMarkdown,
  )
}

export function splitProcessStageSections<T>(items: T[], isMarkdown: (item: T) => boolean): ProcessStageSection<T>[] {
  const sections: ProcessStageSection<T>[] = []
  let processItems: T[] = []
  let hasSeenMarkdown = false

  const closeProcess = () => {
    if (processItems.length === 0) return
    sections.push({ kind: hasSeenMarkdown ? 'stage' : 'detail', items: processItems })
    processItems = []
  }

  for (const item of items) {
    if (isMarkdown(item)) {
      closeProcess()
      sections.push({ kind: 'detail', items: [item] })
      hasSeenMarkdown = true
    } else {
      processItems.push(item)
    }
  }
  closeProcess()
  return sections
}

export function splitConsecutiveProcessNodes<T>(nodes: T[], isTool: (node: T) => boolean): ProcessNodeSegment<T>[] {
  const segments: ProcessNodeSegment<T>[] = []
  for (const node of nodes) {
    const kind = isTool(node) ? 'tools' : 'detail'
    const previous = segments[segments.length - 1]
    if (previous?.kind === kind) {
      previous.items.push(node)
    } else {
      segments.push({ kind, items: [node] })
    }
  }
  return segments
}

function processBodyHasContent(group: ProcessGroupElement) {
  return Boolean(group.querySelector<HTMLElement>(`${PROCESS_BODY_SELECTOR} ${PROCESS_DETAIL_NODE_SELECTOR}`))
}

function groupedProcessNodes(group: ProcessGroupElement): GroupedProcessNode[] {
  return groupedProcessNodeSequences.get(group)
    ?? Array.from(group.querySelectorAll<HTMLElement>(`${PROCESS_BODY_SELECTOR} ${PROCESS_DETAIL_NODE_SELECTOR}`))
      .filter((node) => node.closest(PROCESS_GROUP_SELECTOR) === group)
      .map((node) => ({
        node,
        sourceAssistant: group.closest<AssistantMessageElement>('assistant-message') ?? group.parentElement as AssistantMessageElement,
        sourceParent: group.parentElement,
        sourceNextSibling: group,
      }))
}

function restoreGroupedProcessNode(item: GroupedProcessNode, group: ProcessGroupElement) {
  const { node, sourceParent, sourceNextSibling } = item
  setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
  setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)

  if (sourceParent?.isConnected) {
    if (sourceNextSibling?.parentNode === sourceParent) {
      sourceParent.insertBefore(node, sourceNextSibling)
    } else {
      sourceParent.append(node)
    }
    return
  }

  const container = assistantContentContainer(item.sourceAssistant)
  if (container) container.insertBefore(node, container.querySelector(PROCESS_GROUP_SELECTOR))
  else group.parentElement?.insertBefore(node, group)
}

export function shouldDiscardGroupedProcessNode(sourceStillCurrent: boolean, hasCurrentReplacement: boolean) {
  return !sourceStillCurrent || hasCurrentReplacement
}

function groupedProcessNodeHasCurrentReplacement(item: GroupedProcessNode) {
  if (!item.sourceAssistant.isConnected) return false
  const tagName = item.node.tagName.toLowerCase()
  const toolCallId = tagName === 'tool-message'
    ? (item.node as ToolMessageElement).toolCall?.id
    : undefined
  return Array.from(item.sourceAssistant.querySelectorAll<HTMLElement>(PROCESS_NODE_SELECTOR))
    .filter((node) => node !== item.node && !node.closest(PROCESS_GROUP_SELECTOR))
    .filter((node) => processDetailIsInAssistantScope(node, item.sourceAssistant))
    .some((node) => {
      if (node.tagName.toLowerCase() !== tagName) return false
      if (tagName !== 'tool-message' || !toolCallId) return true
      return (node as ToolMessageElement).toolCall?.id === toolCallId
    })
}

function discardGroupedProcessNode(item: GroupedProcessNode) {
  setProcessFlag(item.node, PROCESS_FOLDED_ATTR, false)
  setProcessFlag(item.node, PROCESS_FINAL_SUMMARY_ATTR, false)
  item.node.remove()
}

function restoreProcessTurn(assistants: AssistantMessageElement[], discardStaleStreamingNodes = false) {
  const currentAssistants = new Set(assistants)
  for (const assistant of assistants) {
    assistant.classList.remove('quickforge-process-source-empty')
    processGroupsOwnedByAssistant(assistant).forEach((group) => {
      groupedProcessNodes(group).slice().reverse().forEach((item) => {
        if (discardStaleStreamingNodes && shouldDiscardGroupedProcessNode(
          currentAssistants.has(item.sourceAssistant),
          groupedProcessNodeHasCurrentReplacement(item),
        )) {
          discardGroupedProcessNode(item)
        } else {
          restoreGroupedProcessNode(item, group)
        }
      })
      groupedProcessNodeSequences.delete(group)
      group.remove()
    })
  }
}

export function releaseStreamingProcessGroups(panel: HTMLElement) {
  panel.querySelectorAll<ProcessGroupElement>(`${PROCESS_GROUP_SELECTOR}[data-streaming="true"]`).forEach((group) => {
    const groupedNodes = groupedProcessNodes(group)
    const sourceAssistants = new Set(groupedNodes.map((item) => item.sourceAssistant))
    const owner = group.closest<AssistantMessageElement>('assistant-message')
    if (owner) sourceAssistants.add(owner)
    sourceAssistants.forEach((assistant) => assistant.classList.remove('quickforge-process-source-empty'))
    groupedNodes.slice().reverse().forEach((item) => restoreGroupedProcessNode(item, group))
    groupedProcessNodeSequences.delete(group)
    group.remove()
  })
}

export function processNodeSequenceIsCurrent(
  previous: Array<{ node: { isConnected: boolean }; sourceAssistant: unknown }> | undefined,
  current: Array<{ node: unknown; sourceAssistant: unknown }>,
) {
  return Boolean(previous && previous.length === current.length && previous.every((item, index) => (
    item.node.isConnected
    && item.node === current[index]?.node
    && item.sourceAssistant === current[index]?.sourceAssistant
  )))
}

export function processToolSuffixAppendStart(
  previous: Array<{ node: { isConnected: boolean; tagName: string }; sourceAssistant: unknown }> | undefined,
  current: Array<{ node: { tagName: string }; sourceAssistant: unknown }>,
) {
  if (!previous || previous.length === 0 || current.length <= previous.length) return undefined
  const prefixMatches = previous.every((item, index) => (
    item.node.isConnected
    && item.node === current[index]?.node
    && item.sourceAssistant === current[index]?.sourceAssistant
  ))
  if (!prefixMatches) return undefined

  const previousTail = previous[previous.length - 1]
  if (!isGroupableProcessTool(previousTail.node as HTMLElement)) return undefined
  const appended = current.slice(previous.length)
  return appended.every((item) => isGroupableProcessTool(item.node as HTMLElement))
    ? previous.length
    : undefined
}

function populateProcessContainer(container: HTMLElement, items: GroupedProcessNode[]) {
  const step = createProcessStep()
  const segments = splitConsecutiveProcessNodes(items, (item) => isGroupableProcessTool(item.node))
  for (const segment of segments) {
    if (segment.kind === 'tools') {
      const tools = createProcessToolsGroup()
      const toolsBody = tools.querySelector<HTMLElement>(PROCESS_TOOLS_BODY_SELECTOR)
      if (!toolsBody) continue
      segment.items.forEach(({ node }) => {
        setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
        toolsBody.append(node)
      })
      step.append(tools)
      continue
    }

    segment.items.forEach(({ node }) => {
      setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
      step.append(node)
    })
  }
  container.append(step)
}

function populateProcessGroup(group: ProcessGroupElement, items: GroupedProcessNode[]) {
  const body = group.querySelector<HTMLElement>(`:scope > ${PROCESS_BODY_SELECTOR}`)
  if (!body) return false

  const sections = splitProcessStageSections(
    items,
    (item) => item.node.tagName.toLowerCase() === 'markdown-block',
  )
  for (const section of sections) {
    if (section.kind === 'detail') {
      populateProcessContainer(body, section.items)
      continue
    }

    const stage = createProcessStage()
    const stageBody = stage.querySelector<HTMLElement>(PROCESS_STAGE_BODY_SELECTOR)
    if (!stageBody) continue
    populateProcessContainer(stageBody, section.items)
    body.append(stage)
  }
  groupedProcessNodeSequences.set(group, items)
  return processBodyHasContent(group)
}

function createTurnProcessGroup(
  items: GroupedProcessNode[],
  assistants: AssistantMessageElement[],
) {
  const anchorIndex = processGroupAnchorIndex(items.map((item) => ({
    connected: item.sourceParent?.isConnected === true && item.node.isConnected,
  })))
  const anchor = anchorIndex >= 0 ? items[anchorIndex] : undefined
  const stableAssistant = [...assistants].reverse().find((assistant) => assistant.isStreaming !== true)
  const stableContainer = stableAssistant ? assistantContentContainer(stableAssistant) : null
  if (!anchor?.sourceParent?.isConnected && !stableContainer) return null

  const group = createProcessGroup()
  if (anchor?.sourceParent?.isConnected) {
    anchor.sourceParent.insertBefore(group, anchor.node)
  } else if (stableContainer) {
    stableContainer.append(group)
  }
  return populateProcessGroup(group, items) ? group : null
}

function updateEmptyProcessSources(assistants: AssistantMessageElement[]) {
  for (const assistant of assistants) {
    const hasVisibleContent = Boolean(
      Array.from(assistant.querySelectorAll<HTMLElement>('markdown-block, thinking-block, tool-message, .quickforge-process-group, .quickforge-approval-card'))
        .some((node) => node.closest('message-list') === assistantMessageList(assistant)),
    )
    assistant.classList.toggle('quickforge-process-source-empty', !hasVisibleContent)
  }
}

/**
 * Structural fingerprint of a turn's foldable content.
 *
 * Used to short-circuit re-decoration of already-grouped, non-streaming turns.
 * During streaming only the trailing turn changes, so every preceding turn's
 * fingerprint stays stable frame-to-frame — letting us skip the expensive
 * markdown-block scanning and node moving until the content really changes.
 * Folded nodes remain descendants of the assistant element (they live inside
 * the process group, which is itself inside the assistant), so the counts are
 * unaffected by grouping and the fingerprint is stable before/after a pass.
 */
function processTurnFingerprint(assistants: AssistantMessageElement[]): string {
  const assistantIndexes = new Map(assistants.map((assistant, index) => [assistant, index]))
  const parts = collectProcessTimeline(assistants).map(({ node, sourceAssistant }) => {
    const assistantIndex = assistantIndexes.get(sourceAssistant) ?? 0
    const tagName = node.tagName.toLowerCase()
    if (tagName !== 'tool-message') return `${assistantIndex}:${tagName}`
    const toolMessage = node as ToolMessageElement
    return `${assistantIndex}:${tagName}:${toolMessage.toolCall?.id ?? toolNameFromMessage(toolMessage)}`
  })
  return `${assistants.length}|${parts.join('|')}`
}

export function processTurnUpdateMode(
  isAgentStreaming: boolean,
  canShortCircuit: boolean,
  hasExistingGroup: boolean,
  fingerprintMatches: boolean,
  nodeSequenceCurrent = true,
) {
  if (!hasExistingGroup || !fingerprintMatches || !nodeSequenceCurrent) return 'full' as const
  if (isAgentStreaming) return 'update' as const
  if (canShortCircuit) return 'skip' as const
  return 'full' as const
}

export function shouldPreserveProcessGroupDuringHandoff(hasProcessContent: boolean, hasExistingGroup: boolean, handoffPending: boolean) {
  return !hasProcessContent && hasExistingGroup && handoffPending
}

function decorateProcessTurn(panel: HTMLElement, assistants: AssistantMessageElement[], isAgentStreaming: boolean, turnIndex: number, canShortCircuit: boolean) {
  if (assistants.length === 0) return

  const processKey = processTurnStateKey(panel, assistants, turnIndex)
  const finalSummaryTarget = assistants[assistants.length - 1]
  const existingGroups = assistants.flatMap(processGroupsOwnedByAssistant)
  const existingGroup = existingGroups.length === 1 ? existingGroups[0] : undefined
  const fingerprint = processTurnFingerprint(assistants)
  const canFoldMarkdown = hasTurnProcessSignals(assistants)
  const finalSummaryMarkdown = canFoldMarkdown
    ? findFinalSummaryMarkdown(finalSummaryTarget, isAgentStreaming)
    : null
  const currentNodes = collectFoldableProcessNodes(assistants, finalSummaryMarkdown, canFoldMarkdown)
  const nodeSequenceCurrent = !existingGroup
    || processNodeSequenceIsCurrent(groupedProcessNodeSequences.get(existingGroup), currentNodes)
  const updateMode = processTurnUpdateMode(
    isAgentStreaming,
    canShortCircuit,
    Boolean(existingGroup),
    existingGroup?.dataset.quickforgeProcessFp === fingerprint,
    nodeSequenceCurrent,
  )
  if (updateMode === 'skip') return
  if (updateMode === 'update' && existingGroup) {
    updateProcessGroup(panel, processKey, assistants, existingGroup, true)
    return
  }

  if (currentNodes.length === 0 && shouldPreserveProcessGroupDuringHandoff(
    false,
    existingGroups.length > 0,
    panel.dataset.quickforgeProcessHandoff !== undefined,
  )) {
    return
  }

  restoreProcessTurn(assistants, true)
  const restoredCanFoldMarkdown = hasTurnProcessSignals(assistants)
  const restoredFinalSummary = restoredCanFoldMarkdown
    ? findFinalSummaryMarkdown(finalSummaryTarget, isAgentStreaming)
    : null
  if (restoredCanFoldMarkdown) markFinalSummaryMarkdown(finalSummaryTarget, restoredFinalSummary)
  const nodes = collectFoldableProcessNodes(assistants, restoredFinalSummary, restoredCanFoldMarkdown)
  if (nodes.length === 0) return

  const group = createTurnProcessGroup(nodes, assistants)
  if (!group) return
  group.dataset.quickforgeProcessFp = fingerprint
  updateProcessGroup(panel, processKey, assistants, group, isAgentStreaming)
  updateEmptyProcessSources(assistants)
}

export function decorateProcessBlocks(
  panel: HTMLElement,
  orderedMessages: HTMLElement[],
  isAgentStreaming: boolean,
) {
  const lastMessage = orderedMessages[orderedMessages.length - 1]
  const isLastMessageAssistant = lastMessage?.tagName.toLowerCase() === 'assistant-message'

  const turns: AssistantMessageElement[][] = []
  let currentAssistants: AssistantMessageElement[] = []
  for (const message of orderedMessages) {
    if (message.tagName.toLowerCase() === 'user-message') {
      if (currentAssistants.length > 0) turns.push(currentAssistants)
      currentAssistants = []
      continue
    }
    currentAssistants.push(message as AssistantMessageElement)
  }
  if (currentAssistants.length > 0) turns.push(currentAssistants)

  turns.forEach((assistants, index) => {
    const isActiveTurn = isAgentStreaming && isLastMessageAssistant && index === turns.length - 1
    decorateProcessTurn(panel, assistants, isActiveTurn, index, isAgentStreaming && !isActiveTurn)
  })
}
