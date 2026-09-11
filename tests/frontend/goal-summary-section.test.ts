import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))
import { GoalSummarySection } from '../../src/components/git/GoalSummarySection'
import { GoalInspectorContent } from '../../src/components/workspace/GoalInspectorContent'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { clearGoalUi, getGoalUiState, setGoalUiDraft } from '../../src/lib/goal-ui'
import type { GoalState } from '../../src/lib/goal'

const goal: GoalState = {
  id: 'goal-1', sessionId: 'session-1', revision: 7, objective: '收敛 Goal 到侧栏', status: 'running',
  criteria: [{ id: 'c1', description: '构建通过', required: true, status: 'passed', evidenceIds: ['e1'] }, { id: 'c2', description: '窄屏可用', required: false, status: 'pending', evidenceIds: [] }],
  scope: ['src'], summary: '已完成接线', budget: { maxIterations: 8, maxActiveDurationMs: 1800000 }, usage: { iterations: 5, activeDurationMs: 1080000 },
  evidence: [{ id: 'e1', description: '真实构建结果', toolName: 'build' }], updatedAt: '2026-01-01T00:00:00.000Z',
}
const render = (state = goal) => renderToStaticMarkup(createElement(GoalSummarySection, { goal: state, sessionId: goal.sessionId }))
const inspector = (state = goal, view: 'progress' | 'edit' = 'edit') => renderToStaticMarkup(createElement(GoalInspectorContent, { goal: state, sessionId: goal.sessionId, view, onViewChange: () => {}, onAction: async () => {}, onSave: async () => {} }))
afterEach(() => clearGoalUi(goal.sessionId, goal.id))
applyAppLanguageFromSnapshot('zh')

describe('Goal summary navigation', () => {
  it('renders one two-line entry with real status/title/count, without editor or action stack', () => {
    const html = render()
    expect(html.match(/<button\b/g)).toHaveLength(1)
    expect(html).toContain('执行中')
    expect(html).toContain(goal.objective)
    expect(html).toContain('class="quickforge-goal-icon size-3.5 shrink-0"')
    expect(html).not.toContain('lucide-target')
    expect(html).toContain('1/2 项验收标准')
    expect(html).toContain(goal.summary)
    expect(html).not.toMatch(/textarea|progressbar|<details/)
    expect(html).not.toContain('构建通过')
  })
  it('prioritizes blockers over summaries', () => {
    const html = render({ ...goal, blocker: '停止原因', blockerHint: '预算已耗尽' })
    expect(html).toContain('预算已耗尽')
    expect(html).not.toContain(goal.summary)
  })
})

describe('Goal Inspector', () => {
  it('keeps running drafts in a large editor across renders and view changes', () => {
    setGoalUiDraft(goal.sessionId, goal.id, { objective: goal.objective, text: '保留草稿', editing: true })
    expect(inspector()).toContain('保留草稿</textarea>')
    expect(inspector(goal, 'progress')).not.toContain('<textarea')
    expect(inspector()).toContain('保留草稿</textarea>')
    expect(getGoalUiState(goal.sessionId, goal.id).dirty).toBe(true)
  })
  it('retains conflicting drafts and disables save', () => {
    setGoalUiDraft(goal.sessionId, goal.id, { objective: '旧目标', text: '保留草稿', editing: true })
    const html = inspector()
    expect(html).toContain('目标已在别处更新')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存目标/)
    expect(html).toContain('保留草稿</textarea>')
  })
  it('shows a baseline conflict even when the retained draft is clean', () => {
    setGoalUiDraft(goal.sessionId, goal.id, { objective: '旧目标', text: '旧目标', editing: true })
    const html = inspector()
    expect(getGoalUiState(goal.sessionId, goal.id).dirty).toBe(false)
    expect(html).toContain('目标已在别处更新')
    expect(html).toContain('旧目标</textarea>')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存目标/)
  })
  it('renders terminal objectives read-only and evidence collapsed in progress', () => {
    expect(inspector({ ...goal, status: 'completed' })).toContain('readOnly=""')
    const html = inspector(goal, 'progress')
    expect(html).toContain('真实构建结果')
    expect(html).toContain('<details>')
    expect(html).not.toContain('<details open')
  })
})
