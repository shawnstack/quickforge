import { t, type AppTextKey } from '@/lib/i18n'
import { isMobileShell, isRemoteQuickForgeClient } from '@/lib/mobile-server'
import {
  getSseConnectionState,
  requestSseReconnectNow,
  subscribeSseConnectionState,
  type SseConnectionStatus,
} from '@/lib/server-agent'

/**
 * Tier-2 persistent unreachable strip for the global agent SSE stream
 * (design-mockups/unreachable-notice.html · 方案 A).
 *
 * While the backend health probe stays failed the reconnect notice first
 * escalates to an amber inline row (Tier 1, reconnect-notice.ts); after
 * UNREACHABLE_STRIP_AFTER_MS the inline row hands over to this persistent
 * amber strip pinned above the composer so it stays visible regardless of
 * scroll position. Shows the outage duration, the retry countdown, a
 * 「立即重试」 button and an expandable recovery guide: just the action row
 * matching the detected runtime environment (desktop / mobile / CLI) plus
 * the server log path — kept to two rows on purpose.
 * Removed as soon as the connection recovers; survives Lit rebuilds via the
 * decorate-pass sync() (the controller remembers the expanded state).
 */

export const UNREACHABLE_STRIP_AFTER_MS = 30000

const STRIP_SELECTOR = '.quickforge-unreachable-strip'

const WARN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 19H3z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/></svg>'

export type UnreachableStripController = {
  /** Re-assert placement/state; call from the decorate pass. */
  sync: () => void
  /** Unsubscribe, clear timers and remove the strip from the DOM. */
  destroy: () => void
}

type HelpRowKey = 'cli' | 'desktop' | 'remote'

const HELP_TEXT_KEY: Record<HelpRowKey | 'logs', AppTextKey> = {
  cli: 'sseUnreachableHelpCli',
  desktop: 'sseUnreachableHelpDesktop',
  remote: 'sseUnreachableHelpRemote',
  logs: 'sseUnreachableHelpLogs',
}

function isDesktopApp(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

function isMobileEntry(): boolean {
  try {
    return isMobileShell() || isRemoteQuickForgeClient()
  } catch {
    // mobile-server 依赖不可用时退回移动 UA 判断。
    return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  }
}

/** 恢复指引：按运行环境只显示对应一条动作 + 日志行（不整列三种环境，保持精简）。 */
function helpRows(): Array<HelpRowKey | 'logs'> {
  const environment: HelpRowKey = isDesktopApp() ? 'desktop' : isMobileEntry() ? 'remote' : 'cli'
  return [environment, 'logs']
}

/** 断开时长展示：<60s → 「45s」；≥60s → 「1m 05s」。 */
function formatDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

type StripElements = {
  strip: HTMLElement
  title: HTMLElement
  sub: HTMLElement
}

export function createUnreachableStripController(deps: { panel: HTMLElement }): UnreachableStripController {
  const { panel } = deps
  let status: SseConnectionStatus | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let helpOpen = false
  let renderedEpisodeSince: number | undefined
  let disposed = false

  function findStrip(): HTMLElement | null {
    return panel.querySelector<HTMLElement>(STRIP_SELECTOR)
  }

  /** Composer 锚点：message-editor 外层 dock（decorateEditor 挂 .quickforge-composer-dock）。
   *  条插在 dock 之前，位于滚动容器外、任何滚动位置都可见。 */
  function stripAnchor(): HTMLElement | null {
    const editor = panel.querySelector<HTMLElement>('message-editor')
    if (!editor) return null
    return editor.parentElement?.parentElement ?? editor
  }

  function removeStrip() {
    findStrip()?.remove()
    renderedEpisodeSince = undefined
  }

  function stopTimer() {
    if (tickTimer !== null) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  }

  function buildHelpRow(key: HelpRowKey | 'logs'): HTMLElement {
    const row = document.createElement('span')
    row.className = 'quickforge-unreachable-strip-help-row'
    row.textContent = `· ${t(HELP_TEXT_KEY[key])}`
    return row
  }

  function buildStrip(): HTMLElement {
    const strip = document.createElement('div')
    strip.className = 'quickforge-unreachable-strip'
    strip.setAttribute('role', 'alert')

    const row = document.createElement('div')
    row.className = 'quickforge-unreachable-strip-row'

    const icon = document.createElement('span')
    icon.className = 'quickforge-reconnect-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = WARN_SVG

    const title = document.createElement('span')
    title.className = 'quickforge-unreachable-strip-title'

    const sub = document.createElement('span')
    sub.className = 'quickforge-unreachable-strip-sub'

    const spacer = document.createElement('span')
    spacer.className = 'quickforge-unreachable-strip-spacer'

    const retry = document.createElement('button')
    retry.className = 'quickforge-reconnect-retry'
    retry.setAttribute('type', 'button')
    retry.textContent = t('sseReconnectRetryNow')
    retry.addEventListener('click', () => {
      requestSseReconnectNow()
    })

    const toggle = document.createElement('button')
    toggle.className = 'quickforge-unreachable-help-toggle'
    toggle.setAttribute('type', 'button')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.textContent = `${t('sseUnreachableHelpToggle')} ⌄`
    toggle.addEventListener('click', () => {
      helpOpen = !helpOpen
      const help = strip.querySelector<HTMLElement>('.quickforge-unreachable-strip-help')
      help?.setAttribute('data-open', helpOpen ? 'true' : 'false')
      toggle.setAttribute('aria-expanded', helpOpen ? 'true' : 'false')
      toggle.textContent = `${t('sseUnreachableHelpToggle')} ${helpOpen ? '⌃' : '⌄'}`
    })

    row.append(icon, title, sub, spacer, retry, toggle)

    const help = document.createElement('div')
    help.className = 'quickforge-unreachable-strip-help'
    help.setAttribute('data-open', 'false')
    for (const key of helpRows()) help.append(buildHelpRow(key))

    strip.append(row, help)
    return strip
  }

  function ensureStrip(): StripElements | null {
    const anchor = stripAnchor()
    if (!anchor) return null
    let strip = findStrip()
    if (!strip) {
      strip = buildStrip()
      renderedEpisodeSince = undefined
    }
    // Lit 重建后重新插回 composer dock 之前；位置已正确时不移动（避免重启进入动画）。
    if (strip.parentElement !== anchor.parentElement || strip.nextElementSibling !== anchor) {
      anchor.before(strip)
    }
    const title = strip.querySelector<HTMLElement>('.quickforge-unreachable-strip-title')
    const sub = strip.querySelector<HTMLElement>('.quickforge-unreachable-strip-sub')
    if (!title || !sub) return null
    return { strip, title, sub }
  }

  function restoreHelpState(strip: HTMLElement) {
    const help = strip.querySelector<HTMLElement>('.quickforge-unreachable-strip-help')
    const toggle = strip.querySelector<HTMLElement>('.quickforge-unreachable-help-toggle')
    help?.setAttribute('data-open', helpOpen ? 'true' : 'false')
    toggle?.setAttribute('aria-expanded', helpOpen ? 'true' : 'false')
    if (toggle) toggle.textContent = `${t('sseUnreachableHelpToggle')} ${helpOpen ? '⌃' : '⌄'}`
  }

  function renderStrip(elements: StripElements, unreachableSince: number, nextRetryAt: number) {
    const { strip, title, sub } = elements
    // 新一轮不可达（unreachableSince 变化）→ 重排行序并复位展开记忆归属。
    if (renderedEpisodeSince !== unreachableSince) {
      const help = strip.querySelector<HTMLElement>('.quickforge-unreachable-strip-help')
      if (help) help.replaceChildren(...helpRows().map(buildHelpRow))
      renderedEpisodeSince = unreachableSince
    }
    restoreHelpState(strip)
    title.textContent = t('sseUnreachableStripTitle', { duration: formatDuration(Date.now() - unreachableSince) })
    const seconds = Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000))
    sub.textContent = t('sseUnreachableDetail', { seconds })
  }

  function update() {
    if (disposed) return
    const current = status
    if (current?.status !== 'reconnecting' || current.unreachable !== true || current.unreachableSince === undefined) {
      removeStrip()
      stopTimer()
      return
    }
    // 自持 1s tick：无新广播也要在阈值到点时自动出现。
    if (tickTimer === null) tickTimer = setInterval(update, 1000)
    const unreachableSince = current.unreachableSince
    if (Date.now() - unreachableSince < UNREACHABLE_STRIP_AFTER_MS) {
      removeStrip()
      return
    }
    const elements = ensureStrip()
    if (elements) renderStrip(elements, unreachableSince, current.nextRetryAt)
  }

  const unsubscribe = subscribeSseConnectionState((next) => {
    if (disposed) return
    status = next
    update()
  })
  status = getSseConnectionState()
  update()

  return {
    sync: () => {
      if (disposed) return
      const current = getSseConnectionState()
      if (current) status = current
      update()
    },
    destroy: () => {
      if (disposed) return
      disposed = true
      unsubscribe()
      stopTimer()
      removeStrip()
    },
  }
}
