import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { TurnRollbackDialogContent } from '../../src/components/chat/FileRollbackDialog'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { createTurnRollbackController, type TurnRollbackState } from '../../src/components/chat/file-rollback-state'

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
