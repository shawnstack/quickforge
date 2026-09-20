/* eslint-disable react-refresh/only-export-components -- exports the UsageBar component plus the pure usage aggregation/formatting helpers covered by tests. */
import type { AgentMessage, Usage } from './ChatTypes'

/**
 * Aggregated usage bar (bottom-of-composer stats row), React counterpart of
 * `AgentInterface.renderStats` from the legacy panel. Formatting helpers mirror the
 * package's `utils/format.ts` so numbers keep the same `↑12 ↓3k R8k $0.0123`
 * shape.
 */

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString()
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

export function formatUsage(usage: Usage): string {
  if (!usage) return ''

  const parts: string[] = []
  if (usage.input) parts.push(`↑${formatTokenCount(usage.input)}`)
  if (usage.output) parts.push(`↓${formatTokenCount(usage.output)}`)
  if (usage.cacheRead) parts.push(`R${formatTokenCount(usage.cacheRead)}`)
  if (usage.cacheWrite) parts.push(`W${formatTokenCount(usage.cacheWrite)}`)
  if (usage.cost?.total) parts.push(formatCost(usage.cost.total))

  return parts.join(' ')
}

/**
 * Sum input/output/cache/cost usage across all assistant messages.
 * Non-assistant messages and assistant messages without usage are ignored.
 */
export function aggregateUsage(messages: AgentMessage[]): Usage {
  return messages
    .filter((message): message is Extract<AgentMessage, { role: 'assistant' }> => message.role === 'assistant')
    .reduce<Usage>(
      (acc, message) => {
        const usage = message.usage
        if (usage) {
          acc.input += usage.input
          acc.output += usage.output
          acc.cacheRead += usage.cacheRead
          acc.cacheWrite += usage.cacheWrite
          acc.cost.total += usage.cost.total
        }
        return acc
      },
      {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    )
}

type UsageBarProps = {
  messages: AgentMessage[]
  onCostClick?: () => void
}

export function UsageBar({ messages, onCostClick }: UsageBarProps) {
  const totals = aggregateUsage(messages)
  const hasTotals = totals.input || totals.output || totals.cacheRead || totals.cacheWrite
  const totalsText = hasTotals ? formatUsage(totals) : ''

  return (
    <div className="qf-usage-bar flex h-5 items-center justify-between text-xs text-muted-foreground">
      <div className="flex items-center gap-1" />
      <div className="ml-auto flex items-center gap-3">
        {totalsText ? (
          onCostClick ? (
            <button
              type="button"
              className="cursor-pointer transition-colors hover:text-foreground"
              onClick={onCostClick}
            >
              {totalsText}
            </button>
          ) : (
            <span>{totalsText}</span>
          )
        ) : null}
      </div>
    </div>
  )
}
