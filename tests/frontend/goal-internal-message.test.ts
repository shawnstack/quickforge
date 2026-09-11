import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { isGoalInternalUserMessage } from '../../src/components/chat/panel-decoration/goal-internal-message'

it.each(['execution', 'planning'])('recognizes durable %s metadata after history restore', (kind) => {
  const message = { role: 'user', content: 'arbitrary text', metadata: { quickforgeGoalRun: kind } }
  expect(isGoalInternalUserMessage(JSON.parse(JSON.stringify(message)))).toBe(true)
})

it.each([undefined, null, {}, [], 'execution', { quickforgeGoalRun: 'unknown' }, { quickforgeGoalRun: true }])('does not hide missing or malformed metadata %j', (metadata) => {
  expect(isGoalInternalUserMessage({ role: 'user', content: '继续执行目标（第 2/8 轮）', metadata })).toBe(false)
})

it.each(['assistant', 'toolResult', 'user-with-attachments'])('never hides non-internal role %s', (role) => {
  expect(isGoalInternalUserMessage({ role, metadata: { quickforgeGoalRun: 'execution' } })).toBe(false)
})

it('CSS hides internal descendants from layout/focus but preserves direct user and empty assistant dividers', () => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  expect(css).toContain('user-message.quickforge-goal-internal-user-message:not(:has(> .quickforge-goal-iteration-divider))')
  expect(css).toContain('.quickforge-process-source-empty:not(:has(> .quickforge-goal-iteration-divider))')
  expect(css).toMatch(/user-message\.quickforge-goal-internal-user-message > :not\(\.quickforge-goal-iteration-divider\)[^{]+\{\s*display: none !important;/)
  expect(css).toMatch(/\.quickforge-process-source-empty:has\(> \.quickforge-goal-iteration-divider\) \{\s*display: block !important;/)
})
