import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))

import { buildGoalToolHistoryViewModel as build } from '../../src/lib/goal-tool-history'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { GoalToolRenderer } from '../../src/lib/tool-renderers/goal-tool-renderer'

const localToolsSource = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../src/lib/tool-renderers/goal-tool-renderer.tsx', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

applyAppLanguageFromSnapshot('en')

const goal = {
  id: 'goal_1',
  revision: 2,
  objective: 'Verify the goal tool cards',
  phase: 'active',
  roundsStarted: 0,
  maxGoalRounds: 1,
}
const payload = (value: unknown = { goal, activation: 'armed' }) => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

function render(toolName: string, params: unknown, output: unknown, streaming = false, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const rendered = new GoalToolRenderer(toolName).render(params as Record<string, unknown> | undefined, output as Parameters<GoalToolRenderer['render']>[1], streaming)
  const markup = renderToStaticMarkup(rendered.content as ReactElement)
  return { rendered, markup, codeBlocks: markup.match(/class="qf-code-block\b/g) ?? [] }
}

describe('goal tool history view model', () => {
  it('reads a compact goal from a successful tool result', () => {
    expect(build('create_goal', { objective: 'input objective' }, payload())).toMatchObject({
      status: 'done',
      summaryKey: 'goalToolCreate',
      objective: goal.objective,
      phase: 'active',
      phaseKey: 'goalToolPhaseActive',
      activation: 'armed',
      roundsStarted: 0,
      maxGoalRounds: 1,
      outputText: '',
    })
  })

  it('shows an empty read without inventing a goal', () => {
    const view = build('get_goal', {}, payload({ goal: null }))
    expect(view).toMatchObject({ status: 'done', summaryKey: 'goalToolNone', objective: '', phase: null, outputText: '' })
  })

  it('keeps the requested update action and falls back to its objective before success', () => {
    const view = build('update_goal', { action: 'complete', objective: 'Finish the cards' }, undefined, true)
    expect(view).toMatchObject({
      status: 'running',
      summaryKey: 'goalToolUpdateRunning',
      action: 'complete',
      actionKey: 'goalToolActionComplete',
      objective: 'Finish the cards',
      phase: null,
    })
  })

  it.each([
    [undefined, false, 'called', 'goalToolRead'],
    [payload(), true, 'running', 'goalToolReadRunning'],
    [{ ...payload(), isError: true }, false, 'error', 'goalToolReadFailed'],
    [{ details: { aborted: true }, content: payload().content }, false, 'error', 'goalToolReadFailed'],
  ])('does not claim a recorded goal for pending or failed calls (%s)', (output, streaming, status, summaryKey) => {
    const view = build('get_goal', { objective: 'requested' }, output, streaming)
    expect(view.status).toBe(status)
    expect(view.summaryKey).toBe(summaryKey)
    expect(view.phase).toBeNull()
    expect(view.roundsStarted).toBeNull()
  })

  it('preserves non-json prose and ignores malformed goal payloads', () => {
    expect(build('get_goal', {}, { content: [{ type: 'text', text: 'Legacy prose' }] }).outputText).toBe('Legacy prose')
    expect(build('create_goal', { objective: 'bad' }, payload({ goal: { phase: 'running' } }))).toMatchObject({
      summaryKey: 'goalToolCreate',
      objective: '',
      phase: null,
    })
  })
})

describe('goal tool registered renderer', () => {
  it('registers borderless collapsed cards for all three tools', () => {
    for (const name of ['get_goal', 'create_goal', 'update_goal']) {
      expect(localToolsSource).toContain(`registerToolRenderer(name, new GoalToolRenderer(name))`)
      expect(localToolsSource).toContain(`'${name}'`)
    }
    const view = render('update_goal', { action: 'blocked', blocked_reason: 'Need a decision' }, payload({
      goal: { ...goal, phase: 'blocked', blockedReason: { code: 'model_reported', message: 'Need a decision' } },
      activation: 'disarmed',
    }))
    expect(view.rendered.isCustom).toBe(true)
    expect(view.markup).toContain('quickforge-local-tool-shell')
    expect(view.markup).toContain('<details class="group/tool quickforge-local-tool quickforge-goal-tool"')
    expect(view.markup).not.toContain('open=')
    expect(view.markup).toContain(t('goalToolUpdate'))
    expect(view.markup).toContain(`${t('goalToolActionBlocked')} · ${t('goalToolPhaseBlocked')} · ${goal.objective}`)
    expect(view.markup).toContain('Need a decision')
    expect(view.markup).toContain('quickforge-goal-report-blocker')
    expect(view.markup).toContain('0/1')
    expect(view.markup).toContain(t('goalToolDisarmed'))
    expect(view.markup).not.toContain('data-tone=')
    expect(view.codeBlocks).toEqual([])
    expect(view.markup).not.toContain('<button')
    expect(source).not.toMatch(/updateGoal|dispatchEvent|unsafeHTML|innerHTML|onClick/)
  })

  it('shows raw json only in detailed mode and keeps both languages paired', () => {
    const view = render('get_goal', {}, payload(), false, true)
    expect(view.codeBlocks).toHaveLength(2)
    expect(render('get_goal', {}, payload()).codeBlocks).toEqual([])
    for (const key of ['goalToolRead', 'goalToolCreate', 'goalToolUpdate', 'goalToolNone', 'goalToolPhaseActive', 'goalToolDisarmed']) {
      expect(i18n).toContain(`${key}:`)
    }
  })
})
