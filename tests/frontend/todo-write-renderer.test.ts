import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTodoWriteHistoryViewModel } from '../../src/lib/todo-write-history'
import { appCss } from '../helpers/app-css'

const source = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
// T4：TodoWriteToolRenderer 已迁至 tool-renderers/todo-write-tool-renderer.tsx（React）。
const todoWriteRenderer = readFileSync(new URL('../../src/lib/tool-renderers/todo-write-tool-renderer.tsx', import.meta.url), 'utf8')
const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const css = appCss
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
    // 状态文案与图标统一来自 `src/lib/todo-status.tsx`：渲染器只消费共享映射，
    // 不再自带一份 label/图标实现（避免第三套状态词汇漂移）。
    expect(file).toContain('<TodoStatusIcon status={todo.status} />')
    expect(file).toContain('t(TODO_STATUS_LABEL_KEY[todo.status])')
    expect(file).not.toContain('todoHistoryStatusIcon')
    const sharedStatus = readFileSync(new URL('../../src/lib/todo-status.ts', import.meta.url), 'utf8')
    expect(sharedStatus).toContain("completed: 'todoWriteStatusCompleted'")
    expect(sharedStatus).toContain("in_progress: 'todoWriteStatusInProgress'")
    expect(sharedStatus).toContain("pending: 'todoWriteStatusPending'")
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

  it('keeps the capsule in normal flow and hangs the task popover above it', () => {
    const block = css.slice(css.indexOf('/* TodoWrite task summary'), css.indexOf('/* Desktop pinned summary'))
    expect(css).toMatch(/\.quickforge-composer-shell\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/)
    expect(block).toMatch(/\.quickforge-todo-summary\s*\{[\s\S]*?width:\s*100%;[\s\S]*?flex:\s*none;/)
    expect(block).toMatch(/\.quickforge-todo-summary-popover\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*100%;/)
    // The popover is the only floating piece: the section itself must stay in
    // flow so the composer dock height (and the editor under it) never jumps.
    const sectionBlock = block.slice(block.indexOf('.quickforge-todo-summary {'), block.indexOf('.quickforge-todo-summary-trigger {'))
    expect(sectionBlock).not.toMatch(/position:\s*(?:sticky|fixed|absolute)/)
    // No fixed positioning and no backdrop blur anywhere in the capsule: it is
    // a composer-adjacent affordance, not a modal.
    expect(block).not.toMatch(/position:\s*fixed/)
    expect(block).not.toMatch(/backdrop-filter/)
    expect(block).toMatch(/\.quickforge-todo-summary-list\s*\{[\s\S]*?max-height:[^;]+;[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/)
    expect(css).toContain('.quickforge-todo-summary-toggle:focus-visible')
    expect(css).toContain('@media (max-width: 640px)')
    expect(block).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.quickforge-todo-summary-list\s*\{[\s\S]*?max-height:/)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(block).not.toMatch(/linear-gradient|radial-gradient/)
  })

  it('spins only the in-progress arc, and never on the history card', () => {
    // The arc lives in its own group so the glyph's track stays put; without the
    // dedicated transform origin the arc wobbles around its own bounding box
    // instead of spinning on the ring's centre.
    expect(css).toMatch(/\.quickforge-todo-summary-status-icon \.quickforge-todo-spin-arc[\s\S]*?transform-box:\s*view-box;[\s\S]*?transform-origin:\s*12px 12px;[\s\S]*?animation:/)
    expect(css).toMatch(/@keyframes quickforge-todo-status-spin\s*\{[\s\S]*?rotate\(360deg\)/)
    // Live surfaces only: a history snapshot's in-progress row is history, not
    // work in flight, so it must not animate.
    expect(css).not.toMatch(/\.quickforge-todo-history-status-icon [^{]*\.quickforge-todo-spin-arc/)
    // Reduced motion stops the spin and lightens the track so the shape still
    // reads as "running" (3/4 ring) rather than as the hollow pending circle.
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.quickforge-todo-spin-arc[\s\S]*?animation:\s*none;/)
    expect(reduced).toMatch(/\.quickforge-todo-spin-track[\s\S]*?opacity:\s*0\.45;/)
  })

  it('colors completed checks with the shared emerald tone in both themes', () => {
    const block = css.slice(css.indexOf('/* TodoWrite task summary'))
    expect(block).toMatch(/\.quickforge-todo-summary-ring-check\s*\{[\s\S]*?color:\s*rgb\(4 143 101\)/)
    expect(block).toMatch(/html\.dark \.quickforge-todo-summary-ring-check\s*\{[\s\S]*?color:\s*rgb\(110 231 183\)/)
    expect(block).toMatch(/\.quickforge-todo-summary\[data-complete="true"\][\s\S]*?\.quickforge-todo-summary-ring-check\s*\{\s*opacity:\s*1/)
    expect(block).toMatch(/\.quickforge-todo-summary-item--completed \.quickforge-todo-summary-status-icon\s*\{[\s\S]*?color:\s*rgb\(4 143 101\)/)
    expect(block).toMatch(/html\.dark \.quickforge-todo-summary-item--completed \.quickforge-todo-summary-status-icon\s*\{[\s\S]*?color:\s*rgb\(110 231 183\)/)
  })

  it('leaves the TodoWrite capsule entirely to React', () => {
    const decorateBlock = host.slice(host.indexOf('const decorate = () =>'), host.indexOf('// Render or remove approval card'))
    // The capsule used to be re-synced from the decorate pass right after
    // `decorateEditor` (which is why this test pinned their order). React renders
    // it inside the composer now, so the decorate pass must no longer touch it —
    // otherwise two writers own the same subtree again.
    expect(decorateBlock).not.toContain('todoWriteSummary.update()')
    expect(host).not.toContain('createTodoWriteSummaryController')
    // The task launcher stays command-driven (it owns a floating panel).
    expect(decorateBlock).toContain('taskLauncher?.sync()')
  })
})
