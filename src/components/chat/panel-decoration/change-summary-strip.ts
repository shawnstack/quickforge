import { t } from '@/lib/i18n'
import { artifactPreviewMode } from '@/components/workspace/artifact-preview-utils'

/**
 * 会话级代码变更摘要条（server/session-file-backups.mjs 影子备份驱动）。
 *
 * Composer 上方常驻条：显示本会话 write_file/edit_file 修改的文件数与对账真实
 * +N/−N 行数（首次备份内容 vs 当前文件），可展开文件列表；可预览文件（html/图片/
 * markdown/代码/pdf/docx/excel，由 artifactPreviewMode 判定）带「预览」按钮，经
 * App 复用产物预览统一入口按类型分流 Reader/Document/Browser；「回滚」两步确认
 * 后把文件恢复到会话首次修改前状态。0 文件时整条移除；Side Chat / readOnly 不挂载。
 */

const STRIP_SELECTOR = '.quickforge-change-summary-strip'
const REFRESH_DEBOUNCE_MS = 800

const FILE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M10 13h4"/><path d="M10 17h4"/></svg>'

export type ChangeSummaryFile = {
  path: string
  relativePath: string
  created: boolean
  added: number
  removed: number
}

export type ChangeSummary = {
  files: ChangeSummaryFile[]
  totalAdded: number
  totalRemoved: number
}

export type ChangeSummaryStripController = {
  /** Re-assert placement; call from the decorate pass. */
  sync: () => void
  /** Remove the strip and release listeners. */
  destroy: () => void
}

type ChangeSummaryMessage = {
  role?: string
  toolName?: unknown
}

function writeEditSignature(messages: ChangeSummaryMessage[]): string {
  let count = 0
  for (const message of messages) {
    if (message?.role === 'toolResult' && (message.toolName === 'write_file' || message.toolName === 'edit_file')) count += 1
  }
  return `${messages.length}:${count}`
}

export function createChangeSummaryStripController(deps: {
  panel: HTMLElement
  getSessionId: () => string | undefined
  getMessages: () => ChangeSummaryMessage[]
  isStreaming: () => boolean
  onOpenFilePreview?: ((relativePath: string) => void) | null
}): ChangeSummaryStripController {
  const { panel } = deps
  let summary: ChangeSummary | null = null
  let expanded = false
  let confirmArmed = false
  let rolling = false
  let lastSignature: string | null = null
  let fetchInFlight = false
  let fetchTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function findStrip(): HTMLElement | null {
    return panel.querySelector<HTMLElement>(STRIP_SELECTOR)
  }

  /** Composer 锚点：与 unreachable-strip 相同的 message-editor 外层 dock。 */
  function stripAnchor(): HTMLElement | null {
    const editor = panel.querySelector<HTMLElement>('message-editor')
    if (!editor) return null
    return editor.parentElement?.parentElement ?? editor
  }

  function removeStrip() {
    findStrip()?.remove()
    confirmArmed = false
  }

  async function fetchSummary() {
    const sessionId = deps.getSessionId()
    if (!sessionId || disposed) return
    fetchInFlight = true
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/file-changes`, { cache: 'no-store' })
      if (!response.ok) return
      summary = (await response.json()) as ChangeSummary
      render()
    } catch {
      // 网络失败保留上次摘要，下轮 sync 重试
    } finally {
      fetchInFlight = false
    }
  }

  function scheduleFetch() {
    if (fetchTimer !== null || disposed) return
    fetchTimer = setTimeout(() => {
      fetchTimer = null
      void fetchSummary()
    }, REFRESH_DEBOUNCE_MS)
  }

  async function rollback() {
    const sessionId = deps.getSessionId()
    if (!sessionId || rolling) return
    rolling = true
    render()
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(sessionId)}/rollback-files`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await fetchSummary()
    } catch {
      // 失败回到未确认态，保留摘要供重试
    } finally {
      rolling = false
      confirmArmed = false
      render()
    }
  }

  function buildFileRow(file: ChangeSummaryFile): HTMLElement {
    const row = document.createElement('div')
    row.className = 'quickforge-change-summary-file'

    const name = document.createElement('span')
    name.className = 'quickforge-change-summary-file-name'
    name.textContent = file.relativePath
    name.title = file.relativePath
    row.append(name)

    const stats = document.createElement('span')
    stats.className = 'quickforge-change-summary-file-stats'
    if (file.added > 0) {
      const added = document.createElement('span')
      added.className = 'quickforge-change-summary-added'
      added.textContent = `+${file.added}`
      stats.append(added)
    }
    if (file.removed > 0) {
      const removed = document.createElement('span')
      removed.className = 'quickforge-change-summary-removed'
      removed.textContent = `−${file.removed}`
      stats.append(removed)
    }
    row.append(stats)

    // 预览与产物列表同源：artifactPreviewMode 支持的类型（html/图片/markdown/
    // 代码/pdf/docx/excel）显示按钮，分流由 App 的 openArtifactPreview 统一决定。
    if (artifactPreviewMode(file.relativePath) && deps.onOpenFilePreview) {
      const preview = document.createElement('button')
      preview.className = 'quickforge-change-summary-preview'
      preview.setAttribute('type', 'button')
      preview.textContent = t('changeSummaryPreview')
      preview.addEventListener('click', () => deps.onOpenFilePreview?.(file.relativePath))
      row.append(preview)
    }
    return row
  }

  function buildStrip(): HTMLElement {
    const strip = document.createElement('div')
    strip.className = 'quickforge-change-summary-strip'

    const row = document.createElement('div')
    row.className = 'quickforge-change-summary-row'

    const icon = document.createElement('span')
    icon.className = 'quickforge-change-summary-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = FILE_SVG

    const title = document.createElement('span')
    title.className = 'quickforge-change-summary-title'

    const stats = document.createElement('span')
    stats.className = 'quickforge-change-summary-file-stats'

    const spacer = document.createElement('span')
    spacer.className = 'quickforge-change-summary-spacer'

    const rollbackBtn = document.createElement('button')
    rollbackBtn.className = 'quickforge-change-summary-rollback'
    rollbackBtn.setAttribute('type', 'button')
    rollbackBtn.addEventListener('click', () => {
      if (deps.isStreaming() || rolling) return
      if (!confirmArmed) {
        confirmArmed = true
        render()
        return
      }
      void rollback()
    })

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'quickforge-change-summary-cancel'
    cancelBtn.setAttribute('type', 'button')
    cancelBtn.textContent = t('changeSummaryCancel')
    cancelBtn.addEventListener('click', () => {
      confirmArmed = false
      render()
    })

    const toggle = document.createElement('button')
    toggle.className = 'quickforge-change-summary-toggle'
    toggle.setAttribute('type', 'button')
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      expanded = !expanded
      render()
    })

    row.append(icon, title, stats, spacer, cancelBtn, rollbackBtn, toggle)
    strip.append(row)
    return strip
  }

  function ensureStrip(): HTMLElement | null {
    const anchor = stripAnchor()
    if (!anchor) return null
    let strip = findStrip()
    if (!strip) strip = buildStrip()
    // Lit 重建后重新插回 dock 之前；位置已正确时不移动。
    if (strip.parentElement !== anchor.parentElement || strip.nextElementSibling !== anchor) {
      anchor.before(strip)
    }
    return strip
  }

  function render() {
    if (disposed) return
    if (!summary || summary.files.length === 0) {
      removeStrip()
      return
    }
    const strip = ensureStrip()
    if (!strip) return

    const title = strip.querySelector<HTMLElement>('.quickforge-change-summary-title')
    if (title) title.textContent = t('changeSummaryTitle', { count: String(summary.files.length) })

    const stats = strip.querySelector<HTMLElement>('.quickforge-change-summary-file-stats')
    if (stats) {
      stats.replaceChildren()
      if (summary.totalAdded > 0) {
        const added = document.createElement('span')
        added.className = 'quickforge-change-summary-added'
        added.textContent = `+${summary.totalAdded}`
        stats.append(added)
      }
      if (summary.totalRemoved > 0) {
        const removed = document.createElement('span')
        removed.className = 'quickforge-change-summary-removed'
        removed.textContent = `−${summary.totalRemoved}`
        stats.append(removed)
      }
    }

    const rollbackBtn = strip.querySelector<HTMLButtonElement>('.quickforge-change-summary-rollback')
    if (rollbackBtn) {
      rollbackBtn.textContent = confirmArmed
        ? t('changeSummaryRollbackConfirm')
        : t('changeSummaryRollback')
      rollbackBtn.disabled = deps.isStreaming() || rolling
      rollbackBtn.title = deps.isStreaming() ? t('changeSummaryRollbackStreaming') : ''
    }

    const cancelBtn = strip.querySelector<HTMLButtonElement>('.quickforge-change-summary-cancel')
    if (cancelBtn) cancelBtn.style.display = confirmArmed ? '' : 'none'

    const toggle = strip.querySelector<HTMLButtonElement>('.quickforge-change-summary-toggle')
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
      toggle.textContent = `${t('changeSummaryFiles')} ${expanded ? '⌃' : '⌄'}`
    }

    let list = strip.querySelector<HTMLElement>('.quickforge-change-summary-files')
    if (expanded) {
      if (!list) {
        list = document.createElement('div')
        list.className = 'quickforge-change-summary-files'
        strip.append(list)
      }
      list.replaceChildren(...summary.files.map(buildFileRow))
    } else {
      list?.remove()
    }
  }

  return {
    sync: () => {
      if (disposed) return
      const signature = writeEditSignature(deps.getMessages() ?? [])
      if (signature !== lastSignature || !summary) {
        lastSignature = signature
        if (!fetchInFlight) scheduleFetch()
      }
      render()
    },
    destroy: () => {
      if (disposed) return
      disposed = true
      if (fetchTimer !== null) clearTimeout(fetchTimer)
      removeStrip()
    },
  }
}
