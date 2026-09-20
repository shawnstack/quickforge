import type { ReactElement } from 'react'

// Node-only callback harness: preserve state/refs across renders, run effects explicitly.
export const harness = {
  states: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0,
  effects: [] as (() => void | (() => void))[],
  reset() { this.states = []; this.refs = []; this.begin() },
  begin() { this.cursor = 0; this.refCursor = 0; this.effects = [] },
}
export const hooks = {
  useId: () => 'test-select',
  useEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect) },
  useLayoutEffect: (effect: () => void | (() => void)) => { harness.effects.push(effect) },
  useRef: (initial: unknown) => {
    const index = harness.refCursor++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value }]
  },
}
type InputEvent = { currentTarget: { value: string } }
type KeyEvent = {
  key: string
  nativeEvent: { isComposing?: boolean }
  preventDefault: () => void
  stopPropagation?: () => void
}
// The tests locate a matching control before accessing its callback contract.
export type TestNode = ReactElement<{
  children?: unknown
  className?: string
  role?: string
  label?: string
  disabled?: boolean
  value: string | number
  options: { value: string }[]
  onInput: (value: string | InputEvent) => void
  onCommit: (value: string) => void
  onChange: (value: string | InputEvent) => void
  onClick: () => void
  onKeyDown: (event: KeyEvent) => void
  [key: `aria-${string}`]: unknown
}>
export function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as TestNode
  return [node, ...nodes(node.props.children)]
}
export function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as TestNode).props.children) : ''
}
