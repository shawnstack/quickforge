import { memo, useLayoutEffect, useRef } from 'react'
import type {
  AgentTool,
  AssistantMessage as AssistantMessageType,
  ToolResultMessage as ToolResultMessageType,
  Usage,
} from './ChatTypes'
import { t } from '@/lib/i18n'
import { MarkdownBlock } from './Markdown'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolMessage } from './ToolMessage'
import { formatUsage } from './UsageBar'
import { assistantContentParts } from './content-parts'
import { AssistantStreamingContext, useAssistantStreaming } from './surface-context'

/**
 * React replacement for the legacy `<assistant-message>` custom element.
 *
 * Renders the assistant message content chunks strictly in source order
 * (text → markdown, thinking → collapsible block, toolCall → tool message)
 * followed by the usage footer and error/aborted hints.
 *
 * The root node mirrors the legacy element's data properties (`message`,
 * `isStreaming`) so the DOM-level panel-decoration layer (process folding,
 * turn error rows) keeps reading them off the element.
 */

type AssistantMessageBridgeElement = HTMLElement & {
  message?: AssistantMessageType
  isStreaming?: boolean
}

type AssistantMessageProps = {
  message: AssistantMessageType
  tools?: AgentTool[]
  pendingToolCalls?: ReadonlySet<string>
  toolResultsById?: Map<string, ToolResultMessageType>
  isStreaming?: boolean
  /** Skip pending tool calls without results (the message list owns them). */
  hidePendingToolCalls?: boolean
  onCostClick?: () => void
}

// Memoized (R1 F1b): finished assistant rows re-render only when one of these
// props changes identity. `message`/`tools`/`pendingToolCalls` are stable per
// R1 F1a (snapshot identity reuse) and `toolResultsById` is memoized on
// `messages` in MessageList/ChatSurface, so streaming events — which only
// swap `streamingAssistant` — bail out at this memo for every finished row.
// The streaming container instance still re-renders per event because its
// `message` is a fresh partial body each frame.
export const AssistantMessage = memo(function AssistantMessage({
  message,
  tools,
  pendingToolCalls,
  toolResultsById,
  isStreaming = false,
  hidePendingToolCalls = false,
  onCostClick,
}: AssistantMessageProps) {
  // Streaming gate for this row's subtree (CodeBlock previews / run actions).
  // The provider lives *inside* the row component: `MessageList` renders the
  // streaming partial and — after `message_end` — its committed form as the
  // same keyed child, and a wrapper element around the row that appeared or
  // vanished on that hand-off would remount the whole subtree just as surely
  // as a key change. A trace surface (`SubagentRunDetailContent`) provides
  // "still streaming" for its whole subtree, so an enclosing value keeps
  // overriding the per-row flag.
  const surfaceStreaming = useAssistantStreaming()

  // Parts keep their source-content index as key (see `content-parts`): an
  // earlier chunk appearing/disappearing must not re-key every later part.
  const parts = assistantContentParts(message, { hidePendingToolCalls, pendingToolCalls, toolResultsById })

  const usage: Usage | undefined = message.usage
  const rootRef = useRef<HTMLDivElement | null>(null)
  // Mirror the legacy element's data properties on the root node after every
  // render so the panel-decoration layer (process folding, turn error rows)
  // reads fresh message/isStreaming values off the element.
  //
  // `useLayoutEffect` (not `useEffect`): React runs layout effects child-first
  // before the parent class lifecycle, so a folding pass that re-decorates
  // synchronously from `componentDidUpdate` (see SubagentTrace) reads the values
  // of the commit it decorates instead of the previous one.
  useLayoutEffect(() => {
    const bridge = rootRef.current as AssistantMessageBridgeElement | null
    if (!bridge) return
    bridge.message = message
    bridge.isStreaming = isStreaming
  })

  return (
    <AssistantStreamingContext.Provider value={surfaceStreaming || isStreaming}>
      <div className="qf-assistant-message" ref={rootRef}>
        {parts.length > 0 ? (
          // Parts carry their own stable keys (source content index / tool-call
          // id); an index-keyed Fragment wrapper here would defeat them.
          // gap-1.5 (0.375rem) matches the in-group process rhythm (0.25–0.375rem)
          // so grouped and ungrouped parts breathe the same.
          <div className="flex flex-col gap-1.5 px-4">
            {parts.map((part) => {
              if (part.kind === 'text') return <MarkdownBlock key={part.key} content={part.text} />
              if (part.kind === 'thinking') {
                return <ThinkingBlock key={part.key} content={part.thinking} isStreaming={isStreaming} />
              }
              const tool = tools?.find((candidate) => candidate.name === part.call.name)
              const pending = pendingToolCalls?.has(part.call.id) ?? false
              const result = toolResultsById?.get(part.call.id)
              // Aborted when the message was aborted and this call never got a result.
              const aborted = message.stopReason === 'aborted' && !result
              return (
                <ToolMessage
                  key={part.key}
                  tool={tool}
                  toolCall={part.call}
                  result={result}
                  pending={pending}
                  aborted={aborted}
                  isStreaming={isStreaming}
                />
              )
            })}
          </div>
        ) : null}
        {usage && !isStreaming ? (
          onCostClick ? (
            <button
              type="button"
              className="qf-usage-line mt-2 cursor-pointer px-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={onCostClick}
            >
              {formatUsage(usage)}
            </button>
          ) : (
            <div className="qf-usage-line mt-2 px-4 text-xs text-muted-foreground">{formatUsage(usage)}</div>
          )
        ) : null}
        {message.stopReason === 'error' && message.errorMessage ? (
          <div className="mx-4 mt-3 overflow-hidden rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <strong>{t('assistantErrorPrefix')}</strong> {message.errorMessage}
          </div>
        ) : null}
        {message.stopReason === 'aborted' ? (
          <span className="text-sm text-destructive italic">{t('assistantRequestAborted')}</span>
        ) : null}
      </div>
    </AssistantStreamingContext.Provider>
  )
})
