import type { MessageWithUsage } from '../chat-utils'
import { t } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { emitReadingIntent } from '../scroll-sync'

type ProcessGroupElement = HTMLDivElement

type ToolMessageElement = HTMLElement & {
  result?: unknown
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> }
  tool?: { name?: string }
  pending?: boolean
  aborted?: boolean
  isStreaming?: boolean
}

type ProcessStageSection<T> = {
  kind: 'detail' | 'stage'
  items: T[]
}

type GroupedProcessNode = {
  node: HTMLElement
  sourceAssistant: AssistantMessageElement
  sourceParent: HTMLElement | null
  /** 折走瞬间的下一个兄弟。还原时若它前面又插入了节点，改用那个更新的兄弟。 */
  sourceNextSibling: ChildNode | null
}

type AssistantMessageElement = HTMLElement & {
  message?: MessageWithUsage & { stopReason?: string; errorMessage?: string }
  isStreaming?: boolean
}

const PROCESS_GROUP_SELECTOR = '.quickforge-process-group'
const PROCESS_BODY_SELECTOR = '.quickforge-process-body'
const PROCESS_STEP_CLASS = 'quickforge-process-step'
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
/**
 * Folding moves process nodes under the group's anchor assistant.  Keep the
 * rendered source separately so code which runs after the move never treats
 * that host as the node's owner.
 */
const processNodeOwners = new WeakMap<HTMLElement, AssistantMessageElement>()
const processThinkingSources = new WeakMap<HTMLElement, { assistant: AssistantMessageElement; index: number }>()
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

export function isProcessToolsGroupMember(toolName: string, result?: unknown) {
  const details = isRecord(result) && isRecord(result.details) ? result.details : undefined
  if (toolName === 'run_subagent' || toolName === 'generate_image') return false
  if (toolName === 'run_command' && details?.background === true) return false
  return true
}

function isGroupableProcessTool(node: HTMLElement) {
  const toolMessage = node as ToolMessageElement
  return isProcessNodeKind(node, 'tool-message')
    && isProcessToolsGroupMember(toolNameFromMessage(toolMessage), toolMessage.result)
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

type ProcessStageSummary = {
  toolCallCount: number
  commandCount: number
  editedFileCount: number
  errorCount: number
}

export function summarizeProcessStageTools(toolMessages: ArrayLike<ToolMessageElement>): ProcessStageSummary {
  const messages = Array.from(toolMessages)
  const editedPaths = messages.map(toolMessageEditedFilePath)
  const editedFilePaths = new Set(editedPaths.filter((path): path is string => Boolean(path)))
  return {
    toolCallCount: messages.length,
    commandCount: messages.filter((message) => toolNameFromMessage(message) === 'run_command').length,
    editedFileCount: editedFilePaths.size,
    errorCount: messages.filter(toolMessageIsError).length,
  }
}

export function processStageLabel(summary: ProcessStageSummary, isStreaming: boolean) {
  const details: string[] = []
  if (summary.toolCallCount > 0) details.push(t('processGroupToolsCalled', { count: summary.toolCallCount }))
  if (summary.commandCount > 0) details.push(t('processGroupCommandsRan', { count: summary.commandCount }))
  if (summary.editedFileCount > 0) details.push(t('processGroupFilesEdited', { count: summary.editedFileCount }))
  if (summary.errorCount > 0) details.push(t('processToolsFailedCount', { count: summary.errorCount }))
  const status = isStreaming ? t('processExecuting') : t('processExecuted')
  return details.length > 0 ? `${status}  ${details.join(' · ')}` : status
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
  step.className = PROCESS_STEP_CLASS
  return step
}

function thinkingIconMarkup() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></svg>'
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

/** 尾行提示的展示行长度上限：跑马灯按它测量滚动距离，超长行截断（按码点，不劈代理对）。 */
const PROCESS_THINKING_HINT_MAX_CHARS = 500
/** 同一行内文本增长的写入节流窗口：窗口内零 DOM 写；行切换 / 可见性变化立即写不受节流。 */
const PROCESS_THINKING_HINT_THROTTLE_MS = 300
const PROCESS_THINKING_HINT_CLASS = 'quickforge-process-thinking-hint'
const PROCESS_THINKING_HINT_VISIBLE_CLASS = 'quickforge-process-thinking-hint-visible'
const PROCESS_THINKING_HINT_IN_CLASS = 'quickforge-process-thinking-hint-in'
/**
 * 尾行提示的「本次变异意图」标记（marquee 元素的 `roll` attribute，先于 `text` 写入、
 * 由随后的一次 text 同步消费）：行切换 = 整行滚入，同一行内增长 = 就地更新文本。
 * 后者必须不整行滚入——否则旧文上滚出与新文下滚入两个视图同时可见，而同一行的
 * 新旧文本只差几个字，观感就是同一句话上下重复显示两次。
 */
const PROCESS_THINKING_HINT_ROLL_ATTRIBUTE = 'roll'

/** 尾行提示的逐元素同步状态：当前展示行的身份（段行号）与上次实际写入的时间戳。 */
type ProcessThinkingHintState = {
  lineIndex: number
  lastWriteAt: number
}
const processThinkingHintStates = new WeakMap<HTMLElement, ProcessThinkingHintState>()

/** 最后一个非空段（含进行中未换行的行）与其行号（行身份）；无任何非空段返回 null。 */
function latestThinkingSegment(content: string): { lineIndex: number; text: string } | null {
  const lines = content.split('\n')
  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const line = lines[lineIndex]?.trim() ?? ''
    if (line) return { lineIndex, text: Array.from(line).slice(0, PROCESS_THINKING_HINT_MAX_CHARS).join('') }
  }
  return null
}

/**
 * 尾行提示取段规则：按换行切分取最后一个非空段——含进行中尚未换行的行（无换行/
 * 长首行思考从首个 token 起即可见）；无任何非空段返回 ''。超长按码点截 500 不劈
 * 代理对。行身份（段行号）由 latestThinkingSegment 一并返回，供同步层区分
 * 「行切换」（重触发淡入）与「同一行内增长」（只更新文本、按时间窗节流）。
 */
export function latestThinkingLine(content: string): string {
  return latestThinkingSegment(content)?.text ?? ''
}

/** message.content 里按渲染顺序保留的非空 thinking 块（与 React 表面一一对应）。 */
function assistantThinkingChunks(assistant: AssistantMessageElement | null): Array<Record<string, unknown>> {
  const content = assistant?.message?.content
  if (!Array.isArray(content)) return []
  const chunks: Array<Record<string, unknown>> = []
  for (const chunk of content) {
    if (!isRecord(chunk) || chunk.type !== 'thinking') continue
    if (typeof chunk.thinking === 'string' && chunk.thinking.trim() !== '') chunks.push(chunk)
  }
  return chunks
}

/**
 * 该思考块是否仍是「正在写」的那一段。
 *
 * 流式 partial 没有单独的 thinking 结束事件：模型一旦写完思考、开始正文或工具调用，
 * 这个 thinking 块就不再是 content 的最后一块（或整条消息已经不再流式）。右侧提示
 * 只跟这一段，思考过程一结束就淡出，不能等到整轮 message_end。
 * `thinkingSignature` 是块结束时才写入的签名，出现即视为该段已结束。
 */
function isThinkingChunkLive(assistant: AssistantMessageElement, chunk: Record<string, unknown> | undefined): boolean {
  if (!chunk || assistant.isStreaming !== true) return false
  if (typeof chunk.thinkingSignature === 'string' && chunk.thinkingSignature !== '') return false
  const content = assistant.message?.content
  if (!Array.isArray(content) || content.length === 0) return false
  return content[content.length - 1] === chunk
}

/**
 * 思考块 → 其对应 thinking 累积文本的最新非空段（行身份 + 文本）：React 表面按
 * message.content 顺序渲染非空 thinking 段（assistantContentParts），assistant 子树内
 * 的思考块（文档序）与之一一对应。仅该段仍在流式增长、且思考块收起时返回该段，
 * 否则 null（思考过程结束 / 整轮结束都立即淡出）。
 */
function processThinkingHintSegment(thinkingBlock: HTMLElement): { lineIndex: number; text: string } | null {
  const source = processThinkingSources.get(thinkingBlock)
  const assistant = source?.assistant
    ?? thinkingBlock.closest<AssistantMessageElement>('assistant-message, .qf-assistant-message')
  if (!assistant) return null
  const chunks = assistantThinkingChunks(assistant)
  const index = source?.index ?? Array.from(assistant.querySelectorAll<HTMLElement>('thinking-block, .qf-thinking-block'))
    .filter((node) => node.closest(MESSAGE_LIST_SCOPE_SELECTOR) === assistantMessageList(assistant))
    .indexOf(thinkingBlock)
  if (index < 0) return null
  const chunk = chunks[index]
  if (!isThinkingChunkLive(assistant, chunk)) return null
  const thinking = typeof chunk?.thinking === 'string' ? chunk.thinking : ''
  return latestThinkingSegment(thinking)
}

/**
 * 尾行提示（header 第四槽位，quickforge-tool-marquee 自定义元素）的逐帧幂等同步：
 * 该思考段仍在流式增长、且思考块收起时显示最新一段思考文字（含进行中未换行的行）；
 * 思考过程一结束（该块不再是 content 末块，或带上 thinkingSignature，或整轮结束）
 * 立即淡出，不等整条消息的 message_end。行身份（段行号）变化时更新 text 并重触发
 * 淡入，同一行内文本增长只更新 text、不重触发淡入，并按 ~300ms 时间窗节流——窗口内
 * 零 DOM 写（帧内容未变零写契约的节流版），行切换、思考结束、可见性变化立即写不受
 * 节流；只比较上次写入时间戳，无逐帧定时器（rAF decorate 自然驱动）。同一行内增长
 * 还会写 `roll="false"` 意图标记，让跑马灯就地更新文本、不做整行纵向滚入（两个视图
 * 同显同一句＝上下重复显示两次；行切换才滚入）。思考结束 / 展开时整体淡出（类切换
 * 驱动 CSS 过渡，保留占位）。
 * 溢出滚动由 marquee 元素自身接管（text/running attribute 传参，先例见
 * QuickForgeToolMarquee）。其余写入仍以值比较守卫：帧内容未变时（含 hint 未变）
 * 零 DOM 写（本节流与动效无关，reduced-motion 下行为不变）。
 */
function syncProcessThinkingHint(header: HTMLElement, thinkingBlock: HTMLElement, chevron: Element) {
  const hint = Array.from(header.children).find(
    (child) => (child as HTMLElement).dataset.quickforgeThinkingRole === 'hint',
  ) as HTMLElement | undefined
  if (!hint) return
  const expanded = chevron.classList.contains('quickforge-process-thinking-chevron-expanded')
    || chevron.classList.contains('rotate-90')
  const segment = expanded ? null : processThinkingHintSegment(thinkingBlock)
  const text = segment?.text ?? ''
  const lineIndex = segment?.lineIndex ?? -1
  const visible = text !== ''
  const wasVisible = hint.classList.contains(PROCESS_THINKING_HINT_VISIBLE_CLASS)
  const previousText = hint.getAttribute('text') ?? ''
  const previousState = processThinkingHintStates.get(hint)
  const previousLineIndex = previousState?.lineIndex ?? -1
  const lastWriteAt = previousState?.lastWriteAt ?? 0
  const now = Date.now()

  const runningChanged = hint.getAttribute('running') !== String(visible)
  const textChanged = previousText !== text
  const visibleChanged = visible !== wasVisible
  // 行切换判定用行身份（段行号）而非文本差异：同一行内增长不重触发淡入。
  const lineSwitched = visible && wasVisible && previousText !== '' && previousLineIndex !== lineIndex
  // 同一行内增长按时间窗节流：窗口内直接跳过（零 DOM 写），窗口过后放行一次 text 更新。
  if (visible && wasVisible && !lineSwitched && textChanged
    && now - lastWriteAt < PROCESS_THINKING_HINT_THROTTLE_MS) return

  if (runningChanged) hint.setAttribute('running', String(visible))
  if (textChanged) {
    // 意图标记必须每次随 text 一起写（元素消费后即复位）：值是 'true'/'false' 而不是
    // 「需要时才写」——残留/复用的标记会把行切换误判成就地更新（反之亦然）。
    hint.setAttribute(PROCESS_THINKING_HINT_ROLL_ATTRIBUTE, lineSwitched ? 'true' : 'false')
    hint.setAttribute('text', text)
  }
  if (visibleChanged) hint.classList.toggle(PROCESS_THINKING_HINT_VISIBLE_CLASS, visible)
  if (lineSwitched) {
    // 行切换：移除→读一次布局使样式失效→重加，重触发进入动画（keyframes 见 index.css）。
    hint.classList.remove(PROCESS_THINKING_HINT_IN_CLASS)
    void (hint as HTMLElement & { offsetWidth?: number }).offsetWidth
    hint.classList.add(PROCESS_THINKING_HINT_IN_CLASS)
  }
  if (runningChanged || textChanged || visibleChanged || lineSwitched) {
    processThinkingHintStates.set(hint, { lineIndex, lastWriteAt: now })
  }
}

/**
 * 思考头接管契约（勿破坏）：过程组内被搬移的 React `ThinkingBlock` 原生头必须在这里
 * 补上 `quickforge-process-thinking-header` 并重排为 [icon, label, chevron, hint]（第四
 * 槽位为流式尾行提示），可见性规则才认得它。导出供
 * `tests/frontend/thinking-header-adoption.test.ts` 用真实 React DOM
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
    let hint = children.find((child) => child.dataset.quickforgeThinkingRole === 'hint')

    /*
     * 最小写路径（接管契约见上，勿破坏）：流式期间本函数每帧重跑，而 React 会在
     * `isStreaming` 翻转（思考段结束/开始）等时机整体重写 chevron / label 的 class
     * 属性（思考 shimmer、rotate-90）——此时四个槽位与子级顺序其实都已经正确。
     * 旧实现对此无条件重写 `label.textContent`（销毁重建文本节点）并
     * `prepend` / `append` 重排 header 子级（移动节点＝重启其 CSS 动画，例如第四槽位
     * hint 的淡入与跑马灯滚入），于是「思考过程结束」那一帧整行抖一下；无条件重排也
     * 与点击事件派发竞态（点击“思考过程”文字无法展开；同问题的先例见
     * shouldToggleProcessSummary 的 pointerdown 优先策略）。
     * 因此下面每一项都按需写：属性 / 文案只在值不同时写，子级重排只在顺序真的不对时
     * 执行。已接管且 React 未插手的帧保持零 DOM 写（流式每帧重跑的幂等短路）。
     * 结尾统一跑 syncProcessThinkingHint：提示文本在流式期间随最新非空段变化（同一
     * 行内增长另有 ~300ms 节流窗口），其写入自身幂等（帧内容未变零 DOM 写）。
     */
    if (chevron.dataset.quickforgeThinkingRole !== 'chevron') chevron.dataset.quickforgeThinkingRole = 'chevron'
    if (label.dataset.quickforgeThinkingRole !== 'label') label.dataset.quickforgeThinkingRole = 'label'
    // SVGElement.className 是只读的 SVGAnimatedString（严格模式下赋值直接抛错），
    // 接管必须写 class 属性：两种形态（span 包裹 / svg 本体）都适用。React 重写的
    // rotate-90 由 chevronExpanded 折进 expanded 类（视觉等价，见 processThinkingChildIndexes）。
    const chevronClass = `quickforge-process-thinking-chevron${chevronExpanded ? ' quickforge-process-thinking-chevron-expanded' : ''}`
    if (chevron.getAttribute('class') !== chevronClass) chevron.setAttribute('class', chevronClass)
    if (label.getAttribute('class') !== 'quickforge-process-thinking-label') {
      label.setAttribute('class', 'quickforge-process-thinking-label')
    }
    const labelText = t('processThinking')
    if (label.textContent !== labelText) label.textContent = labelText

    if (!icon) {
      icon = document.createElement('span')
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML = thinkingIconMarkup()
    }
    if (icon.dataset.quickforgeThinkingRole !== 'icon') icon.dataset.quickforgeThinkingRole = 'icon'
    if (!icon.classList.contains('quickforge-process-thinking-icon')) {
      icon.classList.add('quickforge-process-thinking-icon')
    }

    if (!hint) {
      // 第四槽位（尾行提示）：quickforge-tool-marquee 自定义元素（shared.tsx 注册，
      // attribute 传参驱动），溢出滚动与行切换滚入由其内部 ToolMarqueeController 接管。
      hint = document.createElement('quickforge-tool-marquee')
      hint.dataset.quickforgeThinkingRole = 'hint'
      hint.setAttribute('aria-hidden', 'true')
      hint.setAttribute('class', PROCESS_THINKING_HINT_CLASS)
    }

    const ordered = header.children.length === 4
      && header.children[0] === icon
      && header.children[1] === label
      && header.children[2] === chevron
      && header.children[3] === hint
    if (!ordered) {
      header.prepend(icon)
      header.append(label, chevron, hint)
    }
    if (!header.classList.contains('quickforge-process-thinking-header')) {
      header.className = 'thinking-header quickforge-process-thinking-header'
    }
    syncProcessThinkingHint(header, thinkingBlock, chevron)
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

/** 内层阶段默认展开值：读 expandProcessStageByDefault 设置（默认 true=每条工具调用直接可见）；用户手动开合记忆（saved state）/增量 key 命中时仍优先（resolveProcessExpandedState）。 */
export function processStageDefaultExpanded() {
  return getCachedToolDisplaySettings().expandProcessStageByDefault === true
}

/** 思考块归属的 assistant bridge：折叠可能已把它搬进其它 assistant 的过程组，所以先看记录的来源 assistant 与渲染宿主，最后才回落到 DOM 祖先。 */
function processThinkingAssistant(node: HTMLElement) {
  return processThinkingSources.get(node)?.assistant
    ?? processNodeOwners.get(node)
    ?? node.closest<AssistantMessageElement>('assistant-message, .qf-assistant-message')
}

/**
 * 该项是否为「正在流式的思考块」——其来源 assistant bridge `isStreaming === true`。
 *
 * 用于 `populateProcessGroup`：设置「工具调用列表默认展开」关闭时内层 stage 默认收起
 * （index.css `.quickforge-process-stage[data-expanded="false"] > …-stage-body` 的
 * `visibility:hidden`），把正在流式的思考行（连同尾行提示 hint）折进 stage 就会把它藏住。
 * 早先的实现改在 `updateProcessStageGroups` 里对「含流式思考的 stage」强制展开兜底，但
 * 每轮工具调用结束（message_end + 工具行出现 → 组全量重建）stage 都会回落设置默认，下一
 * 轮流式思考再把它顶开——观感就是每轮「展开又收缩」往复（用户反馈）。现在改为流式思考行
 * 不进 stage、改挂顶层组 body：组在流式期间默认展开，思考行与尾行提示照样可见，stage 始终
 * 跟随设置默认，本轮结束（isStreaming 翻转 → 组交还重建）时它自然收进 stage。
 */
function isStreamingThinkingItem(item: GroupedProcessNode) {
  return isProcessNodeKind(item.node, 'thinking-block')
    && processThinkingAssistant(item.node)?.isStreaming === true
}

/**
 * 段内项按「正在流式的思考行」切成交替 run：流式思考 run 挂顶层组 body（不被收起的
 * stage 藏住），其余 run 照常包 stage。切分保持原顺序——流式思考行通常就在段尾，但
 * 工具行的内容块（toolCall chunk）先于 message_end 出现时它也可能夹在工具行之前，
 * 所以按位置切而不是只抽段尾（见 isStreamingThinkingItem）。
 */
export type ProcessStageSectionRun<T> = { kind: 'stage' | 'liveThinking'; items: T[] }

export function splitStreamingThinkingRuns<T>(
  items: T[],
  isStreamingThinking: (item: T) => boolean,
): ProcessStageSectionRun<T>[] {
  const runs: ProcessStageSectionRun<T>[] = []
  for (const item of items) {
    const kind = isStreamingThinking(item) ? 'liveThinking' : 'stage'
    const last = runs[runs.length - 1]
    if (last && last.kind === kind) last.items.push(item)
    else runs.push({ kind, items: [item] })
  }
  return runs
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
    // stage 默认值只看设置：含流式思考的 stage 不再被强制展开（流式思考行挂在组 body，
    // 见 isStreamingThinkingItem）；saved state（用户手动开合）与增量 key 命中仍优先。
    const expanded = resolveProcessExpandedState(
      getProcessExpandedStates(panel).get(stageKey),
      previousStageKey === stageKey,
      stage.dataset.expanded === 'true',
      processStageDefaultExpanded(),
    )
    stage.dataset.expanded = String(expanded)
    const stageStreaming = isAgentStreaming && index === stages.length - 1
    const label = processStageLabel(summarizeProcessStageTools(
      stageBody.querySelectorAll<ToolMessageElement>('tool-message, .qf-tool-message'),
    ), stageStreaming)
    // Assign only on change: `textContent =` replaces the text node even for
    // an identical string, and this runs every decorate pass while streaming —
    // the rebuild-free update path must stay a zero-DOM-write frame when the
    // label did not change (same minimal-write precedent as the thinking
    // header adoption path).
    if (stageLabel.textContent !== label) stageLabel.textContent = label
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
      // 手动开合 stage = 阅读意图：通知滚动层解除贴底跟随（READING_INTENT_EVENT，
      // 见 scroll-sync），否则展开内容在下一帧就被跟随滚动拉出视口。
      emitReadingIntent(stageSummary)
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
    // 与 stage 开合同理：阅读意图 → 解除贴底跟随（READING_INTENT_EVENT）。
    emitReadingIntent(summary)
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

/**
 * 折叠收集准入：只有顶层 process detail 才是折叠单位，嵌套在其它 detail 内的节点
 * 不是——典型是展开的思考块内部由 React 渲染的思考正文 markdown（`ThinkingBlock`
 * 展开时渲染 `MarkdownBlock`，其 tag/class 都在 `PROCESS_DETAIL_NODE_SELECTOR` 里）。
 *
 * 把它当折叠项收集会把它搬进过程组的 step：父链一变，`markdownCandidates` 的顶层
 * 判定随之翻转（`parentElement.closest(PROCESS_NODE_SELECTOR)` 不再命中 thinking
 * block），它又被选中为终答 markdown 并从折叠项里剔除；下一帧 full 路径的
 * `restoreProcessTurn` 再把它送回 thinking 块，于是「收集→搬走→判为终答→归还」每帧
 * 互翻，整组每帧全量重建、每个被折叠节点每帧被搬动两次并重启其 CSS 动画，表现为
 * 运行中点击「思考过程」后页面一直重刷/闪烁。
 *
 * 已在过程组内的节点父链上没有 detail 祖先，仍算顶层并被收集（增量更新与指纹短路
 * 依赖这些节点持续参与收集），所以这里不能改用「是否位于过程组内」来判定。
 */
export function isFoldableProcessTimelineNode(node: HTMLElement, trackedOrOwned: boolean) {
  return trackedOrOwned && isTopLevelProcessDetail(node)
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

  const thinkingIndexes = new Map<AssistantMessageElement, number>()
  const thinkingIndexByNode = new Map<HTMLElement, number>()
  // Re-collect can see an already moved node below the anchor assistant before
  // it sees newly rendered nodes in the source assistant.  Existing source
  // indexes therefore seed the suffix; when React rendered a full replacement,
  // the direct nodes fill the complete non-empty thinking sequence from zero.
  assistants.forEach((assistant) => {
    const thinkingNodes = Array.from(assistant.querySelectorAll<HTMLElement>('thinking-block, .qf-thinking-block'))
    const directNodes = thinkingNodes.filter((node) => !previousByNode.has(node))
    // 跨 assistant 折叠后，本 assistant 渲染的思考节点已不在其子树内（被搬进其它
    // assistant 的组），但它们的既有序号同样属于本 assistant 的序号序列——必须一起
    // 参与 seed，否则新渲染的节点会从 0 重新编号并与旧节点序号冲突（尾行提示会取到
    // 别的思考段，替换判定也会误判）。
    const foldedElsewhere = Array.from(previousByNode.values())
      .filter((item) => item.sourceAssistant === assistant && isProcessNodeKind(item.node, 'thinking-block'))
      .map((item) => item.node)
    const knownIndexes = [...thinkingNodes, ...foldedElsewhere]
      .map((node) => processThinkingSources.get(node))
      .filter((source): source is { assistant: AssistantMessageElement; index: number } => source !== undefined && source.assistant === assistant)
      .map((source) => source.index)
    const expectedCount = assistantThinkingChunks(assistant).length
    const startIndex = directNodes.length >= expectedCount ? 0 : (Math.max(-1, ...knownIndexes) + 1)
    directNodes.forEach((node, index) => thinkingIndexByNode.set(node, startIndex + index))
    thinkingIndexes.set(assistant, startIndex + directNodes.length)
  })
  const sourceAssistantForNode = (node: HTMLElement, renderedAssistant: AssistantMessageElement) => (
    previousByNode.get(node)?.sourceAssistant
      ?? processNodeOwners.get(node)
      ?? renderedAssistant
  )

  return assistants.flatMap((renderedAssistant) => (
    Array.from(renderedAssistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR))
      .filter((node) => {
        const owner = sourceAssistantForNode(node, renderedAssistant)
        // A node moved into another assistant remains visible below the host;
        // collect it once, under the assistant that originally rendered it.
        // Nested details (thinking markdown rendered inside a thinking block)
        // are never fold units — see isFoldableProcessTimelineNode.
        return isFoldableProcessTimelineNode(node, previousByNode.has(node) || owner === renderedAssistant)
      })
      .map((node) => {
        const sourceAssistant = sourceAssistantForNode(node, renderedAssistant)
        const previous = previousByNode.get(node)
        if (isProcessNodeKind(node, 'thinking-block')) {
          const previousSource = processThinkingSources.get(node)
          const index = previousSource?.assistant === sourceAssistant
            ? previousSource.index
            : thinkingIndexByNode.get(node) ?? thinkingIndexes.get(sourceAssistant) ?? 0
          if (!previousSource || previousSource.assistant !== sourceAssistant || previousSource.index !== index) {
            thinkingIndexes.set(sourceAssistant, Math.max(thinkingIndexes.get(sourceAssistant) ?? 0, index + 1))
            processThinkingSources.set(node, { assistant: sourceAssistant, index })
          }
        }
        const item = previous ?? {
          node,
          sourceAssistant,
          sourceParent: node.parentElement,
          sourceNextSibling: node.nextSibling,
        }
        processNodeOwners.set(node, sourceAssistant)
        return item
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

/**
 * 按中间 Markdown 切分回合时间线：每段连续过程项（thinking/工具/subagent 卡）各归一个
 * 内层 stage（含首段——首段不再有裸 detail 形态），中间 Markdown 是组内不折叠的 detail 段。
 */
export function splitProcessStageSections<T>(items: T[], isMarkdown: (item: T) => boolean): ProcessStageSection<T>[] {
  const sections: ProcessStageSection<T>[] = []
  let processItems: T[] = []

  const closeProcess = () => {
    if (processItems.length === 0) return
    sections.push({ kind: 'stage', items: processItems })
    processItems = []
  }

  for (const item of items) {
    if (isMarkdown(item)) {
      closeProcess()
      sections.push({ kind: 'detail', items: [item] })
    } else {
      processItems.push(item)
    }
  }
  closeProcess()
  return sections
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
        sourceAssistant: processNodeOwners.get(node)
          ?? group.closest<AssistantMessageElement>('assistant-message, .qf-assistant-message')
          ?? group.parentElement as AssistantMessageElement,
        sourceParent: group.parentElement,
        sourceNextSibling: group,
      }))
}

/**
 * Nodes of a group in the order they must be re-inserted.
 *
 * Tracked nodes restore in reverse. Each keeps the sibling that followed it
 * when it was folded; if React later inserted nodes in front of that sibling,
 * the anchor moves to the earliest of those insertions. Inserting before that
 * shared point in reverse puts every folded node back ahead of content that
 * arrived after the fold, without reversing nodes that still share a parent.
 * Untracked fallback items are already in document order.
 */
function groupedProcessRestoreOrder(group: ProcessGroupElement): GroupedProcessNode[] {
  const tracked = groupedProcessNodeSequences.get(group)
  return tracked ? [...tracked].reverse() : groupedProcessNodes(group)
}

function restoreInsertionAnchor(parent: HTMLElement, sibling: ChildNode | null) {
  if (sibling?.parentNode !== parent) return null
  let anchor: ChildNode = sibling
  let previous = anchor.previousSibling
  while (previous) {
    anchor = previous
    previous = anchor.previousSibling
  }
  return anchor
}

function restoreGroupedProcessNode(item: GroupedProcessNode, group: ProcessGroupElement) {
  const { node, sourceParent, sourceNextSibling } = item
  setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
  setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)

  if (sourceParent?.isConnected) {
    // 折走时的 nextSibling 只在它仍紧挨着「被折走的位置」时才准。React 之后把工具行
    // 插到这个兄弟前面时，旧锚点仍是容器子节点，但已经不是思考块原来的下一个兄弟；
    // 按它 insertBefore 会把思考块放到工具后面。此时改插到该兄弟前面最新的那个节点前，
    // 思考块回到后出现的内容之前。锚点整个失效（含原本就是容器末尾）时，过程组若还在
    // 这个容器里就占着被折走的位置，插到组前；组不在本容器则追加到末尾，避免把后出现
    // 的节点插到本容器先出现的节点前面。逆序还原保持同一锚点上的源序。
    const anchor = restoreInsertionAnchor(sourceParent, sourceNextSibling)
      ?? (group.parentNode === sourceParent ? group : null)
    if (anchor) sourceParent.insertBefore(node, anchor)
    else sourceParent.append(node)
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
  const currentNodes = Array.from(item.sourceAssistant.querySelectorAll<HTMLElement>(PROCESS_NODE_SELECTOR))
    .filter((node) => !node.closest(PROCESS_GROUP_SELECTOR))
    .filter((node) => processDetailIsInAssistantScope(node, item.sourceAssistant))
  if (nodeKind === 'thinking-block') {
    const source = processThinkingSources.get(item.node)
    if (!source) return false
    const thinkingNodes = currentNodes.filter((node) => isProcessNodeKind(node, 'thinking-block'))
    // A source assistant can legitimately have no direct thinking node while
    // its old node is folded under another assistant.  Only the same source
    // index constitutes React replacing that node.
    return thinkingNodes[source.index] !== undefined && thinkingNodes[source.index] !== item.node
  }
  return currentNodes.some((node) => {
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
 * subtree, and the decoration layer re-folds the committed DOM in the same task
 * (from the boundary's `componentDidUpdate`), before the browser paints.
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

/**
 * 过程项按时间线原序直接挂进容器 inner 里的单个 step（工具组层级已移除，
 * 「调用了 N 项工具」折叠头由所在 stage 的「已执行 N 个工具调用」头部替代）。
 */
function populateProcessContainer(container: HTMLElement, items: GroupedProcessNode[]) {
  const step = createProcessStep()
  for (const { node } of items) {
    setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
    step.append(node)
  }
  ensureProcessBodyInner(container).append(step)
}

/**
 * 段内含任何工具行（含 subagent / 生图卡这类不可分组工具）才需要 stage 聚合头；
 * 纯思考段没有工具统计可聚合，空壳「已执行」没有信息量，直接挂 body 不折叠。
 */
export function processSectionNeedsStage<T extends { node: HTMLElement }>(items: T[]) {
  return items.some(({ node }) => isProcessNodeKind(node, 'tool-message'))
}

function populateProcessGroup(group: ProcessGroupElement, items: GroupedProcessNode[]) {
  const body = group.querySelector<HTMLElement>(`:scope > ${PROCESS_BODY_SELECTOR}`)
  if (!body) return false

  const sections = splitProcessStageSections(
    items,
    (item) => isProcessNodeKind(item.node, 'markdown-block'),
  )
  // 设置「工具调用列表默认展开」关闭时，正在流式的思考行不并入（收起的）stage，改挂组
  // body——否则它被 stage 收起态（visibility:hidden）藏住，而为了不藏它强制展开 stage 会
  // 让每轮工具调用往复开合（见 isStreamingThinkingItem）。设置默认展开时结构不变。
  const detachStreamingThinking = !processStageDefaultExpanded()
  for (const section of sections) {
    if (section.kind === 'detail' || !processSectionNeedsStage(section.items)) {
      populateProcessContainer(body, section.items)
      continue
    }

    const runs = detachStreamingThinking
      ? splitStreamingThinkingRuns(section.items, isStreamingThinkingItem)
      : [{ kind: 'stage' as const, items: section.items }]
    for (const run of runs) {
      // 流式思考 run、以及自身没有工具行可聚合的 run：直接挂组 body（不建空 stage 头）。
      if (run.kind === 'liveThinking' || !processSectionNeedsStage(run.items)) {
        populateProcessContainer(body, run.items)
        continue
      }

      const stage = createProcessStage()
      const stageBody = stage.querySelector<HTMLElement>(PROCESS_STAGE_BODY_SELECTOR)
      if (!stageBody) continue
      populateProcessContainer(stageBody, run.items)
      ensureProcessBodyInner(body).append(stage)
    }
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
 * 而是把新行逐个搬进既有 stage 的 step，已有行节点保持原 DOM 位置不动。
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
 * 最后一个 stage step 的最后一行（期望结构超出纯后缀追加能表达的范围）。
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
  // 工具行挂在 stage-body 的动画壳层 inner 里的 step 中（见 ensureProcessBodyInner）：
  // 校验链 tail → step → stage-inner → stage → group 与「step 的最后一个子节点是 tail」
  // 一起，保证增量只 append 新行、已有行不被搬动（防闪烁关键路径）。
  const step = tail.parentElement
  const stageInner = step?.parentElement
  if (
    !step
    || !step.classList.contains(PROCESS_STEP_CLASS)
    || !stageInner
    || !stageInner.classList.contains(PROCESS_BODY_INNER_CLASS)
    || stageInner.closest(PROCESS_GROUP_SELECTOR) !== group
    || step.children[step.children.length - 1] !== tail
  ) return false

  currentNodes.slice(appendStart).forEach(({ node }) => {
    setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
    step.append(node)
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
/**
 * 结构的稳定指纹只描述**折叠结构**：终答 markdown（`finalSummaryMarkdown`，不参与
 * 折叠）必须排除在指纹之外。它首次出现的那一帧（思考过程结束、正文开始输出）会让
 * 指纹多出一项，进而被判定为「结构变化」走 full 重建——整组节点被搬动两次、组元素
 * 连同高度过渡一起重建，观感就是思考结束的瞬间「页面重新刷一下」。排除它之后，
 * 正文出现只走 `update` / `skip` 快路径（正文本身由 React 渲染，与折叠无关）。
 * 中间 markdown（可折叠的过程段）仍然计入指纹：它出现/消失确实改变折叠结构。
 */
export function processTurnFingerprint(assistants: AssistantMessageElement[], excludeNode: HTMLElement | null = null): string {
  const assistantIndexes = new Map(assistants.map((assistant, index) => [assistant, index]))
  const parts = collectProcessTimeline(assistants)
    .filter(({ node }) => node !== excludeNode)
    .map(({ node, sourceAssistant }) => {
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
  const canFoldMarkdown = hasTurnProcessSignals(assistants)
  const finalSummaryMarkdown = canFoldMarkdown
    ? findFinalSummaryMarkdown(finalSummaryTarget, isAgentStreaming)
    : null
  // 指纹在终答判定之后计算并排除终答 markdown：它不参与折叠，首次出现（思考过程
  // 结束、正文开始输出）不该被当成结构变化触发整组重建（见 processTurnFingerprint）。
  const fingerprint = processTurnFingerprint(assistants, finalSummaryMarkdown)
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
  const nodes = orderRestoredProcessNodes(
    collectFoldableProcessNodes(assistants, restoredFinalSummary, restoredCanFoldMarkdown),
    assistants,
  )
  if (nodes.length === 0) return

  const group = createTurnProcessGroup(nodes, assistants)
  if (!group) return
  group.dataset.quickforgeProcessFp = fingerprint
  updateProcessGroup(panel, processKey, assistants, group, isAgentStreaming)
  updateEmptyProcessSources(assistants)
}


/** 折叠节点在其来源 assistant `message.content` 里的源序号；对不上时保持收集顺序。 */
function contentPartIndex(node: HTMLElement, assistant: AssistantMessageElement) {
  const content = assistant.message?.content
  if (!Array.isArray(content)) return null
  if (isProcessNodeKind(node, 'thinking-block')) {
    const source = processThinkingSources.get(node)
    if (!source || source.assistant !== assistant) return null
    let seen = 0
    for (let index = 0; index < content.length; index += 1) {
      const chunk = content[index]
      if (!isRecord(chunk) || chunk.type !== 'thinking') continue
      if (typeof chunk.thinking !== 'string' || chunk.thinking.trim() === '') continue
      if (seen === source.index) return index
      seen += 1
    }
    return null
  }
  if (isProcessNodeKind(node, 'tool-message')) {
    const id = (node as ToolMessageElement).toolCall?.id
    if (!id) return null
    const index = content.findIndex((chunk) => (
      isRecord(chunk) && chunk.type === 'toolCall' && chunk.id === id
    ))
    return index >= 0 ? index : null
  }
  if (isProcessNodeKind(node, 'markdown-block')) {
    const text = (node.textContent ?? '').trim()
    if (!text) return null
    const index = content.findIndex((chunk) => (
      isRecord(chunk) && chunk.type === 'text' && typeof chunk.text === 'string' && chunk.text.trim() === text
    ))
    return index >= 0 ? index : null
  }
  return null
}

/**
 * 全量重建收集到的 DOM 序可能已经错：思考块先被折走后，React 把工具行插到过程组前面
 * 或另一条消息里，还原锚点对不上原来的下一个兄弟，思考块就会落到工具后面。
 * 来源消息的 content 序号是渲染时的源序，同一条 assistant 内按它排回思考在前。
 * 对不上序号的节点保持收集顺序。
 */
export function orderRestoredProcessNodes<T extends { node: HTMLElement; sourceAssistant: AssistantMessageElement }>(
  nodes: T[],
  assistants: AssistantMessageElement[],
) {
  const assistantOrder = new Map(assistants.map((assistant, index) => [assistant, index]))
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((left, right) => {
      const assistantDelta = (assistantOrder.get(left.node.sourceAssistant) ?? 0)
        - (assistantOrder.get(right.node.sourceAssistant) ?? 0)
      if (assistantDelta !== 0) return assistantDelta
      if (left.node.sourceAssistant !== right.node.sourceAssistant) return left.index - right.index
      const leftPart = contentPartIndex(left.node.node, left.node.sourceAssistant)
      const rightPart = contentPartIndex(right.node.node, right.node.sourceAssistant)
      if (leftPart === null || rightPart === null || leftPart === rightPart) return left.index - right.index
      return leftPart - rightPart
    })
    .map(({ node }) => node)
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
