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
import type { ContextUsageInfo } from './chat-utils'
import { formatTokens } from './chat-utils'

type ServerContextUsageBreakdown = {
  systemPromptTokens?: number
  messagesTokens?: number
  toolsTokens?: number
  skillsTokens?: number
  mcpTokens?: number
  providerUsageTokens?: number
  trailingTokens?: number
}

type ServerContextUsageInfo = {
  contextWindow?: number
  inputTokens?: number
  inputTokenSource?: 'provider' | 'unavailable'
  isCompacted?: boolean
  compactedUpToIndex?: number
  originalMessageCount?: number
  effectiveMessageCount?: number
  breakdown?: ServerContextUsageBreakdown
}

type ContextUsageTipData = {
  usage: ContextUsageInfo
  contextWindow: number
  stale: boolean
  compacted: boolean
}

type ContextUsageOptions = {
  panel: HTMLElement
  getContextWindow: () => number
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
  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0)
  // 当前模型窗口优先：切换模型后上报负载里还带着旧模型的窗口，直接用它会把
  // 上一次请求的 token 数按旧窗口算成比例。
  const displayWindow = Math.max(0, Number(contextWindow) || Number(usage.contextWindow) || 0)
  const percent = displayWindow > 0 ? Math.round((inputTokens / displayWindow) * 1000) / 10 : 0
  // 唯一判定口径：有数值且没有被明确标成未知，才算「有上报值」。旧负载缺来源
  // 字段时按数值判断，避免把 0 当成一次有效上报。
  const inputTokenSource: ContextUsageInfo['inputTokenSource'] =
    usage.inputTokenSource === 'unavailable' || inputTokens <= 0 ? 'unavailable' : 'provider'
  return {
    contextWindow: displayWindow,
    inputTokens,
    inputTokenSource,
    percent,
    color: usageColor(percent),
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

export function contextUsageBreakdownRows(breakdown?: ServerContextUsageBreakdown): Array<[string, string]> {
  return [
    [t('contextUsageSystemPromptLabel'), formatOptionalTokens(breakdown?.systemPromptTokens)],
    [t('contextUsageToolsSchemaLabel'), formatOptionalTokens(breakdown?.toolsTokens)],
    [t('contextUsageMessagesLabel'), formatOptionalTokens(breakdown?.messagesTokens)],
    [t('contextUsageSkillsLabel'), formatOptionalTokens(breakdown?.skillsTokens)],
    [t('contextUsageMcpLabel'), formatOptionalTokens(breakdown?.mcpTokens)],
  ].filter((row): row is [string, string] => Boolean(row[1]))
}

function buildContextUsageTitle({ usage, compacted, stale = false }: {
  usage: ContextUsageInfo
  compacted: boolean
  stale?: boolean
}) {
  const contextWindow = usage.contextWindow
  const lines = [
    t('contextUsageUsed', {
      percent: usage.percent,
      used: formatTokens(usage.inputTokens),
      limit: formatTokens(contextWindow),
    }),
    // 显示的数值一定来自提供商上报（没有上报就不渲染指示器），所以来源固定。
    t('contextUsageInput', { tokens: formatTokens(usage.inputTokens), source: t('contextUsageSourceProvider') }),
  ]
  if (stale) lines.push(t('contextUsageStaleNote'))
  const breakdown = usage.breakdown
  if (breakdown) {
    if (breakdown.providerUsageTokens || breakdown.trailingTokens) {
      lines.push(
        t('contextUsageProviderBaseline', { tokens: formatOptionalTokens(breakdown.providerUsageTokens) ?? '0' }),
        t('contextUsageTrailingMessages', { tokens: formatOptionalTokens(breakdown.trailingTokens) ?? '0' }),
      )
    }
    // 下面几行是本地估算的拆分，和上面的提供商口径总量不是同一套数字，单独标出来。
    lines.push(
      t('contextUsageLocalBreakdownTitle'),
      t('contextUsageSystemPrompt', { tokens: formatOptionalTokens(breakdown.systemPromptTokens) ?? '0' }),
      t('contextUsageToolsSchema', { tokens: formatOptionalTokens(breakdown.toolsTokens) ?? '0' }),
      t('contextUsageMessages', { tokens: formatOptionalTokens(breakdown.messagesTokens) ?? '0' }),
    )
  }
  lines.push(compacted ? t('contextUsageScopeCompacted') : t('contextUsageScopeFull'))
  if (compacted && usage.originalMessageCount !== undefined && usage.effectiveMessageCount !== undefined) {
    lines.push(t('contextUsageEffectiveMessages', {
      effective: usage.effectiveMessageCount,
      visible: usage.originalMessageCount,
    }))
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
  let positionFrame: number | null = null

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

  const cancelPositionFrame = () => {
    if (positionFrame === null) return
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(positionFrame)
    positionFrame = null
  }

  const removeTip = () => {
    cancelPositionFrame()
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
    const { usage, contextWindow, stale, compacted } = data
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

    // 只展示一行占用：数值与百分比同源，不再重复一行「总量」。
    const coreRows = document.createElement('div')
    coreRows.className = 'quickforge-context-usage-tip-section'
    addRow(coreRows, t('contextUsageInputLabel'), `${formatTokens(usage.inputTokens)} / ${formatTokens(contextWindow)}`)

    popover.append(header, coreRows)

    const breakdown = usage.breakdown
    // 提供商上报的用量基线 + 基线之后新增消息的估算，两者相加就是上面那一行总量。
    if (breakdown?.providerUsageTokens || breakdown?.trailingTokens) {
      const baseline = document.createElement('div')
      baseline.className = 'quickforge-context-usage-tip-section quickforge-context-usage-tip-details'
      addRow(baseline, t('contextUsageProviderBaseline'), formatOptionalTokens(breakdown.providerUsageTokens) ?? '0', true)
      addRow(baseline, t('contextUsageTrailingMessages'), formatOptionalTokens(breakdown.trailingTokens) ?? '0', true)
      popover.append(baseline)
    }

    const breakdownRows = contextUsageBreakdownRows(breakdown)
    if (breakdownRows.length > 0) {
      const details = document.createElement('div')
      details.className = 'quickforge-context-usage-tip-section quickforge-context-usage-tip-details'
      const detailsTitle = document.createElement('div')
      detailsTitle.className = 'quickforge-context-usage-tip-section-title'
      detailsTitle.textContent = t('contextUsageLocalBreakdownTitle')
      details.append(detailsTitle)
      for (const [label, value] of breakdownRows) addRow(details, label, value, true)
      popover.append(details)
    }

    const meta = document.createElement('div')
    meta.className = 'quickforge-context-usage-tip-meta'
    // 来源只有 provider 一种（没有上报就不渲染），meta 行不必再重复来源，只报时效与统计范围。
    const scope = compacted ? t('contextUsageScopeCompactedShort') : t('contextUsageScopeFullShort')
    meta.textContent = stale ? `${t('contextUsageStaleShort')} · ${scope}` : scope
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
    if (!tip) return
    // Window scroll fires once per frame already, but resize and capture-phase
    // scroll can both land in the same frame; measure once, in the frame.
    if (typeof window.requestAnimationFrame !== 'function') {
      positionTip()
      return
    }
    if (positionFrame !== null) return
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = null
      positionTip()
    })
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

export function createContextUsageIndicator({ panel, getContextWindow, getServerContextUsage, getIsCompacted, getGitBranch, onGitBranchClick, renderInline = true, renderModelRing = false, onDisplayChange }: ContextUsageOptions) {
  const tipController = createContextUsageTipController()
  let previousDisplayInfo: ContextUsageDisplayInfo | undefined

  // 只认服务端上报的用量：没有新数字时沿用上一次（并标注时效），一次都没有过就不显示。
  let lastKnownServerUsage: ServerContextUsageInfo | null = null

  const notifyDisplayChange = (displayInfo: ContextUsageDisplayInfo) => {
    if (isSameContextUsageDisplayInfo(previousDisplayInfo, displayInfo)) return
    previousDisplayInfo = displayInfo
    onDisplayChange?.(displayInfo)
  }

  const update = () => {
    const contextWindow = getContextWindow()
    const serverUsage = getServerContextUsage?.()
    const existing = panel.querySelector<HTMLElement>('.quickforge-context-usage')
    const existingSlot = panel.querySelector<HTMLElement>('.quickforge-context-usage-slot')
    const existingLabel = panel.querySelector<HTMLElement>('.quickforge-context-usage-label')
    const removeContextUsageVisual = () => {
      existingSlot?.remove()
      if (!existingSlot) existing?.remove()
    }
    const existingGitBranch = panel.querySelector<HTMLElement>('.quickforge-git-branch-inline')
    const statsRight = renderInline
      ? panel.querySelector('.qf-message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
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
      if (!renderModelRing) removeContextUsageVisual()
    } else if (gitBranch && statsRight) {
      const gitBranchLabel = `${gitBranchIcon}<span style="max-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(gitBranch)}</span>`
      const gitBranchTitle = t('gitBranchLabel', { branch: gitBranch })
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
      removeContextUsageVisual()
      existingLabel?.remove()
      notifyDisplayChange(displayInfo)
      return displayInfo
    }

    // 只认 provider 上报值：一次都没上报过就不渲染；本轮没有新上报时沿用上一条
    // 负载（按当前模型窗口重新换算比例），并标注数值来自上一次请求。
    const freshUsage = serverUsage ? normalizeServerContextUsage(serverUsage, contextWindow) : null
    const hasServerUsage = freshUsage?.inputTokenSource === 'provider'
    if (hasServerUsage) lastKnownServerUsage = serverUsage ?? null
    const usage = hasServerUsage
      ? freshUsage
      : lastKnownServerUsage
        ? normalizeServerContextUsage(lastKnownServerUsage, contextWindow)
        : null

    if (!usage) {
      tipController.close()
      removeContextUsageVisual()
      existingLabel?.remove()
      notifyDisplayChange(displayInfo)
      return displayInfo
    }

    const displayContextWindow = usage.contextWindow
    const isCompacted = Boolean(usage.isCompacted) || Boolean(getIsCompacted?.())
    const title = buildContextUsageTitle({
      usage,
      compacted: isCompacted,
      stale: !hasServerUsage,
    })
    displayInfo.context = {
      percent: usage.percent,
      color: usage.color,
      label: `${usage.percent}% · ${formatTokens(usage.inputTokens)} / ${formatTokens(displayContextWindow)} tokens`,
      title,
    }
    notifyDisplayChange(displayInfo)

    if (!renderInline && !renderModelRing) {
      removeContextUsageVisual()
      existingLabel?.remove()
      return displayInfo
    }

    if (renderModelRing && (!modelButton || !modelControls)) {
      removeContextUsageVisual()
      existingLabel?.remove()
      return displayInfo
    }

    if (!renderModelRing && !statsRight) {
      removeContextUsageVisual()
      existingLabel?.remove()
      return displayInfo
    }

    if (!renderModelRing) existingSlot?.remove()

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
      const slot = existingSlot ?? document.createElement('span')
      slot.className = 'quickforge-context-usage-slot'
      if (slot.parentElement !== modelControls || slot.nextElementSibling !== modelButton) {
        modelControls.insertBefore(slot, modelButton)
      }
      if (icon.parentElement !== slot) slot.append(icon)
      tipController.bind(icon, {
        usage,
        contextWindow: displayContextWindow,
        stale: !hasServerUsage,
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
