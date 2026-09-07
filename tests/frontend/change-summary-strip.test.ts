import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 会话代码变更摘要条：源码契约测试（与 git-tools-pinned-summary 等同模式）。

const controllerSource = readFileSync('src/components/chat/panel-decoration/change-summary-strip.ts', 'utf8')
const hostSource = readFileSync('src/components/chat/ChatPanelHost.tsx', 'utf8')
const appSource = readFileSync('src/App.tsx', 'utf8')
const cssSource = readFileSync('src/index.css', 'utf8')
const i18nSource = readFileSync('src/lib/i18n.ts', 'utf8')

describe('change summary strip controller', () => {
  it('anchors above the composer dock with idempotent re-insertion', () => {
    expect(controllerSource).toContain("panel.querySelector<HTMLElement>('message-editor')")
    expect(controllerSource).toContain('editor.parentElement?.parentElement ?? editor')
    expect(controllerSource).toContain('anchor.before(strip)')
    expect(controllerSource).toContain('strip.nextElementSibling !== anchor')
  })

  it('removes the strip when the session has no file changes', () => {
    expect(controllerSource).toContain('summary.files.length === 0')
    expect(controllerSource).toContain('removeStrip()')
  })

  it('fetches the session-scoped summary and posts the session-scoped rollback endpoint', () => {
    expect(controllerSource).toContain('`/api/agents/${encodeURIComponent(sessionId)}/file-changes`')
    expect(controllerSource).toContain('`/api/agents/${encodeURIComponent(sessionId)}/rollback-files`')
    expect(controllerSource).toContain("method: 'POST'")
  })

  it('uses a two-step rollback confirm and disables while streaming', () => {
    expect(controllerSource).toContain('confirmArmed')
    expect(controllerSource).toContain("t('changeSummaryRollbackConfirm')")
    expect(controllerSource).toContain('rollbackBtn.disabled = deps.isStreaming() || rolling')
    expect(controllerSource).toContain("t('changeSummaryRollbackStreaming')")
  })

  it('offers preview for artifact-previewable files via the shared artifact preview routing', () => {
    expect(controllerSource).toContain("import { artifactPreviewMode } from '@/components/workspace/artifact-preview-utils'")
    expect(controllerSource).toContain('artifactPreviewMode(file.relativePath) && deps.onOpenFilePreview')
    expect(controllerSource).not.toContain('isHtmlPath')
    expect(controllerSource).toContain("t('changeSummaryPreview')")
  })

  it('refreshes when the write/edit tool result signature changes', () => {
    expect(controllerSource).toContain("message.toolName === 'write_file' || message.toolName === 'edit_file'")
    expect(controllerSource).toContain('writeEditSignature')
  })
})

describe('change summary strip wiring', () => {
  it('is created in ChatPanelHost only outside side chat and read-only modes', () => {
    expect(hostSource).toContain('sideChatMode || readOnly')
    expect(hostSource).toContain('? null\n      : createChangeSummaryStripController')
    expect(hostSource).toContain('changeSummaryStrip?.sync()')
    expect(hostSource).toContain('changeSummaryStrip?.destroy()')
    expect(hostSource).toContain('getSessionId: () => agent.sessionId')
    expect(hostSource).toContain('propsRef.current.onOpenFilePreview?.(relativePath)')
  })

  it('App routes the preview callback through the shared openArtifactPreview entry', () => {
    expect(appSource).toContain('openFilePreviewFromChangeSummary')
    expect(appSource).toContain('openArtifactPreview(projectId, relativePath)')
    expect(appSource).toContain('onOpenFilePreview={openFilePreviewFromChangeSummary}')
    // 不再旁路自拼预览 URL：browser 分流由 openArtifactPreview + WebPreviewContent 归一化处理。
    expect(appSource).not.toContain('workspacePreviewUrl(projectId, relativePath)')
  })

  it('exposes css for the strip and green/red line stats', () => {
    expect(cssSource).toContain('.quickforge-change-summary-strip')
    expect(cssSource).toContain('.quickforge-change-summary-added')
    expect(cssSource).toContain('.quickforge-change-summary-removed')
    expect(cssSource).toContain('html.dark .quickforge-change-summary-added')
    expect(cssSource).toContain('html.dark .quickforge-change-summary-removed')
  })

  it('defines paired i18n keys in both languages', () => {
    for (const key of [
      'changeSummaryTitle',
      'changeSummaryFiles',
      'changeSummaryRollback',
      'changeSummaryRollbackConfirm',
      'changeSummaryCancel',
      'changeSummaryRollbackStreaming',
      'changeSummaryPreview',
    ]) {
      const matches = i18nSource.match(new RegExp(`${key}:`, 'g'))
      expect(matches?.length, key).toBe(2)
    }
  })
})
