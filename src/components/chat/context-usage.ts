/**
 * Context usage ring indicator.
 *
 * Shows a small colored ring next to the composer indicating how much of the
 * model's context window is consumed by the current conversation.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitBranch } from 'lucide-react'
import type { ContextUsageInfo, MessageWithUsage } from './chat-utils'
import {
  getContextUsage,
  formatTokens,
} from './chat-utils'

type ServerContextUsageBreakdown = {
  systemPromptTokens?: number
  messagesTokens?: number
  toolsTokens?: number
  reservedOutputTokens?: number
  providerUsageTokens?: number
  trailingTokens?: number
  lastUsageIndex?: number | null
  localEstimatedContextTokens?: number
}

type ServerContextUsageInfo = {
  contextWindow?: number
  usedTokens?: number
  totalTokens?: number
  inputTokens?: number
  estimatedInputTokens?: number
  knownInputTokens?: number
  providerContextTokens?: number
  inputTokenSource?: 'provider' | 'estimated' | 'mixed'
  reservedOutputTokens?: number
  percent?: number
  color?: string
  isCompacted?: boolean
  compactedUpToIndex?: number
  originalMessageCount?: number
  effectiveMessageCount?: number
  breakdown?: ServerContextUsageBreakdown
}

type ContextUsageOptions = {
  panel: HTMLElement
  getSystemPrompt: () => string
  getMessages: () => MessageWithUsage[]
  getContextWindow: () => number
  getTools?: () => unknown
  getMaxTokens?: () => number | undefined
  getEffectiveMessages?: () => MessageWithUsage[]
  getServerContextUsage?: () => ServerContextUsageInfo | null | undefined
  getGitBranch?: () => string | undefined
  onGitBranchClick?: () => void
  renderInline?: boolean
  onDisplayChange?: (info: ContextUsageDisplayInfo) => void
}

export type ContextUsageDisplayInfo = {
  gitBranch?: string
  context?: {
    percent: number
    color: string
    label: string
    title: string
  }
}

function usageColor(percent: number) {
  const colorPercent = Math.min(100, Math.max(0, percent))
  const hue = Math.round(142 - (142 * colorPercent / 100))
  return `hsl(${hue} 72% 45%)`
}

function normalizeServerContextUsage(usage: ServerContextUsageInfo, contextWindow: number): ContextUsageInfo {
  const inputTokens = Number(usage.inputTokens) || 0
  const knownInputTokens = Math.max(0, Number(usage.knownInputTokens ?? usage.providerContextTokens) || 0)
  const estimatedInputTokens = Math.max(0, Number(usage.estimatedInputTokens) || 0)
  const reservedOutputTokens = Math.max(0, Number(usage.reservedOutputTokens) || 0)
  const totalTokens = Math.max(0, Number(usage.totalTokens) || inputTokens + reservedOutputTokens)
  const percent = Number.isFinite(Number(usage.percent)) ? Number(usage.percent) : 0
  const inputTokenSource = usage.inputTokenSource ?? (knownInputTokens > 0 ? 'provider' : 'estimated')
  return {
    contextWindow: Math.max(0, Number(usage.contextWindow) || contextWindow),
    usedTokens: Math.max(0, Number(usage.usedTokens) || inputTokens),
    totalTokens,
    inputTokens,
    estimatedInputTokens,
    knownInputTokens,
    inputTokenSource,
    reservedOutputTokens,
    percent,
    color: usage.color || usageColor(percent),
    isCompacted: usage.isCompacted,
    compactedUpToIndex: usage.compactedUpToIndex,
    originalMessageCount: usage.originalMessageCount,
    effectiveMessageCount: usage.effectiveMessageCount,
    breakdown: usage.breakdown,
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatOptionalTokens(value: unknown): string | null {
  const tokens = Math.max(0, Number(value) || 0)
  return tokens > 0 ? formatTokens(tokens) : null
}

function buildContextUsageTitle({ usage, contextWindow, serverCalculated, compacted }: {
  usage: ContextUsageInfo
  contextWindow: number
  serverCalculated: boolean
  compacted: boolean
}) {
  const inputLabel = usage.inputTokenSource === 'provider'
    ? 'provider context'
    : usage.inputTokenSource === 'mixed'
      ? 'provider/local mixed context'
      : 'estimated context'
  const lines = [
    `Context used: ${usage.percent}% (${formatTokens(usage.totalTokens)} / ${formatTokens(contextWindow)} tokens)`,
    `Input/context: ${formatTokens(usage.inputTokens)} (${inputLabel})`,
    `Local estimate: ${formatTokens(usage.estimatedInputTokens)}`,
  ]
  const breakdown = usage.breakdown
  if (breakdown) {
    lines.push(
      `  System prompt: ${formatOptionalTokens(breakdown.systemPromptTokens) ?? '0'}`,
      `  Tools schema: ${formatOptionalTokens(breakdown.toolsTokens) ?? '0'}`,
      `  Messages: ${formatOptionalTokens(breakdown.messagesTokens) ?? '0'}`,
    )
    if (breakdown.providerUsageTokens || breakdown.trailingTokens) {
      lines.push(
        `  Provider usage baseline: ${formatOptionalTokens(breakdown.providerUsageTokens) ?? '0'}`,
        `  Trailing messages after usage: ${formatOptionalTokens(breakdown.trailingTokens) ?? '0'}`,
      )
    }
  }
  lines.push(`Reserved output: ${formatTokens(usage.reservedOutputTokens)}`)
  if (serverCalculated) lines.push('Source: server calculated via pi-agent-core/pi-ai')
  lines.push(compacted
    ? 'Scope: compacted model context, not full visible chat history'
    : 'Scope: full model context')
  if (compacted && usage.originalMessageCount !== undefined && usage.effectiveMessageCount !== undefined) {
    lines.push(`Messages: ${usage.effectiveMessageCount} effective / ${usage.originalMessageCount} visible`)
  }
  if (usage.knownInputTokens && usage.knownInputTokens > 0) {
    lines.push(`Provider context tokens: ${formatTokens(usage.knownInputTokens)}`)
  }
  return lines.join('\n')
}

function bindGitBranchClick(branchBadge: HTMLElement, onGitBranchClick: (() => void) | undefined) {
  if (!onGitBranchClick) {
    branchBadge.removeAttribute('role')
    branchBadge.removeAttribute('tabindex')
    branchBadge.style.cursor = ''
    return
  }
  branchBadge.setAttribute('role', 'button')
  branchBadge.tabIndex = 0
  branchBadge.style.cursor = 'pointer'
  if (branchBadge.dataset.quickforgeGitBranchBound) return
  branchBadge.dataset.quickforgeGitBranchBound = 'true'
  branchBadge.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onGitBranchClick()
  })
  branchBadge.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onGitBranchClick()
  })
}

const gitBranchIcon = renderToStaticMarkup(createElement(GitBranch, {
  size: 13,
  strokeWidth: 2,
  'aria-hidden': true,
  style: { flex: '0 0 auto' },
}))

export function createContextUsageIndicator({ panel, getSystemPrompt, getMessages, getContextWindow, getTools, getMaxTokens, getEffectiveMessages, getServerContextUsage, getGitBranch, onGitBranchClick, renderInline = true, onDisplayChange }: ContextUsageOptions) {
  const update = () => {
    const contextWindow = getContextWindow()
    const visibleMessages = getMessages()
    const effectiveMessages = getEffectiveMessages?.() ?? visibleMessages
    const existing = panel.querySelector<HTMLElement>('.quickforge-context-usage')
    const existingLabel = panel.querySelector<HTMLElement>('.quickforge-context-usage-label')
    const existingGitBranch = panel.querySelector<HTMLElement>('.quickforge-git-branch-inline')
    const statsRight = renderInline
      ? panel.querySelector('message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
      : null
    const gitBranch = getGitBranch?.()?.trim() || undefined
    const displayInfo: ContextUsageDisplayInfo = { gitBranch }

    if (!renderInline) {
      existingGitBranch?.remove()
      existing?.remove()
      existingLabel?.remove()
    } else if (gitBranch && statsRight) {
      const gitBranchLabel = `${gitBranchIcon}<span style="max-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(gitBranch)}</span>`
      const gitBranchTitle = `Git branch: ${gitBranch}`
      if (existingGitBranch) {
        if (existingGitBranch.dataset.quickforgeGitBranch !== gitBranch) {
          existingGitBranch.innerHTML = gitBranchLabel
          existingGitBranch.dataset.quickforgeGitBranch = gitBranch
        }
        existingGitBranch.title = gitBranchTitle
        existingGitBranch.setAttribute('aria-label', gitBranchTitle)
        bindGitBranchClick(existingGitBranch, onGitBranchClick)
      } else {
        const branchBadge = document.createElement('span')
        branchBadge.className = 'quickforge-git-branch-inline'
        branchBadge.dataset.quickforgeGitBranch = gitBranch
        branchBadge.title = gitBranchTitle
        branchBadge.setAttribute('aria-label', gitBranchTitle)
        branchBadge.innerHTML = gitBranchLabel
        branchBadge.style.cssText = [
          'display: inline-flex',
          'align-items: center',
          'gap: 0.25rem',
          'max-width: 10rem',
          'color: hsl(var(--muted-foreground))',
          'font-size: 12px',
          'line-height: 1',
          'font-weight: 500',
        ].join(';')
        bindGitBranchClick(branchBadge, onGitBranchClick)
        statsRight.prepend(branchBadge)
      }
    } else {
      existingGitBranch?.remove()
    }

    if (!contextWindow) {
      if (renderInline) {
        existing?.remove()
        existingLabel?.remove()
      }
      onDisplayChange?.(displayInfo)
      return displayInfo
    }

    const serverUsage = getServerContextUsage?.()
    const hasEffectiveMessages = effectiveMessages.length > 0
    const usage = serverUsage
      ? normalizeServerContextUsage(serverUsage, contextWindow)
      : hasEffectiveMessages
        ? getContextUsage(getSystemPrompt(), effectiveMessages, contextWindow, getTools?.() ?? [], getMaxTokens?.())
        : {
          contextWindow,
          usedTokens: 0,
          totalTokens: 0,
          inputTokens: 0,
          estimatedInputTokens: 0,
          inputTokenSource: 'estimated' as const,
          reservedOutputTokens: 0,
          percent: 0,
          color: 'hsl(142 72% 45%)',
        }

    const displayContextWindow = usage.contextWindow || contextWindow
    const isCompacted = Boolean(usage.isCompacted) || effectiveMessages !== visibleMessages
    const title = buildContextUsageTitle({
      usage,
      contextWindow: displayContextWindow,
      serverCalculated: Boolean(serverUsage),
      compacted: isCompacted,
    })
    displayInfo.context = {
      percent: usage.percent,
      color: usage.color,
      label: `${usage.percent}% · ${formatTokens(usage.totalTokens)} / ${formatTokens(displayContextWindow)} tokens`,
      title,
    }
    onDisplayChange?.(displayInfo)

    if (!renderInline || !statsRight) {
      existing?.remove()
      existingLabel?.remove()
      return displayInfo
    }

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

    return displayInfo
  }

  return { update }
}
