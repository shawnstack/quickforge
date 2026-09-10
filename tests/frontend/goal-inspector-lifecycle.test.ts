import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const content = readFileSync(new URL('../../src/components/workspace/GoalInspectorContent.tsx', import.meta.url), 'utf8')
const inspector = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/components/workspace/goal-inspector.css', import.meta.url), 'utf8')

describe('Goal inspector close lifecycle contract', () => {
  it('passes open rather than animated presence and aborts synchronously at commit', () => {
    expect(inspector).toMatch(/<GoalInspectorContent[^\n]+active=\{open\}/)
    const effect = content.match(/useLayoutEffect\(\(\) => \{(\n {4}if \(!active\) \{[\s\S]*?)\}, \[active, sessionId, goal.id\]\)/)?.[1]
    expect(effect).toContain('if (!active)')
    expect(effect).toContain('saveController.current?.abort()')
    expect(effect).toContain('saveController.current = null')
    expect(effect).not.toContain('setTimeout')
    expect(effect).not.toContain('setGoalUiDraft')
    // View switches do not cancel the controller or discard the retained draft.
    expect(effect).not.toContain('view')
  })

  it('independently cancels budget preflight and restores confirmation focus without bubbling Escape', () => {
    expect(content).toContain('if (!active) extendController.current?.abort()')
    expect(content).toContain('return () => { extendController.current?.abort() }')
    expect(content).toContain('signal: controller.signal')
    expect(content).toContain('if (budgetConfirmation) keepBudgetRef.current?.focus()')
    expect(content).toContain('extendButtonRef.current?.focus()')
    expect(content).toContain('event.preventDefault(); event.stopPropagation(); dismissBudget()')
    expect(content).toContain('if (extendController.current === controller) extendController.current = null')
  })

  it('blocks closing-panel saves and prevents an old completion from clearing a new controller or draft', () => {
    expect(content).toMatch(/if \(!active \|\|[^\n]+saveController.current\) return/)
    expect(content).toContain('const controller = new AbortController()')
    expect(content).toContain('if (saveController.current === controller) saveController.current = null')
    expect(content).toContain('if (!controller.signal.aborted) setGoalUiDraft(sessionId, goal.id, null)')
  })
})

describe('Goal inspector structure', () => {
  it('scrolls the content and pins the action bar at the bottom (G-01)', () => {
    expect(content).toContain('quickforge-goal-inspector-scroll')
    expect(content).toContain('quickforge-goal-inspector-footer')
    const scroll = css.match(/\.quickforge-goal-inspector-scroll\s*\{[^}]*\}/)?.[0] ?? ''
    expect(scroll).toMatch(/overflow-y:\s*auto/)
    expect(scroll).toMatch(/min-height:\s*0/)
    expect(scroll).toMatch(/overscroll-behavior:\s*contain/)
    const footer = css.match(/\.quickforge-goal-inspector-footer\s*\{[^}]*\}/)?.[0] ?? ''
    expect(footer).toMatch(/border-top/)
    expect(footer).toMatch(/flex:\s*none/)
    const actions = css.match(/\.quickforge-goal-inspector-actions\s*\{[^}]*\}/)?.[0] ?? ''
    expect(actions).toMatch(/flex-wrap:\s*wrap/)
  })

  it('keeps the segmented progress/edit switch separate from the action buttons (G-05)', () => {
    expect(content).toMatch(/aria-pressed=\{view === 'progress'\}/)
    expect(content).toMatch(/aria-pressed=\{view === 'edit'\}/)
    expect(content).toContain('quickforge-goal-inspector-seg')
    // Action buttons come from the shared Button component, not the seg styles.
    expect(content).toContain("from '@/components/ui/button'")
  })
})
