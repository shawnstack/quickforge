import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))
import { FileRollbackDialogContent, TurnRollbackDialogContent } from '../../src/components/chat/FileRollbackDialog'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { createFileRollbackController, createTurnRollbackController, type FileRollbackState, type TurnRollbackState } from '../../src/components/chat/file-rollback-state'

const preview = {
  revision: 'r1', canRollback: true,
  files: [{ path: '/workspace/long/a.ts', relativePath: 'long/a.ts', revision: 'file-r1', action: 'restore' as const, safe: true, reason: '' }],
}
function render(state: FileRollbackState, language: 'zh' | 'en' = 'zh') {
  applyAppLanguageFromSnapshot(language)
  return renderToStaticMarkup(createElement(FileRollbackDialogContent, {
    state, titleId: 'title', descriptionId: 'description', onClose() {}, onPreview() {}, onConfirm() {}, onConfirmFile() {},
  }))
}

describe('dedicated file rollback dialog', () => {
  it('renders grouped paths with full titles, a row action and the existing batch action', () => {
    const html = render({ phase: 'ready', preview })
    expect(html).toContain('撤销文件改动')
    expect(html).toContain('可安全撤销 1')
    expect(html).toContain('不能安全撤销 0')
    expect(html).toContain('title="/workspace/long/a.ts"')
    expect(html).toContain('title="/workspace/long/a.ts">/workspace/long/a.ts</span>')
    expect(html).toContain('全部文件可安全撤销，执行前会再次检查。')
    expect(html).toContain('撤销前会重新检查当前文件内容；选中文件被外部修改时，会阻止本次操作。')
    expect(html).toContain('整批撤销要求全部文件安全；安全文件可单独撤销。')
    expect(html.match(/class="quickforge-file-rollback-single"/g)).toHaveLength(1)
    expect(html).not.toContain('事务原子性')
    expect(html).not.toContain('未写入任何文件')
    expect(html).toContain('恢复为会话修改前的内容')
    expect(html.match(/class="quickforge-file-rollback-confirm"/g)).toHaveLength(1)
    expect(html).not.toContain('disabled=""')
  })

  it('disables the entire mixed batch and explains unknown reasons conservatively', () => {
    const html = render({ phase: 'ready', preview: { ...preview, files: [...preview.files,
      { path: '/workspace/b', relativePath: 'b', action: 'delete', safe: false, reason: '<unexpected>' },
    ] } })
    expect(html).toContain('不能安全撤销 1')
    expect(html).toContain('无法确认安全性，不能撤销')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('unexpected')
    expect(html).toContain('存在不能安全撤销的文件，整批撤销已禁用；安全文件可单独撤销。')
    expect(html).toMatch(/class="quickforge-file-rollback-confirm" disabled=""/)
    expect(html).not.toMatch(/class="quickforge-file-rollback-single" disabled=""/)
    expect(html.match(/class="quickforge-file-rollback-single"/g)).toHaveLength(1)
    expect(html).not.toContain('全部文件可安全撤销')
  })

  it.each([
    ['external_modified', '文件已被会话外的操作修改'], ['missing_file', '当前文件已不存在'],
    ['backup_unavailable', '原始备份不可用'], ['legacy_backup', '旧版备份缺少安全校验记录'],
    ['incomplete_write', '会话写入记录不完整'], ['unsafe_path', '无法安全访问该路径'],
    ['unavailable', '无法确认安全性'], ['session_busy', '会话正在运行'], ['batch_changed', '文件批次已变化'],
  ])('explains the %s reason code', (reason, text) => {
    expect(render({ phase: 'ready', preview: { ...preview, files: [{ ...preview.files[0], safe: false, reason }] } })).toContain(text)
  })

  it('shows loading and preview-error feedback, with retry only when idle', () => {
    const loading = render({ phase: 'loading' })
    expect(loading).toContain('正在检查当前文件和备份')
    expect(loading).toContain('aria-busy="true"')
    expect(loading).not.toContain('quickforge-file-rollback-recheck')
    const error = render({ phase: 'preview-error' })
    expect(error).toContain('无法检查文件安全性')
    expect(error).toContain('quickforge-file-rollback-recheck')
  })

  it('never describes a failed/unknown execution as zero writes', () => {
    const failed = render({ phase: 'failed', preview, result: { status: 'failed', restored: 2, removedCreated: 1, errors: [{ path: 'b', message: 'IO' }], preview } })
    expect(failed).toContain('已恢复 2 个、已删除 1 个')
    expect(failed).toContain('其余备份已保留')
    const unknown = render({ phase: 'unconfirmed', preview })
    expect(unknown).toContain('结果尚未确认')
    expect(unknown).not.toContain('已恢复 0')
    for (const html of [failed, unknown]) {
      expect(html).toContain('disabled=""')
      expect(html).not.toContain('不会写入任何文件')
      expect(html).not.toContain('未写入任何文件')
      expect(html).not.toContain('撤销完成：')
    }
  })

  it.each(['failed', 'unconfirmed'] as const)('preserves %s feedback through failed and conflicting rechecks', async (outcome) => {
    const conflict = { ...preview, canRollback: false, files: [{ ...preview.files[0], safe: false, reason: 'external_modified' }] }
    const result = { status: 'failed' as const, restored: 2, removedCreated: 1, errors: [{ path: 'b', message: 'IO' }], preview }
    const client = {
      getFileRollbackPreview: vi.fn().mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(conflict),
      rollbackFiles: outcome === 'failed' ? vi.fn().mockResolvedValue(result) : vi.fn().mockRejectedValue(new Error('timeout')),
      rollbackFile: vi.fn(),
    }
    const states: FileRollbackState[] = []
    const controller = createFileRollbackController(client, (state) => states.push(state), vi.fn())
    await controller.preview()
    await controller.confirm()
    const start = states.length - 1
    await controller.preview()
    await controller.preview()
    expect(states.slice(start).map((state) => state.phase)).toEqual([outcome, 'loading', 'preview-error', 'loading', 'ready'])
    for (const state of states.slice(start)) {
      const html = render(state)
      expect(html).toContain(outcome === 'failed' ? '已恢复 2 个、已删除 1 个' : '结果尚未确认')
      expect(html).not.toContain('未写入任何文件')
      expect(html).not.toContain('撤销完成：')
      expect(html).toContain('disabled=""')
      if (state.phase !== 'loading') expect(html).toContain('quickforge-file-rollback-recheck')
    }
    controller.dispose()
  })

  it('does not infer zero writes from a fresh conflict after a blocked execution', () => {
    const conflict = { ...preview, canRollback: false, files: [{ ...preview.files[0], safe: false, reason: 'external_modified' }] }
    const html = render({ phase: 'ready', preview: conflict, result: { status: 'blocked', restored: 0, removedCreated: 0, errors: [], preview: conflict } })
    expect(html).not.toContain('未写入任何文件')
    expect(html).not.toContain('撤销未全部完成')
  })

  it('shows only success feedback after completion with an empty preview', () => {
    const empty = { ...preview, canRollback: false, files: [] }
    const html = render({ phase: 'completed', preview: empty, result: { status: 'completed', restored: 1, removedCreated: 0, errors: [], preview: empty } })
    expect(html).toContain('撤销完成：已恢复 1 个、已删除 0 个。')
    expect(html).not.toContain('撤销未全部完成')
    expect(html).not.toContain('整批禁止撤销')
    expect(html).not.toContain('未写入任何文件')
    expect(html).not.toContain('quickforge-file-rollback-recheck')
  })

  it('keeps English ready feedback concise and scoped to the initial check', () => {
    const safe = render({ phase: 'ready', preview }, 'en')
    expect(safe).toContain('All files are safe to undo and will be checked again before execution.')
    expect(safe).toContain('Current file contents will be checked again before undoing.')
    expect(safe).not.toContain('filesystem writes atomic')
    const conflict = { ...preview, canRollback: false, files: [{ ...preview.files[0], safe: false, reason: 'external_modified' }] }
    expect(render({ phase: 'ready', preview: conflict }, 'en')).toContain('Some files cannot be safely undone. The entire batch is disabled; safe files can be undone individually.')
    const unknown = render({ phase: 'ready', preview: conflict, outcomeUnconfirmed: true }, 'en')
    expect(unknown).toContain('The result is unconfirmed')
    expect(unknown).not.toContain('No files have been written')
  })

  it('disables safe row actions for global blockers and missing legacy revisions', () => {
    for (const restricted of [
      { ...preview, reason: 'session_busy' }, { ...preview, reason: 'backup_unavailable' },
      { ...preview, files: [{ ...preview.files[0], revision: undefined }] },
    ]) {
      const html = render({ phase: 'ready', preview: restricted })
      expect(html).toMatch(/class="quickforge-file-rollback-single" disabled=""/)
    }
  })

  it('renders partial success and the latest remaining list without failure or zero-write claims, including after recheck', () => {
    const remaining = { ...preview, canRollback: false, files: [
      { ...preview.files[0], path: '/workspace/remaining.ts' },
      { ...preview.files[0], path: '/workspace/unsafe.ts', safe: false, reason: 'external_modified' },
    ] }
    const result = { status: 'partial' as const, restored: 1, removedCreated: 0, errors: [], preview: remaining }
    for (const phase of ['partial', 'ready'] as const) {
      const html = render({ phase, preview: remaining, result })
      expect(html).toContain('部分已撤销：本次已恢复 1 个、已删除 0 个')
      expect(html).toContain('列表为剩余文件')
      expect(html).toContain('/workspace/remaining.ts')
      expect(html).not.toContain('/workspace/long/a.ts')
      expect(html).not.toContain('撤销未全部完成')
      expect(html).not.toContain('未写入任何文件')
      expect(html).not.toMatch(/class="quickforge-file-rollback-single" disabled=""/)
      expect(html).toMatch(/class="quickforge-file-rollback-confirm" disabled=""/)
    }
    expect(render({ phase: 'partial', preview: remaining, result }, 'en')).toContain('Partially undone: this operation restored 1, deleted 0.')
  })

  it('uses a native modal, safe initial focus, ESC close and synchronous lifetime cleanup', () => {
    const source = readFileSync(new URL('../../src/components/chat/FileRollbackDialog.tsx', import.meta.url), 'utf8')
    expect(source).toContain('dialog.showModal()')
    expect(source).toContain("dialog.querySelector<HTMLElement>('h2')?.focus()")
    expect(source).toContain('onCancel={(event) => { event.preventDefault(); close() }}')
    expect(source).toContain('controller.dispose()')
    expect(source).toContain('previousFocus?.isConnected')
    expect(source).toContain('useLayoutEffect')
    expect(source).toContain('export function TurnRollbackDialog')
  })
})

describe('turn rollback dialog', () => {
  const turnPreview = {
    revision: 'tr1', turnIds: ['turn-1', 'turn-1-retry'],
    files: [
      { path: '/workspace/long/a.ts', safe: true, reason: null, action: 'restore' as const, created: false },
      { path: '/workspace/created.ts', safe: true, reason: null, action: 'delete' as const, created: true },
      { path: '/workspace/blocked.ts', safe: false, reason: 'modified-after-turn', action: 'restore' as const },
    ],
  }
  const turnResult = {
    status: 'completed' as const,
    rolledBack: [
      { path: '/workspace/long/a.ts', action: 'restore' as const },
      { path: '/workspace/created.ts', action: 'delete' as const },
    ],
    conflicts: [],
  }

  function renderTurn(state: TurnRollbackState, language: 'zh' | 'en' = 'zh') {
    applyAppLanguageFromSnapshot(language)
    return renderToStaticMarkup(createElement(TurnRollbackDialogContent, {
      state, titleId: 'title', descriptionId: 'description', onClose() {}, onPreview() {}, onConfirm() {},
    }))
  }

  it('renders turn title, safe/unsafe groups and turn-scoped labels without single-file undo', () => {
    const html = renderTurn({ phase: 'ready', preview: turnPreview })
    expect(html.match(/<h2[^>]*>撤销本轮改动<\/h2>/)).toBeTruthy()
    expect(html).toContain('可安全撤销 2')
    expect(html).toContain('不能安全撤销 1')
    expect(html).toContain('恢复为本轮开始前的内容')
    expect(html).toContain('删除本轮新建的文件')
    expect(html).toContain('本轮之后被修改')
    // 轮级无单文件撤销入口；存在不安全文件时整轮禁用。
    expect(html).not.toContain('quickforge-file-rollback-single')
    expect(html).toMatch(/class="quickforge-file-rollback-confirm" disabled=""/)
    expect(html).toContain('本轮存在不能安全撤销的文件，本轮撤销已禁用。')
  })

  it.each([
    ['external-change', '被会话外的操作修改'],
    ['stale-backup', '本轮备份已过期'],
    ['<unexpected>', '无法确认安全性，不能撤销'],
  ] as const)('explains the turn %s reason conservatively', (reason, text) => {
    const html = renderTurn({ phase: 'ready', preview: {
      ...turnPreview,
      files: [{ path: '/workspace/x.ts', safe: false, reason, action: 'restore' }],
    } })
    expect(html).toContain(text)
    expect(html).not.toContain('unexpected')
  })

  it('renders the null reason as unverifiable safety', () => {
    const html = renderTurn({ phase: 'ready', preview: {
      ...turnPreview,
      files: [{ path: '/workspace/x.ts', safe: false, reason: null, action: 'restore' }],
    } })
    expect(html).toContain('无法确认安全性，不能撤销')
  })

  it('shows conflict feedback after a stale revision and requires a fresh check', () => {
    const html = renderTurn({ phase: 'conflict', preview: turnPreview })
    expect(html).toContain('本轮内容与预览时不同，请重新检查后再撤销。')
    expect(html).toMatch(/class="quickforge-file-rollback-confirm" disabled=""/)
    expect(html).toContain('quickforge-file-rollback-recheck')
  })

  it('reports partial counts and conflict paths without claiming completion', () => {
    const partial = {
      status: 'partial' as const,
      rolledBack: [{ path: '/workspace/long/a.ts', action: 'restore' as const }],
      conflicts: [{ path: '/workspace/blocked.ts', reason: 'modified-after-turn' }],
    }
    const html = renderTurn({ phase: 'partial', preview: turnPreview, result: partial })
    expect(html).toContain('部分已撤销：本次已恢复 1 个、已删除 0 个')
    expect(html).toContain('冲突文件已跳过')
    expect(html).toContain('/workspace/blocked.ts')
    expect(html).toContain('本轮之后被修改')
    expect(html).not.toContain('撤销完成')
    expect(html).toMatch(/class="quickforge-file-rollback-confirm" disabled=""/)
  })

  it('reports completion with restore/delete counts and hides the recheck button', () => {
    const html = renderTurn({ phase: 'completed', preview: turnPreview, result: turnResult })
    expect(html).toContain('撤销完成：已恢复 1 个、已删除 1 个。')
    expect(html).not.toContain('quickforge-file-rollback-recheck')
    expect(html).not.toContain('撤销未全部完成')
  })

  it('keeps English copy paired with the Chinese turn copy', () => {
    const blocked = renderTurn({ phase: 'ready', preview: turnPreview }, 'en')
    expect(blocked).toContain('Undo this turn')
    expect(blocked).toContain('Some files of this turn cannot be safely undone')
    expect(blocked).toContain('Changed after this turn')
    const conflict = renderTurn({ phase: 'conflict', preview: turnPreview }, 'en')
    expect(conflict).toContain('The turn changed since this preview was checked')
    const partial = renderTurn({
      phase: 'partial', preview: turnPreview,
      result: { status: 'partial', rolledBack: [{ path: '/workspace/long/a.ts', action: 'restore' }], conflicts: [] },
    }, 'en')
    expect(partial).toContain('Partially undone: this operation restored 1, deleted 0.')
    expect(partial).toContain('Conflicting files were skipped')
  })

  it('drives the turn dialog from the controller with the requested turnIds collection', async () => {
    const safePreview = { ...turnPreview, files: turnPreview.files.filter((file) => file.safe) }
    const client = {
      getTurnRollbackPreview: vi.fn().mockResolvedValue(safePreview),
      rollbackTurn: vi.fn().mockResolvedValue(turnResult),
    }
    const states: TurnRollbackState[] = []
    const success = vi.fn()
    const controller = createTurnRollbackController(client, ['turn-1', 'turn-1-retry'], (state) => states.push(state), success)
    await controller.preview()
    await controller.confirm()
    expect(client.getTurnRollbackPreview).toHaveBeenCalledWith(['turn-1', 'turn-1-retry'], expect.any(AbortSignal))
    expect(client.rollbackTurn).toHaveBeenCalledWith(['turn-1', 'turn-1-retry'], 'tr1', expect.any(AbortSignal))
    expect(states.at(-1)?.phase).toBe('completed')
    expect(success).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})
