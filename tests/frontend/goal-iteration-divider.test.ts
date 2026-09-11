import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { syncGoalIterationDivider } from '../../src/components/chat/panel-decoration/goal-iteration-divider'
import { syncGoalInternalMessage } from '../../src/components/chat/panel-decoration/goal-internal-message'

vi.mock('@/lib/i18n', () => ({ t: (key: string, args?: { count: string }) => args ? `Iteration ${args.count}` : key }))
class Element {
  className = ''
  classList = { toggle: (name: string, enabled: boolean) => {
    const classes = new Set(this.className.split(/\s+/).filter(Boolean))
    if (enabled) classes.add(name)
    else classes.delete(name)
    this.className = [...classes].join(' ')
  } }
  textContent = ''
  innerHTML = ''
  children: Element[] = []
  parent: Element | null = null
  get lastElementChild() { return this.children.at(-1) }
  setAttribute() {}
  append(...nodes: Element[]) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node) } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null }
  querySelector(selector: string) { return selector === 'span' ? this.children[1] : selector === 'svg' ? this.children[0] : this.children.find((child) => child.className === 'quickforge-goal-iteration-divider') || null }
}
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => new Element(), createElementNS: () => new Element() })
})
afterEach(() => vi.unstubAllGlobals())

// Source-level CSS contract only; this fake DOM does not perform browser layout.
it.each(['assistant', 'user'])('orders the stage divider after %s actions in column-flex CSS', (role) => {
  const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
  const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`)).split('}')[0]
  const root = rule(`.quickforge-${role}-message`)
  expect(root).toContain('display: flex !important;')
  expect(root).toContain('flex-direction: column !important;')
  const actions = rule(`.quickforge-${role}-message > .quickforge-message-actions`)
  const divider = rule('.quickforge-goal-iteration-divider')
  expect(actions).toMatch(/order:\s*2;/)
  expect(divider).toMatch(/order:\s*3;/)
  // Hidden internal user / empty assistant hosts remain block fallbacks: order
  // does not reveal their content or interfere with the lone direct divider.
  expect(rule('user-message.quickforge-goal-internal-user-message:has(> .quickforge-goal-iteration-divider),\n.quickforge-process-source-empty:has(> .quickforge-goal-iteration-divider)'))
    .toContain('display: block !important;')
})

it.each([0, 3])('renders planning at iteration %i without an execution round number', (iteration) => {
  const root = new Element()
  syncGoalIterationDivider(root as unknown as HTMLElement, {
    quickforgeGoalIteration: { goalId: 'goal', kind: 'planning', iteration, outcome: 'running' },
  })
  expect(root.lastElementChild?.querySelector('span')?.textContent).toBe('goalPlanningLabel · goalPlanningReady')
})

it.each([
  ['planning', 'goalPlanningNeeded'],
  ['error', 'goalPlanningError'],
  ['paused', 'goalIterationPaused'],
  ['blocked', 'goalIterationBlocked'],
  ['cancelled', 'goalIterationCancelled'],
  ['completed', 'goalPlanningNeeded'],
  ['verifying', 'goalPlanningNeeded'],
  ['needs_review', 'goalPlanningNeeded'],
  ['unknown', 'goalPlanningNeeded'],
])('does not claim planning success for outcome %s', (outcome, label) => {
  const root = new Element()
  const marker = { goalId: 'goal', kind: 'planning', iteration: 0, outcome: 'running' }
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: marker })
  const divider = root.lastElementChild!
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: { ...marker, outcome } })
  expect(root.lastElementChild).toBe(divider)
  expect(divider?.querySelector('span')?.textContent).toBe(`goalPlanningLabel · ${label}`)
  expect(divider?.children[0].innerHTML).not.toContain('m8 12 3 3 5-6')
})

it.each(['paused', 'blocked', 'cancelled', 'error'])('preserves planning %s even with a stale budget blocker', (outcome) => {
  const root = new Element()
  syncGoalIterationDivider(root as unknown as HTMLElement, {
    quickforgeGoalIteration: { goalId: 'goal', kind: 'planning', iteration: 0, outcome, blocker: 'duration_budget' },
  })
  expect(root.lastElementChild?.querySelector('span')?.textContent).toBe(`goalPlanningLabel · ${outcome === 'error' ? 'goalPlanningError' : `goalIteration${outcome[0].toUpperCase()}${outcome.slice(1)}`}`)
})

it.each([undefined, 'execution'])('preserves execution labels with kind %s', (kind) => {
  const root = new Element()
  const marker = { goalId: 'goal', iteration: 1, outcome: 'completed', ...(kind ? { kind } : {}) }
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: marker })
  expect(root.lastElementChild?.querySelector('span')?.textContent).toBe('Iteration 1 · goalIterationCompleted')
})

const validMarker = { goalId: 'goal', kind: 'execution', iteration: 1, outcome: 'completed' }
it.each([
  undefined, null, false, 'marker', [], {},
  Object.assign([], validMarker),
  ...[null, '', 'unknown', false, 0, {}].map((kind) => ({ ...validMarker, kind })),
  ...[undefined, null, '', '   ', 1, {}].map((goalId) => ({ ...validMarker, goalId })),
  ...[undefined, null, '1', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1].map((iteration) => ({ ...validMarker, iteration })),
  ...[-1, '0', 0.5].map((iteration) => ({ ...validMarker, kind: 'planning', iteration })),
].map((marker) => [marker]))('rejects invalid marker %j and clears a previously mounted divider', (marker) => {
  const root = new Element()
  const content = new Element()
  root.append(content)
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: validMarker })
  expect(root.children).toHaveLength(2)
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: marker })
  expect(root.children).toEqual([content])
})

it.each([undefined, null, false, 'details', [], Object.assign([], { quickforgeGoalIteration: validMarker })].map((details) => [details]))('rejects malformed details %j', (details) => {
  const root = new Element()
  syncGoalIterationDivider(root as unknown as HTMLElement, details)
  expect(root.children).toHaveLength(0)
})

it('adds completed-task planning metadata to the existing host immediately and restores an internal user fallback', () => {
  const root = new Element()
  const content = new Element()
  root.append(content)
  syncGoalIterationDivider(root as unknown as HTMLElement, {})
  expect(root.children).toEqual([content])
  // The completed task delivers details after the message DOM already exists.
  const message = { role: 'user', metadata: { quickforgeGoalRun: 'planning' }, details: {
    quickforgeGoalIteration: { goalId: 'old-goal', kind: 'planning', iteration: 0, outcome: 'running' },
  } }
  syncGoalInternalMessage(root as unknown as HTMLElement, message)
  syncGoalIterationDivider(root as unknown as HTMLElement, message.details)
  const divider = root.lastElementChild!
  expect(divider.querySelector('span')?.textContent).toBe('goalPlanningLabel · goalPlanningReady')
  const laterContent = new Element()
  root.append(laterContent)
  syncGoalIterationDivider(root as unknown as HTMLElement, JSON.parse(JSON.stringify(message.details)))
  syncGoalIterationDivider(root as unknown as HTMLElement, message.details)
  expect(root.children).toEqual([content, laterContent, divider])
  const restored = new Element()
  const restoredMessage = JSON.parse(JSON.stringify(message))
  syncGoalInternalMessage(restored as unknown as HTMLElement, restoredMessage)
  syncGoalIterationDivider(restored as unknown as HTMLElement, restoredMessage.details)
  expect(restored.className).toContain('quickforge-goal-internal-user-message')
  expect(restored.lastElementChild?.querySelector('span')?.textContent).toBe('goalPlanningLabel · goalPlanningReady')
  syncGoalIterationDivider(root as unknown as HTMLElement, {})
  expect(root.children).toEqual([content, laterContent])
})
it('renders durable iteration metadata independently of current goal and is idempotent outside process content', () => {
  vi.stubGlobal('document', { createElement: () => new Element(), createElementNS: () => new Element() })
  const root = new Element()
  root.append(new Element()) // existing process content remains a sibling
  const details = { quickforgeGoalIteration: { goalId: 'old-goal', iteration: 2, outcome: 'completed' } }
  syncGoalIterationDivider(root as unknown as HTMLElement, details)
  const divider = root.lastElementChild!
  expect(divider.querySelector('span')?.textContent).toBe('Iteration 2 · goalIterationCompleted')
  syncGoalIterationDivider(root as unknown as HTMLElement, structuredClone(details))
  expect(root.children).toHaveLength(2)
  expect(root.lastElementChild).toBe(divider)
  root.append(new Element()) // another decorator appended content after the divider
  syncGoalIterationDivider(root as unknown as HTMLElement, details)
  expect(root.lastElementChild).toBe(divider)
  expect(root.children).toHaveLength(3)
  const restoredRoot = new Element()
  // No assistant in this run: restored internal user remains the divider host.
  const restoredMessage = JSON.parse(JSON.stringify({ role: 'user', metadata: { quickforgeGoalRun: 'execution' }, details }))
  syncGoalInternalMessage(restoredRoot as unknown as HTMLElement, restoredMessage)
  syncGoalIterationDivider(restoredRoot as unknown as HTMLElement, restoredMessage.details)
  expect(restoredRoot.className).toContain('quickforge-goal-internal-user-message')
  expect(restoredRoot.lastElementChild?.querySelector('span')?.textContent).toBe('Iteration 2 · goalIterationCompleted')
  syncGoalIterationDivider(root as unknown as HTMLElement, { quickforgeGoalIteration: { ...details.quickforgeGoalIteration, outcome: 'paused', blocker: 'duration_budget' } })
  expect(divider.querySelector('span')?.textContent).toContain('goalIterationBudget')
  syncGoalIterationDivider(root as unknown as HTMLElement, {})
  expect(root.children).toHaveLength(2)
})
