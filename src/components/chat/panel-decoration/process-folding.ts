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

type ProcessStageSection<T> = {
  kind: 'detail' | 'stage'
  items: T[]
}

type GroupedProcessNode = {
  node: HTMLElement
  sourceAssistant: AssistantMessageElement
  sourceParent: HTMLElement | null
  sourceNextSibling: ChildNode | null
}

type ProcessToolSummary = {
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
const PROCESS_TOOLS_BODY_CLASS = 'quickforge-process-tools-body'
const PROCESS_TOOLS_BODY_SELECTOR = `.${PROCESS_TOOLS_BODY_CLASS}`
const PROCESS_BODY_INNER_CLASS = 'quickforge-process-body-inner'
const PROCESS_STAGE_SELECTOR = '.quickforge-process-stage'
const PROCESS_STAGE_BODY_SELECTOR = '.quickforge-process-stage-body'
const PROCESS_NODE_SELECTOR = 'thinking-block, tool-message, .qf-thinking-block, .qf-tool-message'
const PROCESS_DETAIL_NODE_SELECTOR = 'thinking-block, tool-message, markdown-block, .qf-thinking-block, .qf-tool-message, .qf-markdown-block'
const MESSAGE_LIST_SCOPE_SELECTOR = 'message-list, .qf-message-list'

/** Dual kind check: legacy elements (tag names) and the React chat surface (qf-* classes). */
function isProcessNodeKind(node: Node, kind: 'tool-message' | 'thinking-block' | 'markdown-block' | 'assistant-message' | 'user-message'): boolean {
  // 结构检查而非 instanceof HTMLElement：node 测试环境无 HTMLElement 全局，
  // 且 fake 节点也非其实例；文本/注释节点没有 tagName，天然被排除。
  const element = node as Partial<HTMLElement> | null
  if (!element || typeof element.tagName !== 'string') return false
  if (element.tagName.toLowerCase() === kind) return true
  return element.classList?.contains(`qf-${kind}`) ?? false
}

/** Stable structural kind for fingerprints (React surface renders qf-* divs). */
function processNodeKind(node: HTMLElement): string {
  if (isProcessNodeKind(node, 'tool-message')) return 'tool-message'
  if (isProcessNodeKind(node, 'thinking-block')) return 'thinking-block'
  if (isProcessNodeKind(node, 'markdown-block')) return 'markdown-block'
  return node.tagName.toLowerCase()
}
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

type ProcessGroupAnchorSource = {
  connected: boolean
}

export function processGroupAnchorIndex(sources: ProcessGroupAnchorSource[]) {
  return sources.findIndex((source) => source.connected)
}

type ProcessGroupTargetSource = {
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
  return isProcessNodeKind(node, 'tool-message')
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

type ProcessStageSummary = {
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
    (node): node is ToolMessageElement => isProcessNodeKind(node, 'tool-message'),
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
  return assistant.closest(MESSAGE_LIST_SCOPE_SELECTOR)
}

function processDetailIsInAssistantScope(node: HTMLElement, assistant: AssistantMessageElement) {
  return node.closest(MESSAGE_LIST_SCOPE_SELECTOR) === assistantMessageList(assistant) && isTopLevelProcessDetail(node)
}

function processGroupsOwnedByAssistant(assistant: AssistantMessageElement) {
  return Array.from(assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR))
    .filter((group) => group.closest('assistant-message, .qf-assistant-message') === assistant)
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

type ProcessThinkingChild = {
  quickforgeIcon?: boolean
  markedChevron?: boolean
  markedLabel?: boolean
  /** 子节点自身就是 chevron 的 <svg>：React `ThinkingBlock` 的 header 子级是 [svg, span]。 */
  selfSvg?: boolean
  /** 子节点内部含 chevron 的 <svg>：旧 thinking-block 自定义元素把 svg 包在 span 里。 */
  hasSvg?: boolean
  rotated?: boolean
}

export function processThinkingChildIndexes(children: ProcessThinkingChild[]) {
  const candidates = children
    .map((child, index) => ({ child, index }))
    .filter(({ child }) => !child.quickforgeIcon)
  const chevron = candidates.find(({ child }) => child.markedChevron)
    ?? candidates.find(({ child }) => child.selfSvg || child.hasSvg)
  const label = candidates.find(({ child, index }) => child.markedLabel && index !== chevron?.index)
    ?? candidates.find(({ index }) => index !== chevron?.index)
  return {
    chevronIndex: chevron?.index,
    labelIndex: label?.index,
    chevronExpanded: chevron?.child.rotated === true,
  }
}

/**
 * 思考头接管契约（勿破坏）：过程组内被搬移的 React `ThinkingBlock` 原生头必须在这里
 * 补上 `quickforge-process-thinking-header` 并重排为 [icon, label, chevron]，可见性规则
 * 才认得它。导出供 `tests/frontend/thinking-header-adoption.test.ts` 用真实 React DOM
 * 形态（header.children = [svg, span]）跑接管路径。
 */
export function decorateProcessThinkingBlocks(group: ProcessGroupElement) {
  group.querySelectorAll<HTMLElement>('thinking-block, .qf-thinking-block').forEach((thinkingBlock) => {
    if (thinkingBlock.closest(PROCESS_GROUP_SELECTOR) !== group) return
    const header = thinkingBlock.querySelector<HTMLElement>(':scope > .thinking-block > .thinking-header, :scope.qf-thinking-block > .thinking-header')
    if (!header) return

    // header.children 只含元素子级，这里不能用 `instanceof HTMLElement` 过滤：React
    // `ThinkingBlock` 的 chevron 就是 <svg> 本体，而 SVGElement 不是 HTMLElement，
    // 被过滤掉后 `querySelector('svg')` 也匹配不到自身，chevron 永远识别不到，
    // 接管提前 return —— header 拿不到 quickforge-process-thinking-header（历史上叠加
    // 面板级 display:none 就把整块思考永久隐藏）。
    const children = Array.from(header.children) as Array<HTMLElement | SVGElement>
    const { chevronIndex, labelIndex, chevronExpanded } = processThinkingChildIndexes(children.map((child) => ({
      quickforgeIcon: child.dataset.quickforgeThinkingRole === 'icon' || child.classList.contains('quickforge-process-thinking-icon'),
      markedChevron: child.dataset.quickforgeThinkingRole === 'chevron',
      markedLabel: child.dataset.quickforgeThinkingRole === 'label',
      selfSvg: child.tagName.toLowerCase() === 'svg',
      hasSvg: Boolean(child.querySelector('svg')),
      rotated: child.classList.contains('rotate-90') || child.classList.contains('quickforge-process-thinking-chevron-expanded'),
    })))
    const chevron = chevronIndex === undefined ? undefined : children[chevronIndex]
    const label = labelIndex === undefined ? undefined : children[labelIndex]
    if (!chevron || !label) return

    let icon = children.find((child) => (
      child.dataset.quickforgeThinkingRole === 'icon'
      || child.classList.contains('quickforge-process-thinking-icon')
    ))

    /*
     * 幂等短路（接管契约见上，勿破坏）：流式期间本函数每帧重跑，下方写路径会
     * 每帧重写 label.textContent（销毁重建文本节点）并 prepend/append 重排 header
     * 子级，与点击事件派发竞态（点击“思考过程”文字无法展开；同问题的先例见
     * shouldToggleProcessSummary 的 pointerdown 优先策略）。header 已接管、三个
     * 槽位类名就位、文案一致且子级顺序已是 [icon, label, chevron] 时，跳过全部
     * DOM 写操作。React 重渲染会整体重写 chevron/label 的 class 属性，届时下列
     * 条件自然失效，回落到完整接管路径恢复装饰状态。
     */
    if (
      icon
      && header.classList.contains('quickforge-process-thinking-header')
      && icon.classList.contains('quickforge-process-thinking-icon')
      && label.classList.contains('quickforge-process-thinking-label')
      && chevron.classList.contains('quickforge-process-thinking-chevron')
      && label.textContent === t('processThinking')
      && header.children.length === 3
      && header.children[0] === icon
      && header.children[1] === label
      && header.children[2] === chevron
    ) return

    chevron.dataset.quickforgeThinkingRole = 'chevron'
    label.dataset.quickforgeThinkingRole = 'label'
    // SVGElement.className 是只读的 SVGAnimatedString（严格模式下赋值直接抛错），
    // 接管必须写 class 属性：两种形态（span 包裹 / svg 本体）都适用。
    chevron.setAttribute('class', 'quickforge-process-thinking-chevron')
    chevron.classList.toggle('quickforge-process-thinking-chevron-expanded', chevronExpanded)
    label.setAttribute('class', 'quickforge-process-thinking-label')
    label.textContent = t('processThinking')

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

/**
 * 折叠组 body 的动画壳层：grid-template-rows 0fr↔1fr 高度过渡要求全部行内容
 * 挂在一个 min-height:0 的 inner 下（body 的 grid 行 track 才能塌到 0），所以
 * 三个 body 的直接子级只有 inner，工具行 / step / stage 全部 append 进 inner。
 * 幂等：body 已有 inner 时直接返回，不重复创建。
 */
function ensureProcessBodyInner(body: HTMLElement) {
  for (const child of Array.from(body.children)) {
    if (child.classList.contains(PROCESS_BODY_INNER_CLASS)) return child as HTMLElement
  }
  const inner = document.createElement('div')
  inner.className = PROCESS_BODY_INNER_CLASS
  body.append(inner)
  return inner
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
  ensureProcessBodyInner(toolsBody)
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
  ensureProcessBodyInner(body)
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
  ensureProcessBodyInner(body)

  group.append(summary, body)
  return group
}

/** 顶层过程组默认展开值：只有正在流式的回合默认展开（旧语义），历史回合默认收起；用户手动展开/收起后由 saved state 优先（resolveProcessExpandedState）。 */
export function processGroupDefaultExpanded(isAgentStreaming: boolean) {
  return isAgentStreaming
}

/** 内层阶段默认收起（旧语义）；只有显式 saved state 为展开时才展开。 */
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
      stageBody.querySelectorAll<ToolMessageElement>('tool-message, .qf-tool-message'),
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

/** 工具组（连续工具行）默认展开值：只有 `detailed` 显示模式默认展开（旧语义），默认设置 `compact` 收起。 */
export function processToolGroupDefaultExpanded(toolDisplayMode: string) {
  return toolDisplayMode === 'detailed'
}

function toolGroupStateKey(processKey: string, tools: HTMLElement, index: number) {
  const toolMessages = Array.from(tools.querySelectorAll<ToolMessageElement>('tool-message, .qf-tool-message'))
  return processToolGroupStateKey(processKey, toolMessages[0]?.toolCall?.id, index)
}

function updateProcessToolsGroups(panel: HTMLElement, processKey: string, group: ProcessGroupElement) {
  group.querySelectorAll<HTMLElement>(PROCESS_TOOLS_SELECTOR).forEach((tools, index) => {
    if (tools.closest(PROCESS_GROUP_SELECTOR) !== group) return
    const toolsBody = tools.querySelector<HTMLElement>(`:scope > ${PROCESS_TOOLS_BODY_SELECTOR}`)
    const toolsSummary = tools.querySelector<HTMLButtonElement>('.quickforge-process-tools-summary')
    const toolsLabel = tools.querySelector<HTMLElement>('.quickforge-process-tools-label')
    if (!toolsBody || !toolsSummary || !toolsLabel) return

    // 工具行在 tools-body 的动画壳层 inner 里，body 的直接子级只有 inner，
    // 因此后代查询与原 `:scope >` 直接子级查询等价（inner 内不会嵌套工具组）。
    const summary = summarizeProcessTools(toolsBody.querySelectorAll<ToolMessageElement>('tool-message, .qf-tool-message'))
    tools.hidden = summary.count === 0
    if (summary.count === 0) return

    const toolsKey = toolGroupStateKey(processKey, tools, index)
    const toolsBodyId = `quickforge-${toolsKey.replace(/[^a-z0-9_-]+/gi, '-')}`
    toolsBody.id = toolsBodyId
    toolsSummary.setAttribute('aria-controls', toolsBodyId)
    const detailed = processToolGroupDefaultExpanded(getCachedToolDisplaySettings().toolDisplayMode)
    const displayMode = detailed ? 'detailed' : 'compact'
    const previousToolsKey = tools.dataset.quickforgeProcessKey
    const previousDisplayMode = tools.dataset.quickforgeToolDisplayMode
    tools.dataset.quickforgeProcessKey = toolsKey
    tools.dataset.quickforgeToolDisplayMode = displayMode
    const expanded = resolveProcessExpandedState(
      getProcessExpandedStates(panel).get(toolsKey),
      previousToolsKey === toolsKey && previousDisplayMode === displayMode,
      tools.dataset.expanded === 'true',
      // 工具组默认展开值由显示模式决定（旧语义）：detailed 默认展开，compact 默认收起。
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
  syncProcessGroupExpandedState(panel, group, processKey, processGroupDefaultExpanded(isAgentStreaming))
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
  const processScope = node.closest(MESSAGE_LIST_SCOPE_SELECTOR)
  const parentProcessDetail = node.parentElement?.closest(PROCESS_DETAIL_NODE_SELECTOR)
  return !parentProcessDetail || parentProcessDetail.closest(MESSAGE_LIST_SCOPE_SELECTOR) !== processScope
}

function markdownCandidates(target: AssistantMessageElement) {
  const processScope = assistantMessageList(target)
  return Array.from(target.querySelectorAll<HTMLElement>('markdown-block, .qf-markdown-block'))
    .filter((node) => {
      if (node.closest(MESSAGE_LIST_SCOPE_SELECTOR) !== processScope) return false
      const parentProcessNode = node.parentElement?.closest(PROCESS_NODE_SELECTOR)
      return !parentProcessNode || parentProcessNode.closest(MESSAGE_LIST_SCOPE_SELECTOR) !== processScope
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
      .some((node) => node.closest(MESSAGE_LIST_SCOPE_SELECTOR) === assistantMessageList(assistant))
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
    (item) => isProcessNodeKind(item.node, 'markdown-block'),
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
        sourceAssistant: group.closest<AssistantMessageElement>('assistant-message, .qf-assistant-message') ?? group.parentElement as AssistantMessageElement,
        sourceParent: group.parentElement,
        sourceNextSibling: group,
      }))
}

/**
 * Nodes of a group in the order they must be re-inserted.
 *
 * Tracked nodes were moved out of their container in document order and each
 * keeps its own `sourceNextSibling`, which may still live inside the group — so
 * they have to go back in reverse order (inserting the first one would point at
 * a node the container does not own yet). Untracked fallback items all point at
 * the group element itself, so document order is the only order that does not
 * reverse them.
 */
function groupedProcessRestoreOrder(group: ProcessGroupElement): GroupedProcessNode[] {
  const tracked = groupedProcessNodeSequences.get(group)
  return tracked ? [...tracked].reverse() : groupedProcessNodes(group)
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
  const nodeKind = processNodeKind(item.node)
  const toolCallId = nodeKind === 'tool-message'
    ? (item.node as ToolMessageElement).toolCall?.id
    : undefined
  return Array.from(item.sourceAssistant.querySelectorAll<HTMLElement>(PROCESS_NODE_SELECTOR))
    .filter((node) => node !== item.node && !node.closest(PROCESS_GROUP_SELECTOR))
    .filter((node) => processDetailIsInAssistantScope(node, item.sourceAssistant))
    .some((node) => {
      if (processNodeKind(node) !== nodeKind) return false
      if (nodeKind !== 'tool-message' || !toolCallId) return true
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
      groupedProcessRestoreOrder(group).forEach((item) => {
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

export type ProcessGroupReleaseStats = {
  /** Groups dissolved by this pass. */
  groups: number
  /** Moved nodes handed back to the position React rendered them in. */
  restored: number
  /** Moved nodes dropped because React already replaced or unmounted them. */
  dropped: number
}

/**
 * Ownership hand-back for React-rendered message nodes.
 *
 * Folding re-parents nodes React owns (`thinking-block` / `tool-message` /
 * `markdown-block` and their `qf-*` replacements) into decoration-owned process
 * groups. React keeps modelling those nodes as direct children of the container
 * it rendered, so as soon as a group holds them React's insert / reorder /
 * remove on that container would target nodes that are no longer its direct
 * children (a `NotFoundError` on `removeChild` / `insertBefore`).
 *
 * The contract is therefore: React hands the nodes back *before* it mutates the
 * subtree, and the decoration layer re-folds the committed DOM afterwards.
 * Boundaries that guarantee the "before" half:
 * - `ProcessGroupReleaseBoundary` in the chat surface (every commit that
 *   changed the message rows' structural render identities — the
 *   `messageRenderKeys` sequence — and every streaming-terminal flip,
 *   `isStreaming` swapped or the streaming partial cleared; pure streaming
 *   frames and structure-preserving array swaps, e.g. a re-upserted
 *   toolResult row, skip).
 * - `SubagentTrace` in the run-detail inspector (snapshot before update +
 *   unmount).
 *
 * Invariants kept by this function:
 * - Idempotent: a second call finds no process group and does nothing.
 * - Never resurrects stale nodes: nodes React detached, or re-created outside
 *   the group, are dropped from the bookkeeping and left untouched, so a
 *   release can never move or remove a node React currently owns.
 */
export function releaseProcessGroups(root: HTMLElement, streamingOnly = false): ProcessGroupReleaseStats {
  const stats: ProcessGroupReleaseStats = { groups: 0, restored: 0, dropped: 0 }
  const selector = streamingOnly ? `${PROCESS_GROUP_SELECTOR}[data-streaming="true"]` : PROCESS_GROUP_SELECTOR
  root.querySelectorAll<ProcessGroupElement>(selector).forEach((group) => {
    stats.groups += 1
    const groupedNodes = groupedProcessNodes(group)
    const sourceAssistants = new Set(groupedNodes.map((item) => item.sourceAssistant))
    const owner = group.closest<AssistantMessageElement>('assistant-message, .qf-assistant-message')
    if (owner) sourceAssistants.add(owner)
    sourceAssistants.forEach((assistant) => assistant.classList.remove('quickforge-process-source-empty'))
    groupedProcessRestoreOrder(group).forEach((item) => {
      if (releaseGroupedProcessNode(item, group)) stats.restored += 1
      else stats.dropped += 1
    })
    groupedProcessNodeSequences.delete(group)
    group.remove()
  })
  return stats
}

/**
 * True when the release must hand a moved node back to React.
 *
 * `false` means "leave the node exactly where it is": React already detached it
 * (React unmounted/replaced it) or already rendered it back into the container
 * itself. Restoring in either case would resurrect a dead node or move a node
 * React owns to a stale position.
 */
export function shouldRestoreGroupedProcessNode(nodeConnected: boolean, nodeInsideGroup: boolean) {
  return nodeConnected && nodeInsideGroup
}

/**
 * Hand a single moved node back to React.
 *
 * Returns `false` when the node was dropped instead of restored.
 */
function releaseGroupedProcessNode(item: GroupedProcessNode, group: ProcessGroupElement) {
  const connected = item.node.isConnected === true
  if (!shouldRestoreGroupedProcessNode(connected, connected && group.contains(item.node))) {
    // Only drop the folding flag so CSS cannot keep hiding a node the group no
    // longer owns; the node itself is never moved or removed here.
    if (connected) setProcessFlag(item.node, PROCESS_FOLDED_ATTR, false)
    return false
  }
  restoreGroupedProcessNode(item, group)
  return true
}

export function releaseStreamingProcessGroups(panel: HTMLElement) {
  return releaseProcessGroups(panel, true)
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
      const toolsInner = ensureProcessBodyInner(toolsBody)
      segment.items.forEach(({ node }) => {
        setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
        toolsInner.append(node)
      })
      step.append(tools)
      continue
    }

    segment.items.forEach(({ node }) => {
      setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
      step.append(node)
    })
  }
  ensureProcessBodyInner(container).append(step)
}

function populateProcessGroup(group: ProcessGroupElement, items: GroupedProcessNode[]) {
  const body = group.querySelector<HTMLElement>(`:scope > ${PROCESS_BODY_SELECTOR}`)
  if (!body) return false

  const sections = splitProcessStageSections(
    items,
    (item) => isProcessNodeKind(item.node, 'markdown-block'),
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
    ensureProcessBodyInner(body).append(stage)
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

/**
 * 组仍存活时的增量收尾：时间线只在末尾多出连续可分组工具行时，不整组释放重建，
 * 而是把新行逐个搬进既有工具组，已有行节点保持原 DOM 位置不动。
 *
 * 全量重建（restoreProcessTurn + createTurnProcessGroup）会把每个已有行节点再搬
 * 一次；DOM 节点被搬动会重启节点上仍在运行的 CSS keyframes（如 pending 工具行的
 * animate-spin），这正是结构变化帧的闪烁来源。流式增长恰好都是「后缀追加」——
 * 上一序列是当前序列的连通前缀、且新增项全部是可分组工具——此时组的 DOM 结构
 * 与全量重建的结果完全一致，只是新行晚到。
 *
 * 返回 false（调用方走全量重建兜底）的其它情形：无前次序列、前缀不匹配（重排 /
 * 替换 / 中插）、前缀节点已不归本组持有或已被 React 在组外重建出同 id 替身
 * （重建路径的 discard 逻辑会丢弃旧节点，增量追加则会双行）、以及尾部不是本组
 * 最后一个工具组的最后一行（期望结构超出纯后缀追加能表达的范围）。
 */
function appendProcessToolSuffix(group: ProcessGroupElement, currentNodes: GroupedProcessNode[]) {
  const previous = groupedProcessNodeSequences.get(group)
  const appendStart = previous ? processToolSuffixAppendStart(previous, currentNodes) : undefined
  if (!previous || appendStart === undefined) return false

  const nodesStillOwned = previous.every((item) => (
    group.contains(item.node) && !groupedProcessNodeHasCurrentReplacement(item)
  ))
  if (!nodesStillOwned) return false

  const tail = previous[previous.length - 1].node
  // 工具行挂在 tools-body 的动画壳层 inner 里（见 ensureProcessBodyInner）：
  // 校验链 tail → inner → tools-body → group 与「inner 的最后一个子节点是 tail」
  // 一起，保证增量只 append 新行、已有行不被搬动（防闪烁关键路径）。
  const toolsInner = tail.parentElement
  const toolsBody = toolsInner?.parentElement
  if (
    !toolsInner
    || !toolsInner.classList.contains(PROCESS_BODY_INNER_CLASS)
    || !toolsBody
    || !toolsBody.classList.contains(PROCESS_TOOLS_BODY_CLASS)
    || toolsBody.closest(PROCESS_GROUP_SELECTOR) !== group
    || toolsInner.children[toolsInner.children.length - 1] !== tail
  ) return false

  currentNodes.slice(appendStart).forEach(({ node }) => {
    setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
    toolsInner.append(node)
  })
  groupedProcessNodeSequences.set(group, currentNodes)
  return true
}

export function assistantProcessSourceHasVisibleError(
  message: (MessageWithUsage & { stopReason?: string; errorMessage?: string }) | undefined,
) {
  const stopReason = message?.stopReason
  return (stopReason === 'error' || stopReason === 'aborted')
    && typeof message?.errorMessage === 'string'
    && message.errorMessage.trim().length > 0
}

function updateEmptyProcessSources(assistants: AssistantMessageElement[]) {
  for (const assistant of assistants) {
    const hasVisibleContent = assistantProcessSourceHasVisibleError(assistant.message) || Boolean(
      Array.from(assistant.querySelectorAll<HTMLElement>('.qf-markdown-block, .qf-thinking-block, .qf-tool-message, markdown-block, thinking-block, tool-message, .quickforge-process-group, .quickforge-approval-card'))
        .some((node) => node.closest(MESSAGE_LIST_SCOPE_SELECTOR) === assistantMessageList(assistant)),
    )
    assistant.classList.toggle('quickforge-process-source-empty', !hasVisibleContent)
  }
}

/**
 * Structural fingerprint of a turn's foldable content.
 *
 * Used to short-circuit re-decoration of already-grouped turns that are not
 * the live one — during streaming every preceding turn, and in static passes
 * (navigation jumps, metadata refreshes) every completed turn. Content
 * changes only reach the DOM through a structural commit that releases the
 * groups first (see ProcessGroupReleaseBoundary), so a surviving group whose
 * fingerprint still matches is guaranteed to be unchanged since its last pass
 * and skipping is behavior-preserving.
 * Folded nodes remain descendants of the assistant element (they live inside
 * the process group, which is itself inside the assistant), so the counts are
 * unaffected by grouping and the fingerprint is stable before/after a pass.
 */
function processTurnFingerprint(assistants: AssistantMessageElement[]): string {
  const assistantIndexes = new Map(assistants.map((assistant, index) => [assistant, index]))
  const parts = collectProcessTimeline(assistants).map(({ node, sourceAssistant }) => {
    const assistantIndex = assistantIndexes.get(sourceAssistant) ?? 0
    const nodeKind = processNodeKind(node)
    if (nodeKind !== 'tool-message') return `${assistantIndex}:${nodeKind}`
    const toolMessage = node as ToolMessageElement
    return `${assistantIndex}:${nodeKind}:${toolMessage.toolCall?.id ?? toolNameFromMessage(toolMessage)}`
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

  // 结构变化但组仍存活时优先增量收尾：只搬新增行，已有行原地不动（避免重启其
  // 正在运行的 CSS keyframes）。非纯后缀追加的结构变化由下方全量重建兜底。
  if (existingGroup && appendProcessToolSuffix(existingGroup, currentNodes)) {
    existingGroup.dataset.quickforgeProcessFp = fingerprint
    updateProcessGroup(panel, processKey, assistants, existingGroup, isAgentStreaming)
    updateEmptyProcessSources(assistants)
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
  const isLastMessageAssistant = isProcessNodeKind(lastMessage, 'assistant-message')

  const turns: AssistantMessageElement[][] = []
  let currentAssistants: AssistantMessageElement[] = []
  for (const message of orderedMessages) {
    if (isProcessNodeKind(message, 'user-message')) {
      if (currentAssistants.length > 0) turns.push(currentAssistants)
      currentAssistants = []
      continue
    }
    currentAssistants.push(message as AssistantMessageElement)
  }
  if (currentAssistants.length > 0) turns.push(currentAssistants)

  turns.forEach((assistants, index) => {
    const isActiveTurn = isAgentStreaming && isLastMessageAssistant && index === turns.length - 1
    // Only the live turn must keep reconciling; every other turn — streaming
    // historical or fully static — skips when its fingerprint still matches.
    decorateProcessTurn(panel, assistants, isActiveTurn, index, !isActiveTurn)
  })
}
