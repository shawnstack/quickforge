import type { Usage } from './ChatTypes'

/**
 * Token/cost formatting for the per-message usage line rendered by
 * `AssistantMessage` (the `↑12 ↓3k R8k $0.0123` shape).
 *
 * The aggregated totals row that used to sit under the composer is gone; these
 * helpers stay because the message-level line still renders (and is hidden by
 * `src/styles/chat/messages.css`). Kept pure so they stay easy to unit test.
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
