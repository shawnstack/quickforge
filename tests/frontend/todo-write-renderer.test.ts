import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTodoWriteHistoryViewModel } from '../../src/lib/todo-write-history'

const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status })

function classBlock(name: string, nextName: string) {
  const start = source.indexOf(`class ${name}`)
  const end = source.indexOf(`class ${nextName}`, start + 1)
  if (start < 0 || end < 0) throw new Error(`Renderer block ${name} not found`)
  return source.slice(start, end)
}

describe('TodoWrite history view model', () => {
  it('reports running and error without claiming a pinned-summary sync', () => {
    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      params: { todos: [todo('Stale input', 'completed')] },
      isStreaming: true,
    })).toEqual({ status: 'running', summaryKey: 'todoWriteHistoryRunning', snapshot: null })

    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      params: { todos: [todo('Stale input', 'completed')] },
      result: { isError: true, details: { todos: [todo('Not applied', 'completed')] } },
    })).toEqual({ status: 'error', summaryKey: 'todoWriteHistoryFailed', snapshot: null })
  })

  it('uses only the successful QuickForge result details as the applied snapshot', () => {
    const applied = [todo('Applied', 'completed'), todo('Next', 'pending')]
    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      params: { todos: [todo('Requested only', 'completed')] },
      result: { details: { todos: applied } },
    })).toEqual({
      status: 'done',
      summaryKey: 'todoWriteHistorySummary',
      summaryParams: { completed: 1, total: 2 },
      snapshot: applied,
    })
  })

  it('distinguishes a successful clear from invalid or absent snapshots', () => {
    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      result: { details: { todos: [] } },
    })).toEqual({ status: 'done', summaryKey: 'todoWriteHistoryCleared', snapshot: [] })

    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      params: { todos: [todo('Must not count', 'completed')] },
      result: { details: { todos: [{ content: '', status: 'completed' }] } },
    })).toEqual({ status: 'done', summaryKey: 'todoWriteHistoryNeutral', snapshot: null })

    expect(buildTodoWriteHistoryViewModel({
      source: 'quickforge',
      params: { todos: [todo('Called only', 'pending')] },
    })).toEqual({ status: 'called', summaryKey: 'todoWriteHistoryNeutral', snapshot: null })
  })

  it('uses successful OpenCode params/rawInput todos but not streaming or missing results', () => {
    const topLevel = [todo('Top level', 'completed')]
    expect(buildTodoWriteHistoryViewModel({
      source: 'opencode',
      params: { todos: topLevel, rawInput: { todos: [todo('Fallback', 'pending')] } },
      result: { details: {} },
    })).toEqual({
      status: 'done',
      summaryKey: 'todoWriteHistorySummary',
      summaryParams: { completed: 1, total: 1 },
      snapshot: topLevel,
    })

    const rawInput = [todo('Raw input', 'in_progress')]
    expect(buildTodoWriteHistoryViewModel({
      source: 'opencode',
      params: { rawInput: { todos: rawInput } },
      result: { details: {} },
    }).snapshot).toEqual(rawInput)

    expect(buildTodoWriteHistoryViewModel({
      source: 'opencode',
      params: { todos: topLevel },
      result: { details: {} },
      isStreaming: true,
    }).summaryKey).toBe('todoWriteHistoryRunning')
    expect(buildTodoWriteHistoryViewModel({ source: 'opencode', params: { todos: topLevel } }).summaryKey)
      .toBe('todoWriteHistoryNeutral')
  })
})

describe('TodoWrite history renderer', () => {
  it('registers the native todo_write renderer and keeps history summary-only outside detailed mode', () => {
    const block = classBlock('TodoWriteToolRenderer', 'OpenCodeToolRenderer')
    expect(source).toContain("registerToolRenderer('todo_write', todoWriteToolRenderer)")
    expect(block).toContain("toolDisplaySettings.toolDisplayMode === 'detailed'")
    expect(block).toContain('buildTodoWriteHistoryViewModel')
    expect(block).toContain('renderStatus(status, timing)')
    expect(block).toContain('language="json"')
    expect(block).not.toContain('quickforge-todo-summary-list')
  })

  it('delegates only OpenCode todowrite metadata with OpenCode snapshot semantics', () => {
    const block = classBlock('OpenCodeToolRenderer', 'McpToolRenderer')
    expect(block).toContain('if (isTodoWriteAcpMetadata(metadataFromParams) || isTodoWriteAcpMetadata(metadataFromDetails))')
    expect(block).toContain("return todoWriteToolRenderer.render(params, result, isStreaming, 'opencode')")
    expect(block).toContain('quickforge-opencode-tool-shell')
    expect(block).toContain('OpenCode')
  })

  it('adds every bilingual audit-summary state', () => {
    for (const key of [
      'todoWriteHistoryRunning',
      'todoWriteHistoryFailed',
      'todoWriteHistorySummary',
      'todoWriteHistoryCleared',
      'todoWriteHistoryNeutral',
    ]) {
      expect(i18n.match(new RegExp(`${key}:`, 'g'))?.length).toBe(2)
    }
    expect(i18n).toContain("todoWriteHistoryRunning: 'Updating task list'")
    expect(i18n).toContain("todoWriteHistoryFailed: 'Task list update failed'")
    expect(i18n).toContain("todoWriteHistorySummary: 'Updated task list · {completed}/{total} completed'")
    expect(i18n).toContain("todoWriteHistoryCleared: 'Task list cleared'")
    expect(i18n).toContain("todoWriteHistoryNeutral: 'Task list update'")
    expect(i18n).toContain("todoWriteHistoryRunning: '正在更新任务清单'")
    expect(i18n).toContain("todoWriteHistoryFailed: '任务清单更新失败'")
    expect(i18n).toContain("todoWriteHistorySummary: '更新任务清单 · {completed}/{total} 已完成'")
    expect(i18n).toContain("todoWriteHistoryCleared: '已清空任务清单'")
    expect(i18n).toContain("todoWriteHistoryNeutral: '任务清单更新'")
  })

  it('uses a normal-flow composer layout with bounded scrolling, focus, responsive, and reduced-motion handling', () => {
    const block = css.slice(css.indexOf('/* TodoWrite task summary'), css.indexOf('/* Desktop pinned summary'))
    expect(css).toMatch(/\.quickforge-composer-shell\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/)
    expect(block).toMatch(/\.quickforge-todo-summary\s*\{[\s\S]*?width:\s*100%;[\s\S]*?flex:\s*none;/)
    expect(block).toMatch(/\.quickforge-todo-summary-list\s*\{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/)
    expect(block).not.toMatch(/position:\s*(?:sticky|fixed|absolute)/)
    expect(block).not.toMatch(/\btop\s*:|\bz-index\s*:|backdrop-filter/)
    expect(css).toContain('.quickforge-todo-summary-toggle:focus-visible')
    expect(css).toContain('@media (max-width: 640px)')
    expect(block).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.quickforge-todo-summary-list\s*\{[\s\S]*?max-height:/)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(block).not.toMatch(/linear-gradient|radial-gradient/)
  })

  it('colors completed checks with the shared emerald tone in both themes', () => {
    const block = css.slice(css.indexOf('/* TodoWrite task summary'))
    expect(block).toMatch(/\.quickforge-todo-summary-ring-check\s*\{[\s\S]*?color:\s*rgb\(4 143 101\)/)
    expect(block).toMatch(/html\.dark \.quickforge-todo-summary-ring-check\s*\{[\s\S]*?color:\s*rgb\(110 231 183\)/)
    expect(block).toMatch(/\.quickforge-todo-summary\[data-complete="true"\][\s\S]*?\.quickforge-todo-summary-ring-check\s*\{\s*opacity:\s*1/)
    expect(block).toMatch(/\.quickforge-todo-summary-item--completed \.quickforge-todo-summary-status-icon\s*\{[\s\S]*?color:\s*rgb\(4 143 101\)/)
    expect(block).toMatch(/html\.dark \.quickforge-todo-summary-item--completed \.quickforge-todo-summary-status-icon\s*\{[\s\S]*?color:\s*rgb\(110 231 183\)/)
  })

  it('updates the TodoWrite summary only after decorateEditor finishes', () => {
    const decorateBlock = host.slice(host.indexOf('const decorate = () =>'), host.indexOf('// Render or remove approval card'))
    const editorIndex = decorateBlock.indexOf('decorateEditor({')
    const updateIndex = decorateBlock.indexOf('todoWriteSummary.update()')
    expect(editorIndex).toBeGreaterThanOrEqual(0)
    expect(updateIndex).toBeGreaterThan(editorIndex)
    expect(decorateBlock.slice(editorIndex, updateIndex)).toContain('} catch { /* continue to todo summary */ }')
    expect(decorateBlock.slice(updateIndex)).toContain("logger.warn('Failed to update TodoWrite summary:'")
  })
})
