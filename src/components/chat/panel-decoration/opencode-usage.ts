/**
 * OpenCode Harness usage badge (P1).
 *
 * Renders an independent, read-only usage badge in the composer stats area for
 * OpenCode sessions. It shows the ACP `usage_update` snapshot (used/size and
 * cost when available) and is intentionally separate from the QuickForge
 * `contextUsage` token estimation. The badge is absent when no usage data has
 * been advertised.
 */

import { t } from '@/lib/i18n'
import type { OpenCodeAcpSession, OpenCodeAcpUsage } from '@/lib/server-agent'

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type OpenCodeUsageOptions = {
  panel: HTMLElement
  getAcpSession: () => OpenCodeAcpSession | null | undefined
}

function formatCount(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(Math.round(value))
}

function usageTitle(usage: OpenCodeAcpUsage): string {
  const lines = [t('openCodeUsageTokensTitle', { used: formatCount(usage.used) || '0', size: formatCount(usage.size) || '0' })]
  if (usage.cost && Number.isFinite(usage.cost.amount)) {
    lines.push(t('openCodeUsageCostTitle', { amount: usage.cost.amount, currency: usage.cost.currency }))
  }
  return lines.join('\n')
}

function usageLabel(usage: OpenCodeAcpUsage): string {
  const tokens = `${formatCount(usage.used)} / ${formatCount(usage.size)} tokens`
  if (usage.cost && Number.isFinite(usage.cost.amount)) {
    return `${tokens} · ${usage.cost.amount} ${usage.cost.currency}`
  }
  return tokens
}

export function createOpenCodeUsageIndicator({ panel, getAcpSession }: OpenCodeUsageOptions) {
  const update = () => {
    const usage = getAcpSession()?.usage ?? null
    const existing = panel.querySelector<HTMLElement>('.quickforge-opencode-usage-inline')
    const statsRight = panel.querySelector('message-editor')?.parentElement?.querySelector<HTMLElement>('.ml-auto.items-center')
    if (!usage || !statsRight) {
      existing?.remove()
      return
    }

    const title = usageTitle(usage)
    const label = usageLabel(usage)
    if (existing) {
      if (existing.dataset.quickforgeOpenCodeUsage === label) return
      existing.dataset.quickforgeOpenCodeUsage = label
      existing.innerHTML = `<span class="quickforge-opencode-usage-text">${escapeHtml(label)}</span>`
      existing.title = title
      existing.setAttribute('aria-label', title)
      return
    }

    const badge = document.createElement('span')
    badge.className = 'quickforge-opencode-usage-inline'
    badge.dataset.quickforgeOpenCodeUsage = label
    badge.title = title
    badge.setAttribute('aria-label', title)
    badge.innerHTML = `<span class="quickforge-opencode-usage-text">${escapeHtml(label)}</span>`
    statsRight.prepend(badge)
  }

  return { update, cleanup: () => {} }
}
