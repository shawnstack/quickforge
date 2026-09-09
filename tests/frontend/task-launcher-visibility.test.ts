import { expect, it } from 'vitest'
import { createTaskLauncherVisibility } from '../../src/components/chat/task-launcher-visibility'

it('requires accepted explicit creation, including reuse, and a blank matching agent', () => {
  const state = createTaskLauncherVisibility<object>()
  const agent = {}
  expect(state.visible(agent, true)).toBe(false)
  expect(state.complete(state.begin(), agent, false)).toBe(false)
  expect(state.visible(agent, true)).toBe(false)
  expect(state.complete(state.begin(), agent, true)).toBe(true)
  expect(state.visible(agent, true)).toBe(true)
  expect(state.visible({}, true)).toBe(false)
  expect(state.visible(agent, false)).toBe(false)
})

it('inherits eligibility only through accepted project switching and ignores stale completions', () => {
  const state = createTaskLauncherVisibility<object>()
  const old = state.begin()
  const current = state.begin()
  const project = {}
  expect(state.complete(old, {}, true)).toBe(false)
  expect(state.complete(current, project, true)).toBe(true)
  expect(state.visible(project, true)).toBe(true)
})

it('sending or history navigation permanently invalidates eligibility and pending new-chat work', () => {
  const state = createTaskLauncherVisibility<object>()
  const agent = {}
  state.complete(state.begin(), agent, true)
  const pending = state.begin()
  state.invalidate()
  expect(state.complete(pending, agent, true)).toBe(false)
  expect(state.visible(agent, true)).toBe(false)
})
