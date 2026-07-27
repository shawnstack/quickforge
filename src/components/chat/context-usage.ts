/**
 * Context usage ring indicator.
 *
 * Shows a small colored ring next to the composer indicating how much of the
 * model's context window is consumed by the current conversation.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GitBranch } from 'lucide-react'
import { t } from '@/lib/i18n'
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

type ContextUsageTipData = {
  usage: ContextUsageInfo
  contextWindow: number
  serverCalculated: boolean
  compacted: boolean
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
  getIsCompacted?: () => boolean
  getGitBranch?: () => string | undefined
  onGitBranchClick?: () => void
  renderInline?: boolean
  renderModelRing?: boolean
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

export function isSameContextUsageDisplayInfo(left?: ContextUsageDisplayInfo, right?: ContextUsageDisplayInfo) {
  if (left === right) return true
  if (!left || !right || left.gitBranch !== right.gitBranch) return false
  if (!left.context || !right.context) return left.context === right.context
  return left.context.percent === right.context.percent
    && left.context.color === right.context.color
    && left.context.label === right.context.label
    && left.context.title === right.context.title
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
    ? t('contextUsageSourceProvider')
    : usage.inputTokenSource === 'mixed'
      ? t('contextUsageSourceMixed')
      : t('contextUsageSourceEstimated')
  const lines = [
    t('contextUsageUsed', {
      percent: usage.percent,
      used: formatTokens(usage.totalTokens),
      limit: formatTokens(contextWindow),
    }),
    t('contextUsageInput', { tokens: formatTokens(usage.inputTokens), source: inputLabel }),
    t('contextUsageLocalEstimate', { tokens: formatTokens(usage.estimatedInputTokens) }),
  ]
  const breakdown = usage.breakdown
  if (breakdown) {
    lines.push(
      t('contextUsageSystemPrompt', { tokens: formatOptionalTokens(breakdown.systemPromptTokens) ?? '0' }),
      t('contextUsageToolsSchema', { tokens: formatOptionalTokens(breakdown.toolsTokens) ?? '0' }),
      t('contextUsageMessages', { tokens: formatOptionalTokens(breakdown.messagesTokens) ?? '0' }),
    )
    if (breakdown.providerUsageTokens || breakdown.trailingTokens) {
      lines.push(
        t('contextUsageProviderBaseline', { tokens: formatOptionalTokens(breakdown.providerUsageTokens) ?? '0' }),
        t('contextUsageTrailingMessages', { tokens: formatOptionalTokens(breakdown.trailingTokens) ?? '0' }),
      )
    }
  }
  lines.push(t('contextUsageReservedOutput', { tokens: formatTokens(usage.reservedOutputTokens) }))
  if (serverCalculated) lines.push(t('contextUsageServerCalculated'))
  lines.push(compacted ? t('contextUsageScopeCompacted') : t('contextUsageScopeFull'))
  if (compacted && usage.originalMessageCount !== undefined && usage.effectiveMessageCount !== undefined) {
    lines.push(t('contextUsageEffectiveMessages', {
      effective: usage.effectiveMessageCount,
      visible: usage.originalMessageCount,
    }))
  }
  if (usage.knownInputTokens && usage.knownInputTokens > 0) {
    lines.push(t('contextUsageProviderTokens', { tokens: formatTokens(usage.knownInputTokens) }))
  }
  return lines.join('\n')
}

function createContextUsageTipController() {
  let tip: HTMLDivElement | null = null
  let trigger: HTMLElement | null = null
  let data: ContextUsageTipData | null = null
  let dataSignature = ''
  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  let boundTrigger: HTMLElement | null = null

  const handleTriggerEnter = () => scheduleOpen()
  const handleTriggerLeave = () => scheduleClose()
  const handleTriggerFocus = () => open()
  const handleTriggerBlur = () => scheduleClose()
  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (tip) close()
    else open()
  }
  const handleTriggerClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (tip) close()
    else open()
  }

  const unbindTrigger = () => {
    if (!boundTrigger) return
    boundTrigger.removeEventListener('mouseenter', handleTriggerEnter)
    boundTrigger.removeEventListener('mouseleave', handleTriggerLeave)
    boundTrigger.removeEventListener('focus', handleTriggerFocus)
    boundTrigger.removeEventListener('blur', handleTriggerBlur)
    boundTrigger.removeEventListener('keydown', handleTriggerKeyDown)
    boundTrigger.removeEventListener('click', handleTriggerClick)
    boundTrigger = null
  }

  const clearHoverTimer = () => {
    if (!hoverTimer) return
    clearTimeout(hoverTimer)
    hoverTimer = undefined
  }

  const removeTip = () => {
    tip?.remove()
    tip = null
    trigger?.setAttribute('aria-expanded', 'false')
    trigger?.removeAttribute('aria-describedby')
  }

  const positionTip = () => {
    if (!trigger || !tip) return
    const rect = trigger.getBoundingClientRect()
    const margin = 12
    const gap = 8
    const { width, height } = tip.getBoundingClientRect()
    let left = rect.right - width
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)
    let top = rect.top - gap - height
    if (top < margin) top = rect.bottom + gap
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(top)}px`
  }

  const addRow = (container: HTMLElement, label: string, value: string, subtle = false) => {
    const row = document.createElement('div')
    row.className = subtle ? 'quickforge-context-usage-tip-row is-subtle' : 'quickforge-context-usage-tip-row'
    const labelElement = document.createElement('span')
    labelElement.textContent = label
    const valueElement = document.createElement('span')
    valueElement.textContent = value
    row.append(labelElement, valueElement)
    container.append(row)
  }

  const renderTip = () => {
    removeTip()
    if (!trigger || !data) return
    const { usage, contextWindow, serverCalculated, compacted } = data
    const popover = document.createElement('div')
    popover.className = 'quickforge-context-usage-tip'
    popover.id = 'quickforge-context-usage-tip'
    popover.setAttribute('role', 'tooltip')

    const header = document.createElement('div')
    header.className = 'quickforge-context-usage-tip-header'
    const heading = document.createElement('span')
    heading.textContent = t('contextUsageTitle')
    const percent = document.createElement('span')
    percent.className = 'quickforge-context-usage-tip-percent'
    percent.style.color = usage.color
    percent.textContent = `${usage.percent}%`
    header.append(heading, percent)

    const total = document.createElement('div')
    total.className = 'quickforge-context-usage-tip-total'
    total.textContent = t('contextUsageTotal', {
      used: formatTokens(usage.totalTokens),
      limit: formatTokens(contextWindow),
    })

    const coreRows = document.createElement('div')
    coreRows.className = 'quickforge-context-usage-tip-section'
    addRow(coreRows, t('contextUsageInputLabel'), formatTokens(usage.inputTokens))
    addRow(coreRows, t('contextUsageReservedOutputLabel'), formatTokens(usage.reservedOutputTokens))

    popover.append(header, total, coreRows)

    const breakdown = usage.breakdown
    const breakdownRows = [
      [t('contextUsageSystemPromptLabel'), formatOptionalTokens(breakdown?.systemPromptTokens)],
      [t('contextUsageToolsSchemaLabel'), formatOptionalTokens(breakdown?.toolsTokens)],
      [t('contextUsageMessagesLabel'), formatOptionalTokens(breakdown?.messagesTokens)],
    ].filter((row): row is [string, string] => Boolean(row[1]))
    if (breakdownRows.length > 0) {
      const details = document.createElement('div')
      details.className = 'quickforge-context-usage-tip-section quickforge-context-usage-tip-details'
      for (const [label, value] of breakdownRows) addRow(details, label, value, true)
      popover.append(details)
    }

    const meta = document.createElement('div')
    meta.className = 'quickforge-context-usage-tip-meta'
    meta.textContent = `${serverCalculated ? t('contextUsageSourceServerShort') : t('contextUsageSourceLocalShort')} · ${compacted ? t('contextUsageScopeCompactedShort') : t('contextUsageScopeFullShort')}`
    popover.append(meta)

    document.body.append(popover)
    tip = popover
    trigger.setAttribute('aria-expanded', 'true')
    trigger.setAttribute('aria-describedby', popover.id)
    positionTip()
  }

  const open = () => {
    clearHoverTimer()
    renderTip()
  }

  const close = () => {
    clearHoverTimer()
    removeTip()
  }

  const scheduleOpen = () => {
    clearHoverTimer()
    hoverTimer = setTimeout(open, 150)
  }

  const scheduleClose = () => {
    clearHoverTimer()
    hoverTimer = setTimeout(close, 120)
  }

  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (target && (trigger?.contains(target) || tip?.contains(target))) return
    close()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !tip) return
    event.preventDefault()
    close()
    trigger?.focus()
  }

  const handlePositionChange = () => {
    if (tip) positionTip()
  }

  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('keydown', handleKeyDown, true)
  window.addEventListener('scroll', handlePositionChange, true)
  window.addEventListener('resize', handlePositionChange)

  const bind = (nextTrigger: HTMLElement, nextData: ContextUsageTipData) => {
    const nextDataSignature = JSON.stringify(nextData)
    const dataChanged = dataSignature !== nextDataSignature
    data = nextData
    dataSignature = nextDataSignature
    if (trigger !== nextTrigger) {
      unbindTrigger()
      trigger = nextTrigger
      boundTrigger = nextTrigger
      nextTrigger.tabIndex = 0
      nextTrigger.setAttribute('role', 'button')
      nextTrigger.setAttribute('aria-haspopup', 'true')
      nextTrigger.setAttribute('aria-expanded', 'false')
      nextTrigger.addEventListener('mouseenter', handleTriggerEnter)
      nextTrigger.addEventListener('mouseleave', handleTriggerLeave)
      nextTrigger.addEventListener('focus', handleTriggerFocus)
      nextTrigger.addEventListener('blur', handleTriggerBlur)
      nextTrigger.addEventListener('keydown', handleTriggerKeyDown)
      nextTrigger.addEventListener('click', handleTriggerClick)
    } else if (tip && dataChanged) {
      renderTip()
    }
  }

  const cleanup = () => {
    clearHoverTimer()
    removeTip()
    unbindTrigger()
    document.removeEventListener('pointerdown', handlePointerDown, true)
    document.removeEventListener('keydown', handleKeyDown, true)
    window.removeEventListener('scroll', handlePositionChange, true)
    window.removeEventListener('resize', handlePositionChange)
  }

  return { bind, close, cleanup }
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

export function createContextUsageIndicator({ panel, getSystemPrompt, getMessages, getContextWindow, getTools, getMaxTokens, getEffectiveMessages, getServerContextUsage, getIsCompacted, getGitBranch, onGitBranchClick, renderInline = true, renderModelRing = false, onDisplayChange }: ContextUsageOptions) {
  const tipController = createContextUsageTipController()
  let previousDisplayInfo: ContextUsageDisplayInfo | undefined
  const notifyDisplayChange = (displayInfo: ContextUsageDisplayInfo) => {
    if (isSameContextUsageDisplayInfo(previousDisplayInfo, displayInfo)) return
    previousDisplayInfo = displayInfo
    onDisplayChange?.(displayInfo)
  }

  const update = () => {
    const contextWindow = getContextWindow()
    const visibleMessages = getMessages()
    const serverUsage = getServerContextUsage?.()
    const effectiveMessages = serverUsage
      ? visibleMessages
      : getEffectiveMessages?.() ?? visibleMessages
    const existing = panel.querySelector<HTMLElement>('.quickforge-context-usage')
    const existingLabel = panel.querySelector<HTMLElement>('.quickforge-context-usage-label')
    const existingGitBranch = panel.querySelector<HTMLElement>('.quickforge-git-branch-inline')
    const statsRight = renderInline
      ? panel.querySelector('message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
      : null
    const modelButton = renderModelRing
      ? panel.querySelector<HTMLElement>('.quickforge-model-trigger')
      : null
    const modelControls = modelButton?.parentElement ?? null
    const gitBranch = getGitBranch?.()?.trim() || undefined
    const displayInfo: ContextUsageDisplayInfo = { gitBranch }

    if (!renderInline) {
      existingGitBranch?.remove()
      existingLabel?.remove()
      if (!renderModelRing) existing?.remove()
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
      tipController.close()
      existing?.remove()
      existingLabel?.remove()
      notifyDisplayChange(displayInfo)
      return displayInfo
    }

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
    const isCompacted = Boolean(usage.isCompacted)
      || (serverUsage ? Boolean(getIsCompacted?.()) : effectiveMessages !== visibleMessages)
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
    notifyDisplayChange(displayInfo)

    if (!renderInline && !renderModelRing) {
      existing?.remove()
      existingLabel?.remove()
      return displayInfo
    }

    if (renderModelRing && (!modelButton || !modelControls)) {
      existing?.remove()
      existingLabel?.remove()
      return displayInfo
    }

    if (!renderModelRing && !statsRight) {
      existing?.remove()
      existingLabel?.remove()
      return displayInfo
    }

    const ringPercent = Math.min(100, Math.max(0, usage.percent))
    const ring = `conic-gradient(${usage.color} ${ringPercent * 3.6}deg, color-mix(in oklab, var(--muted-foreground) 20%, transparent) 0deg)`
    const icon = existing ?? document.createElement('span')
    icon.className = 'quickforge-context-usage'
    icon.removeAttribute('title')
    icon.setAttribute('aria-label', t('contextUsageAriaLabel', { percent: usage.percent }))
    icon.style.cssText = [
      'display: inline-flex',
      'width: 14px',
      'height: 14px',
      'flex: 0 0 auto',
      'border-radius: 9999px',
      `background: ${ring}`,
      'vertical-align: middle',
      'mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)',
      '-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 0)',
    ].join(';')
    icon.replaceChildren()

    if (renderModelRing && modelButton && modelControls) {
      existingLabel?.remove()
      if (icon.parentElement !== modelControls || icon.nextElementSibling !== modelButton) {
        modelControls.insertBefore(icon, modelButton)
      }
      tipController.bind(icon, {
        usage,
        contextWindow: displayContextWindow,
        serverCalculated: Boolean(serverUsage),
        compacted: isCompacted,
      })
      return displayInfo
    }

    if (!statsRight) return displayInfo

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

  return { update, cleanup: tipController.cleanup }
}
