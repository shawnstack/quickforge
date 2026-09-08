import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// WorkspaceInspector/InlineDiffPreview 是依赖 Monaco/i18n 浏览器链路的 React 组件，
// 这里按 assistant-artifact-card.test.ts 的源码契约风格断言（不做 DOM 挂载）。
const inspector = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const changesList = readFileSync(new URL('../../src/components/workspace/WorkspaceChangesList.tsx', import.meta.url), 'utf8')
const diffPreview = readFileSync(new URL('../../src/components/workspace/WorkspaceInlineDiffPreview.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../src/components/workspace/workspace-api.ts', import.meta.url), 'utf8')
const tabs = readFileSync(new URL('../../src/components/workspace/workspace-inspector-tabs.ts', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

describe('workspace diff 404 no-working-tree-changes empty state', () => {
  it('attaches the HTTP status to errors thrown by the workspace api', () => {
    // fetchJson 与 postJson 抛错时都附加 response.status，供上层按状态码分支。
    expect(api).toContain('export type WorkspaceApiError = Error & { status?: number }')
    expect((api.match(/error\.status = response\.status/g) ?? []).length).toBe(2)
  })

  it('maps the file-diff 404 to a noChanges reader tab instead of an error', () => {
    // 服务端固定 message（server/routes/workspace.mjs 的 404 分支）。
    expect(inspector).toContain("err.message === 'File has no working tree changes'")
    // ReaderTab 携带 noChanges 标记。
    expect(tabs).toContain('noChanges?: boolean')
    // openDiffTab：404 → noChanges:true 且 error 清空；成功时 noChanges 复位。
    expect(inspector).toContain('{ ...item, loading: false, error: undefined, noChanges: true }')
    expect(inspector).toContain('{ ...item, diff, loading: false, error: undefined, noChanges: undefined }')
    // 其他错误仍显示 err.message / 兜底文案，并清掉 noChanges。
    expect(inspector).toContain("error: err instanceof Error ? err.message : t('workspaceOpenDiffFailed'), noChanges: undefined")
  })

  it('renders the localized empty state with a view-current-file fallback in the reader', () => {
    expect(inspector).toContain('noChanges?: boolean')
    expect(inspector).toContain('onOpenCurrentFile?: () => void')
    expect(inspector).toContain("t('workspaceFileNoWorkingTreeChanges')")
    expect(inspector).toContain("t('workspaceOpenCurrentFile')")
    // 空态置于 error 分支之前，且仅在非 loading 时显示。
    expect(inspector).toMatch(/\{!loading && noChanges \?/)
    // 调用点：noChanges 时提供降级打开当前文件的回调。
    expect(inspector).toContain('noChanges={activeReaderTab.noChanges}')
    expect(inspector).toMatch(/onOpenCurrentFile=\{activeReaderTab\.noChanges \? \(\) => \{ void openFileTabRef\.current\?\.\(activeReaderTab\.path\) \} : undefined\}/)
  })

  it('flows the inline review path through toggleReviewDiff and the changes list', () => {
    // Review 面板内联展开：404 时清 error、置 noChanges；成功与其他错误复位。
    expect(inspector).toContain('expandedDiffNoChanges')
    expect(inspector).toMatch(/setExpandedDiffError\(undefined\)[\s\S]*?setExpandedDiffNoChanges\(true\)/)
    expect(inspector).toContain('expandedNoChanges={expandedDiffNoChanges}')
    // WorkspaceChangesList 透传给 WorkspaceInlineDiffPreview。
    expect(changesList).toContain('expandedNoChanges?: boolean')
    expect(changesList).toContain('noChanges={expandedNoChanges}')
    // 预览组件在 error 分支前渲染本地化空态（不放按钮，列表行已有打开入口）。
    expect(diffPreview).toContain('noChanges?: boolean')
    expect(diffPreview).toMatch(/if \(noChanges\) \{/)
    expect(diffPreview).toContain("t('workspaceFileNoWorkingTreeChanges')")
  })

  it('carries the paired i18n keys in both locales', () => {
    for (const key of ['workspaceFileNoWorkingTreeChanges', 'workspaceOpenCurrentFile']) {
      expect((i18n.match(new RegExp(`${key}:`, 'g')) ?? []).length).toBe(2)
    }
    expect(i18n).toContain("workspaceFileNoWorkingTreeChanges: 'This file has no working tree changes. It may have been committed or restored.'")
    expect(i18n).toContain("workspaceFileNoWorkingTreeChanges: '该文件当前没有工作区变更，可能已提交或还原。'")
    expect(i18n).toContain("workspaceOpenCurrentFile: 'View current file'")
    expect(i18n).toContain("workspaceOpenCurrentFile: '查看文件当前内容'")
  })
})
