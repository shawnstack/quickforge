import type { MessageWithUsage } from '../chat-utils'
import { t } from '@/lib/i18n'

type ProcessGroupElement = HTMLDivElement

type ToolMessageElement = HTMLElement & {
  result?: unknown
}

type AssistantMessageElement = HTMLElement & {
  message?: MessageWithUsage & { stopReason?: string; errorMessage?: string }
  isStreaming?: boolean
}

const PROCESS_GROUP_SELECTOR = '.quickforge-process-group'
const PROCESS_BODY_SELECTOR = '.quickforge-process-body'
const PROCESS_NODE_SELECTOR = 'thinking-block, tool-message, streaming-message-container'
const PROCESS_DETAIL_NODE_SELECTOR = 'thinking-block, tool-message, markdown-block, streaming-message-container'
const PROCESS_FINAL_SUMMARY_ATTR = 'data-quickforge-process-final-summary'
const PROCESS_FOLDED_ATTR = 'data-quickforge-process-folded'
const PROCESS_EXPANDED_STATE_LIMIT = 500
const processExpandedStates = new WeakMap<HTMLElement, Map<string, boolean>>()

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

function processTurnStateKey(assistants: AssistantMessageElement[], turnIndex: number) {
  const firstTimestamp = timestampFromUnknown(assistants[0]?.message?.timestamp)
  return `turn:${turnIndex}:started:${firstTimestamp ?? 'unknown'}`
}

function syncProcessGroupExpandedState(panel: HTMLElement, group: ProcessGroupElement, key: string) {
  const previousKey = group.dataset.quickforgeProcessKey
  group.dataset.quickforgeProcessKey = key

  const savedExpanded = getProcessExpandedStates(panel).get(key)
  if (savedExpanded !== undefined) {
    group.dataset.expanded = String(savedExpanded)
    return
  }

  group.dataset.expanded = previousKey === key && group.dataset.expanded === 'true' ? 'true' : 'false'
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

function formatProcessDuration(durationMs?: number) {
  if (durationMs === undefined || durationMs < 1000) return ''
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function processLabel(assistants: AssistantMessageElement[], body: HTMLElement, group: ProcessGroupElement, isAgentStreaming: boolean) {
  const streaming = isAgentStreaming
  const stopReason = [...assistants].reverse().find((assistant) => assistant.message?.stopReason)?.message?.stopReason
  const toolMessages = Array.from(body.querySelectorAll<ToolMessageElement>('tool-message'))
  const starts = [
    ...assistants.map((assistant) => timestampFromUnknown(assistant.message?.timestamp)),
    ...toolMessages.map(toolMessageStartedAt),
  ].filter((value): value is number => value !== undefined)
  const finishedTimes = toolMessages.map(toolMessageFinishedAt).filter((value): value is number => value !== undefined)
  const startedAt = starts.length > 0 ? Math.min(...starts) : undefined
  let finishedAt = finishedTimes.length > 0 ? Math.max(...finishedTimes) : undefined

  if (streaming) {
    finishedAt = Date.now()
  } else {
    const cachedFinishedAt = timestampFromUnknown(group.dataset.quickforgeFinishedAt)
    if (cachedFinishedAt !== undefined && cachedFinishedAt > 0) {
      finishedAt = cachedFinishedAt
    } else {
      // Once the run is complete, freeze the label timestamp so repeated
      // decoration does not keep increasing thinking-only durations.
      finishedAt = finishedAt ?? Date.now()
      group.dataset.quickforgeFinishedAt = String(finishedAt)
    }
  }

  const duration = startedAt !== undefined && finishedAt !== undefined
    ? formatProcessDuration(Math.max(0, finishedAt - startedAt))
    : ''

  const base = stopReason === 'error'
    ? t('processFailed')
    : stopReason === 'aborted'
      ? t('processAborted')
      : streaming
        ? t('processing')
        : t('processed')

  return duration ? `${base} ${duration}` : base
}

function assistantContentContainer(assistant: AssistantMessageElement) {
  const contentNode = assistant.querySelector<HTMLElement>(`${PROCESS_DETAIL_NODE_SELECTOR}, ${PROCESS_GROUP_SELECTOR}`)
  return contentNode?.closest<HTMLElement>('.px-4.flex.flex-col') ?? contentNode?.parentElement ?? null
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

function ensureTurnProcessGroup(target: AssistantMessageElement) {
  const existing = target.querySelector<ProcessGroupElement>(PROCESS_GROUP_SELECTOR)
  if (existing) return existing

  const container = assistantContentContainer(target)
  if (!container) return null

  const group = createProcessGroup()
  container.insertBefore(group, container.firstElementChild)
  return group
}

function updateProcessGroup(panel: HTMLElement, processKey: string, assistants: AssistantMessageElement[], group: ProcessGroupElement, isAgentStreaming: boolean) {
  syncProcessGroupExpandedState(panel, group, processKey)
  const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
  const summary = group.querySelector<HTMLButtonElement>('.quickforge-process-summary')
  const label = group.querySelector<HTMLElement>('.quickforge-process-label')
  if (!body || !summary || !label) return

  const nextLabel = processLabel(assistants, body, group, isAgentStreaming)
  if (label.textContent !== nextLabel) label.textContent = nextLabel

  const expanded = group.dataset.expanded === 'true'
  summary.setAttribute('aria-expanded', String(expanded))
  summary.setAttribute('aria-label', expanded ? t('collapseProcess') : t('expandProcess'))
  summary.onclick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const nextExpanded = group.dataset.expanded !== 'true'
    group.dataset.expanded = String(nextExpanded)
    rememberProcessExpandedState(panel, processKey, nextExpanded)
    summary.setAttribute('aria-expanded', String(nextExpanded))
    summary.setAttribute('aria-label', nextExpanded ? t('collapseProcess') : t('expandProcess'))
  }
}

function markdownCandidates(target: AssistantMessageElement) {
  return Array.from(target.querySelectorAll<HTMLElement>('markdown-block'))
    .filter((node) => !node.closest(PROCESS_NODE_SELECTOR))
}

function lastNonEmptyOrLast(candidates: HTMLElement[]) {
  const nonEmptyCandidates = candidates.filter((node) => (node.textContent ?? '').trim().length > 0)
  return nonEmptyCandidates[nonEmptyCandidates.length - 1] ?? candidates[candidates.length - 1] ?? null
}

function setProcessFlag(node: HTMLElement, attr: string, enabled: boolean) {
  if (enabled) {
    if (!node.hasAttribute(attr)) node.setAttribute(attr, 'true')
    return
  }
  if (node.hasAttribute(attr)) node.removeAttribute(attr)
}

function findFinalSummaryMarkdown(target: AssistantMessageElement, isAgentStreaming: boolean) {
  if (isAgentStreaming) return null

  const candidates = markdownCandidates(target)
  const markedFinalSummary = lastNonEmptyOrLast(candidates.filter((node) => node.hasAttribute(PROCESS_FINAL_SUMMARY_ATTR)))
  if (markedFinalSummary) return markedFinalSummary

  const visibleCandidates = candidates.filter((node) => !node.closest(PROCESS_BODY_SELECTOR))
  const visibleFinalSummary = lastNonEmptyOrLast(visibleCandidates)
  if (visibleFinalSummary) return visibleFinalSummary

  return lastNonEmptyOrLast(candidates)
}

function markFinalSummaryMarkdown(target: AssistantMessageElement, finalSummaryMarkdown: HTMLElement | null) {
  markdownCandidates(target).forEach((node) => {
    if (node === finalSummaryMarkdown) {
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, true)
      setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
    } else {
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
    }
  })
}

function hasTurnProcessSignals(assistants: AssistantMessageElement[]) {
  return assistants.length > 1 || assistants.some((assistant) => Boolean(assistant.querySelector(PROCESS_NODE_SELECTOR)))
}

function isFoldableProcessDetail(node: HTMLElement, finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  if (node === finalSummaryMarkdown) return false
  if (node.tagName.toLowerCase() === 'markdown-block') return canFoldMarkdown
  return true
}

function hasFoldableProcessContent(assistants: AssistantMessageElement[], finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  return assistants.some((assistant) => {
    return Array.from(assistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR))
      .some((node) => isFoldableProcessDetail(node, finalSummaryMarkdown, canFoldMarkdown))
  })
}

function restoreFinalSummaryMarkdown(group: ProcessGroupElement, finalSummaryMarkdown: HTMLElement | null) {
  if (!finalSummaryMarkdown?.closest(PROCESS_BODY_SELECTOR)) return false
  group.after(finalSummaryMarkdown)
  setProcessFlag(finalSummaryMarkdown, PROCESS_FOLDED_ATTR, false)
  setProcessFlag(finalSummaryMarkdown, PROCESS_FINAL_SUMMARY_ATTR, true)
  return true
}

function processBodyHasContent(group: ProcessGroupElement) {
  return (group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)?.childElementCount ?? 0) > 0
}

function restoreProcessTurn(assistants: AssistantMessageElement[]) {
  for (const assistant of assistants) {
    assistant.classList.remove('quickforge-process-source-empty')
    assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR).forEach((group) => {
      const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
      if (body) {
        Array.from(body.children).forEach((node) => {
          if (node instanceof HTMLElement) {
            setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
            setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
          }
          group.parentElement?.insertBefore(node, group)
        })
      }
      group.remove()
    })
    markdownCandidates(assistant).forEach((node) => {
      setProcessFlag(node, PROCESS_FOLDED_ATTR, false)
      setProcessFlag(node, PROCESS_FINAL_SUMMARY_ATTR, false)
    })
  }
}

function moveProcessNodesIntoTurnGroup(assistants: AssistantMessageElement[], group: ProcessGroupElement, finalSummaryMarkdown: HTMLElement | null, canFoldMarkdown: boolean) {
  const body = group.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
  if (!body) return false

  let moved = false
  for (const assistant of assistants) {
    assistant.querySelectorAll<ProcessGroupElement>(PROCESS_GROUP_SELECTOR).forEach((existingGroup) => {
      const existingBody = existingGroup.querySelector<HTMLElement>(PROCESS_BODY_SELECTOR)
      if (existingBody && existingBody !== body) {
        Array.from(existingBody.children).forEach((node) => {
          body.append(node)
          moved = true
        })
      }
      if (existingGroup !== group) existingGroup.remove()
    })

    assistant.querySelectorAll<HTMLElement>(PROCESS_DETAIL_NODE_SELECTOR).forEach((node) => {
      if (!isFoldableProcessDetail(node, finalSummaryMarkdown, canFoldMarkdown)) return
      if (node.closest(PROCESS_BODY_SELECTOR)) return
      setProcessFlag(node, PROCESS_FOLDED_ATTR, true)
      body.append(node)
      moved = true
    })
  }

  restoreFinalSummaryMarkdown(group, finalSummaryMarkdown)
  return moved || processBodyHasContent(group)
}

function updateEmptyProcessSources(assistants: AssistantMessageElement[], target: AssistantMessageElement) {
  for (const assistant of assistants) {
    if (assistant === target) {
      assistant.classList.remove('quickforge-process-source-empty')
      continue
    }

    const hasVisibleContent = Boolean(
      assistant.querySelector('markdown-block, thinking-block, tool-message, .quickforge-process-group, .quickforge-approval-card'),
    )
    assistant.classList.toggle('quickforge-process-source-empty', !hasVisibleContent)
  }
}

function decorateProcessTurn(panel: HTMLElement, assistants: AssistantMessageElement[], isAgentStreaming: boolean, turnIndex: number) {
  if (assistants.length === 0) return

  const target = assistants[assistants.length - 1]
  const processKey = processTurnStateKey(assistants, turnIndex)
  const existingGroup = target.querySelector<ProcessGroupElement>(PROCESS_GROUP_SELECTOR)
  if (isAgentStreaming) {
    if (existingGroup) restoreProcessTurn(assistants)
    return
  }
  const canFoldMarkdown = hasTurnProcessSignals(assistants)
  const finalSummaryMarkdown = canFoldMarkdown ? findFinalSummaryMarkdown(target, isAgentStreaming) : null
  if (canFoldMarkdown) markFinalSummaryMarkdown(target, finalSummaryMarkdown)
  const hasProcessContent = hasFoldableProcessContent(assistants, finalSummaryMarkdown, canFoldMarkdown)
  if (!hasProcessContent) {
    if (existingGroup) {
      restoreFinalSummaryMarkdown(existingGroup, finalSummaryMarkdown)
      restoreProcessTurn(assistants)
    }
    return
  }

  const group = ensureTurnProcessGroup(target)
  if (!group) return

  const hasGroupedContent = moveProcessNodesIntoTurnGroup(assistants, group, finalSummaryMarkdown, canFoldMarkdown)
  if (!hasGroupedContent || !processBodyHasContent(group)) {
    group.remove()
    return
  }

  updateProcessGroup(panel, processKey, assistants, group, isAgentStreaming)
  updateEmptyProcessSources(assistants, target)
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
    decorateProcessTurn(panel, assistants, isAgentStreaming && isLastMessageAssistant && index === turns.length - 1, index)
  })
}
