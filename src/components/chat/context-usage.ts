/**
 * Context usage ring indicator.
 *
 * Shows a small colored ring next to the composer indicating how much of the
 * model's context window is consumed by the current conversation.
 */

import type { MessageWithUsage } from './chat-utils'
import {
  getContextUsage,
  formatTokens,
} from './chat-utils'

type ContextUsageOptions = {
  panel: HTMLElement
  getSystemPrompt: () => string
  getMessages: () => MessageWithUsage[]
  getContextWindow: () => number
  getTools?: () => unknown
  getMaxTokens?: () => number | undefined
  getEffectiveMessages?: () => MessageWithUsage[]
}

export function createContextUsageIndicator({ panel, getSystemPrompt, getMessages, getContextWindow, getTools, getMaxTokens, getEffectiveMessages }: ContextUsageOptions) {
  const update = () => {
    const contextWindow = getContextWindow()
    const visibleMessages = getMessages()
    const effectiveMessages = getEffectiveMessages?.() ?? visibleMessages
    const usage = getContextUsage(getSystemPrompt(), effectiveMessages, contextWindow, getTools?.() ?? [], getMaxTokens?.())
    const existing = panel.querySelector<HTMLElement>('.quickforge-context-usage')
    const statsRight = panel.querySelector('message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
    if (!contextWindow || !statsRight) {
      existing?.remove()
      panel.querySelector<HTMLElement>('.quickforge-context-usage-label')?.remove()
      return
    }

    const isCompacted = effectiveMessages !== visibleMessages
    const title = `Context used: ${usage.percent}% (${formatTokens(usage.totalTokens)} / ${formatTokens(contextWindow)} tokens, input ${formatTokens(usage.inputTokens)}, estimated input ${formatTokens(usage.estimatedInputTokens)}, reserved output ${formatTokens(usage.reservedOutputTokens)}${isCompacted ? ', compacted model context' : ''})`
    const ringPercent = Math.min(100, Math.max(0, usage.percent))
    const ring = `conic-gradient(${usage.color} ${ringPercent * 3.6}deg, rgb(229 231 235) 0deg)`
    const icon = existing ?? document.createElement('span')
    icon.className = 'quickforge-context-usage'
    icon.title = title
    icon.setAttribute('aria-label', title)
    icon.style.cssText = [
      'position: relative',
      'display: inline-flex',
      'width: 14px',
      'height: 14px',
      'flex: 0 0 auto',
      'border-radius: 9999px',
      `background: ${ring}`,
      'vertical-align: middle',
      'box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06)',
    ].join(';')
    let hole = icon.firstElementChild as HTMLElement | null
    if (!hole) {
      hole = document.createElement('span')
      icon.append(hole)
    }
    hole.style.cssText = [
      'position: absolute',
      'inset: 3px',
      'border-radius: 9999px',
      'background: hsl(var(--background))',
    ].join(';')
    let label = icon.nextElementSibling as HTMLElement | null
    if (!label?.classList.contains('quickforge-context-usage-label')) {
      label = document.createElement('span')
      label.className = 'quickforge-context-usage-label'
      label.style.cssText = 'color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1;'
    }
    label.textContent = `${usage.percent}%`
    label.title = title
    label.setAttribute('aria-label', title)
    if (!existing) {
      statsRight.prepend(label)
      statsRight.prepend(icon)
    } else if (icon.nextElementSibling !== label) {
      icon.after(label)
    }
  }

  return { update }
}
