import { afterEach, expect, it, vi } from 'vitest'
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
  querySelector(selector: string) { return selector === 'span' ? this.children[1] : this.children.find((child) => child.className === 'quickforge-goal-iteration-divider') || null }
}
afterEach(() => vi.unstubAllGlobals())
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
