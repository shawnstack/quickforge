import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTodoWriteHistoryViewModel } from '../../src/lib/todo-write-history'

const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
// T4：TodoWriteToolRenderer 已迁至 tool-renderers/todo-write-tool-renderer.tsx（React）。
const todoWriteRenderer = readFileSync(new URL('../../src/lib/tool-renderers/todo-write-tool-renderer.tsx', import.meta.url), 'utf8')
const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status })

describe('TodoWrite history view model', () => {
  it('reports running and error without claiming a pinned-summary sync', () => {
    expect(buildTodoWriteHistoryViewModel({
      result: { details: { todos: [todo('Stale input', 'completed')] } },
      isStreaming: true,
    })).toEqual({ status: 'running', summaryKey: 'todoWriteHistoryRunning', snapshot: null })

    expect(buildTodoWriteHistoryViewModel({
      result: { isError: true, details: { todos: [todo('Not applied', 'completed')] } },
    })).toEqual({ status: 'error', summaryKey: 'todoWriteHistoryFailed', snapshot: null })
  })

  it('uses only the successful QuickForge result details as the applied snapshot', () => {
    const applied = [todo('Applied', 'completed'), todo('Next', 'pending')]
    expect(buildTodoWriteHistoryViewModel({
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
      result: { details: { todos: [] } },
    })).toEqual({ status: 'done', summaryKey: 'todoWriteHistoryCleared', snapshot: [] })

    expect(buildTodoWriteHistoryViewModel({
      result: { details: { todos: [{ content: '', status: 'completed' }] } },
    })).toEqual({ status: 'done', summaryKey: 'todoWriteHistoryNeutral', snapshot: null })

    expect(buildTodoWriteHistoryViewModel({})).toEqual({ status: 'called', summaryKey: 'todoWriteHistoryNeutral', snapshot: null })
  })
})

describe('TodoWrite history renderer', () => {
  it('registers the native todo_write renderer and keeps history summary-only outside detailed mode', () => {
    const block = todoWriteRenderer.slice(todoWriteRenderer.indexOf('export class TodoWriteToolRenderer'))
    expect(source).toContain("registerToolRenderer('todo_write', todoWriteToolRenderer)")
    expect(block).toContain('const detailed = toolDisplayDetailed()')
    expect(block).toContain('buildTodoWriteHistoryViewModel')
    expect(block).toContain('renderStatus(status, timing)')
    // detailed 模式附原始 input/details JSON（renderCodeBlock 的 language 参数）。
    expect(block).toContain("renderCodeBlock(input, 'json')")
    expect(block).toContain("renderCodeBlock(details, 'json')")
    expect(block).not.toContain('quickforge-todo-summary-list')
  })

  it('expands to a structured todo history list for every status in both display modes', () => {
    const block = todoWriteRenderer.slice(todoWriteRenderer.indexOf('export class TodoWriteToolRenderer'))
    const file = todoWriteRenderer
    // 展开体含结构化列表：ul + 状态类名 + 任务文本 + sr-only 状态文案（复用置顶摘要状态 i18n 键）
    expect(block).toContain('quickforge-todo-history-list')
    expect(block).toContain('quickforge-todo-history-item--${todo.status}')
    expect(block).toContain('{todo.content}')
    expect(file).toContain("t('todoWriteStatusCompleted')")
    expect(file).toContain("t('todoWriteStatusInProgress')")
    expect(file).toContain("t('todoWriteStatusPending')")
    expect(file).toContain('sr-only')
    // detailed 模式列表在上、Input/Details JSON 在下
    expect(block.indexOf('quickforge-todo-history-list')).toBeLessThan(block.indexOf("renderCodeBlock(input, 'json')"))
    // compact 展开非空：列表仅受 snapshot 约束，detailed 只 gate input/details 取值（2 处）
    expect(block).toMatch(/\{todos \? \(/)
    expect(block.match(/\bdetailed \?/g) ?? []).toHaveLength(2)
    // snapshot 缺失/为空时不渲染列表
    expect(block).toContain('viewModel.snapshot && viewModel.snapshot.length > 0')
  })

  it('styles the structured todo history list with shared state recipes and bounded scrolling', () => {
    const list = css.slice(css.indexOf('.quickforge-todo-history-list'))
    expect(list).toMatch(/^\.quickforge-todo-history-list\s*\{[\s\S]*?list-style:\s*none;/)
    expect(css).toMatch(/\.quickforge-todo-history-list--scrollable\s*\{[\s\S]*?max-height:\s*7\.5rem;[\s\S]*?overflow-y:\s*auto;/)
    // in_progress 复用胶囊 accent 配方；completed 复用 emerald 完成语义（含暗色）
    expect(css).toMatch(/\.quickforge-todo-history-item--in_progress \.quickforge-todo-history-status-icon\s*\{[\s\S]*?color:\s*color-mix\(in oklab, var\(--primary\) 78%, var\(--foreground\)\);/)
    expect(css).toMatch(/\.quickforge-todo-history-item--completed \.quickforge-todo-history-status-icon\s*\{[\s\S]*?color:\s*rgb\(4 143 101\);/)
    expect(css).toMatch(/html\.dark \.quickforge-todo-history-item--completed \.quickforge-todo-history-status-icon\s*\{[\s\S]*?color:\s*rgb\(110 231 183\);/)
    expect(css).toMatch(/\.quickforge-todo-history-item--completed \.quickforge-todo-history-content\s*\{[\s\S]*?text-decoration:\s*line-through;[\s\S]*?text-decoration-thickness:\s*1px;/)
    // hover 仅轻背景（已验证 muted 55% 配方），无位移/边框/阴影
    const itemBody = css.match(/\n\.quickforge-todo-history-item\s*\{[^}]*\}/)?.[0] ?? ''
    const hoverBody = css.match(/\.quickforge-todo-history-item:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(hoverBody).toContain('background:')
    expect(itemBody + hoverBody).not.toMatch(/box-shadow|\bborder:|\btransform:/)
    // 列表字号跟随消息字号：容器挂 text-xs，由 .quickforge-todo-history-tool > div .text-xs 收敛（×0.8）
    expect(css).toMatch(/\.quickforge-todo-history-tool > div \.text-xs\s*\{[\s\S]*?calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.8\)/)
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
