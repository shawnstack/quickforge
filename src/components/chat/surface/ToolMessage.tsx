import { Code, Loader2 } from 'lucide-react'
import { memo, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { getToolRenderer } from '@/lib/tool-renderer-registry'
import type { AgentTool, ToolCall, ToolResultMessage } from './ChatTypes'
/**
 * React replacement for the legacy `<tool-message>` custom element.
 *
 * Resolves renderers through the local tool renderer registry
 * (`@/lib/tool-renderer-registry`). Missing renderers use the default React
 * tool card; registered renderers return React content directly.
 *
 * The root node mirrors the legacy element's data properties (`tool`, `toolCall`,
 * `result`, `pending`, `aborted`) so the DOM-level panel-decoration layer
 * (process folding summaries) keeps reading them off the element.
 */

type ToolMessageBridgeElement = HTMLElement & {
  tool?: { name?: string }
  toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown> }
  result?: unknown
  pending?: boolean
  aborted?: boolean
}

type ToolMessageProps = {
  toolCall: ToolCall
  tool?: AgentTool
  result?: ToolResultMessage
  pending?: boolean
  /** True when the message was aborted and this call has no result. */
  aborted?: boolean
  isStreaming?: boolean
}

type ToolCardState = 'inprogress' | 'complete' | 'error'

function prettyValue(value: unknown): { text: string; isJson: boolean } {
  try {
    if (typeof value === 'string') {
      return { text: JSON.stringify(JSON.parse(value), null, 2), isJson: true }
    }
    return { text: JSON.stringify(value, null, 2), isJson: true }
  } catch {
    return { text: typeof value === 'string' ? value : String(value), isJson: false }
  }
}

function resultTextOutput(result: ToolResultMessage): { text: string; isJson: boolean } {
  const joined = result.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') || t('toolCallNoOutput')
  return prettyValue(joined)
}

function ToolStatusIcon({ state }: { state: ToolCardState }) {
  if (state === 'inprogress') return <Loader2 className="inline-block size-4 animate-spin text-foreground" />
  return (
    <Code
      className={cn(
        'inline-block size-4',
        state === 'error' ? 'text-destructive' : 'text-green-600 dark:text-green-500',
      )}
    />
  )
}

function DefaultToolCardBody({
  toolName,
  params,
  result,
  isStreaming,
}: {
  toolName: string
  params: ToolCall['arguments']
  result: ToolResultMessage | undefined
  isStreaming: boolean
}) {
  const state: ToolCardState = result ? (result.isError ? 'error' : 'complete') : isStreaming ? 'inprogress' : 'complete'
  const paramsJson = params ? prettyValue(params).text : ''
  const headerText = result ? t('toolCallLabel') : params && (!paramsJson || paramsJson === '{}' || paramsJson === 'null') && isStreaming ? t('toolCallPreparing') : t('toolCallLabel')

  return (
    <div className="space-y-2">
      <div className="quickforge-tool-summary flex items-center gap-2 text-sm text-muted-foreground">
        <ToolStatusIcon state={state} />
        <span className="truncate">
          {headerText}
          {result ? `: ${toolName}` : ''}
        </span>
      </div>
      {paramsJson ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>
          <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs text-foreground">
            <code>{paramsJson}</code>
          </pre>
        </div>
      ) : null}
      {result ? (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>
          <pre className="max-h-96 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-xs text-foreground">
            <code>{resultTextOutput(result).text}</code>
          </pre>
        </div>
      ) : null}
    </div>
  )
}

// Memoized (R1 F1b, matching AssistantMessage/UserMessage): a tool card only
// changes when its `toolCall`/`tool`/`result` identities change (the agent
// never mutates published messages in place), so while one message streams
// every unrelated tool row — including long-running spinners — bails out at
// this memo instead of re-rendering (which resets nothing visually, but adds
// render work per streaming frame and amplifies any DOM-adjacent churn).
export const ToolMessage = memo(function ToolMessage({ toolCall, tool, result, pending = false, aborted = false, isStreaming = false }: ToolMessageProps) {
  const toolName = tool?.name || toolCall.name
  const rootRef = useRef<HTMLDivElement | null>(null)
  // Mirror the legacy element's data properties on the root node after every
  // render so process-folding reads fresh values off the element.
  //
  // `useLayoutEffect` (not `useEffect`): the mirror must be in place before an
  // ancestor's `componentDidUpdate` re-folds the trace synchronously (see
  // AssistantMessage / SubagentTrace), otherwise folding would fingerprint the
  // previous commit's tool call ids and force a full rebuild.
  useLayoutEffect(() => {
    const bridge = rootRef.current as ToolMessageBridgeElement | null
    if (!bridge) return
    bridge.tool = tool
    bridge.toolCall = toolCall
    bridge.result = result
    bridge.pending = pending
    bridge.aborted = aborted
  })

  // Mirrors the legacy tool-message element: an aborted call renders as an error result.
  // The synthetic timestamp is display-only (never read by renderers) and
  // kept at 0 to keep the render pure.
  const effectiveResult: ToolResultMessage | undefined = aborted
    ? {
        role: 'toolResult',
        isError: true,
        content: [],
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        timestamp: 0,
      }
    : result

  const renderer = getToolRenderer(toolName)
  const renderResult = renderer?.render(toolCall.arguments, effectiveResult, !aborted && (isStreaming || pending))

  if (!renderResult) {
    return (
      <div ref={rootRef} className="qf-tool-message p-2.5 rounded-md border border-border bg-card text-card-foreground shadow-xs">
        <DefaultToolCardBody toolName={toolName} params={toolCall.arguments} result={effectiveResult} isStreaming={!aborted && (isStreaming || pending)} />
      </div>
    )
  }

  if (renderResult.isCustom) {
    return <div ref={rootRef} className="qf-tool-message">{renderResult.content}</div>
  }

  return (
    <div ref={rootRef} className="qf-tool-message p-2.5 rounded-md border border-border bg-card text-card-foreground shadow-xs">
      {renderResult.content}
    </div>
  )
})
