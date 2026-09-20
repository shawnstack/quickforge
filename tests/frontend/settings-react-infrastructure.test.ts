import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { HookLifecycle } from './helpers/hook-lifecycle'

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>()
  const { hookRuntime } = await import('./helpers/hook-lifecycle')
  return { ...original, ...hookRuntime, useLayoutEffect: hookRuntime.useEffect, useId: () => hookRuntime.useMemo(() => 'test-id', []) }
})
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import { SettingsSelect, type SettingsSelectProps } from '../../src/components/settings/SettingsSelect'
import { SettingsSwitch } from '../../src/components/settings/tabs/shared'
import { InfoTip } from '../../src/components/ui/info-tip'
import { positionSettingsSelect } from '../../src/components/settings/settings-select-state'

// Real component callbacks/effect lifecycles, with only host nodes mocked (no DOM dependency).
type TestNode = ReactElement<Record<string, unknown> & { children?: unknown; ref?: { current: unknown } }>
function nodes(tree: unknown): TestNode[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as TestNode
  return [node, ...nodes(node.props.children)]
}
function handler(node: TestNode, name: string) {
  return node.props[name] as (event?: unknown) => void
}
function rect() { return { top: 10, bottom: 40, left: 10, width: 180, height: 30 } }
let lifecycle: HookLifecycle
let listeners: Map<string, (event: unknown) => void>
let documentMock: { activeElement: unknown; body: object; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>; getElementById: () => null }
const hosts = new Map<string, ReturnType<typeof host>>()
function host() {
  const value = {
    style: {}, offsetHeight: 200, offsetWidth: 180, id: '',
    getBoundingClientRect: rect, querySelector: () => null,
    contains: (target: unknown) => target === value,
    focus: vi.fn(() => { documentMock.activeElement = value }),
  }
  return value
}
function renderSelect(overrides: Partial<SettingsSelectProps> = {}) {
  return lifecycle.render(() => {
    const tree = SettingsSelect({ value: 'a', options: [
      { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Blocked', disabled: true }, { value: 'c', label: 'Charlie' },
    ], onChange: changed, label: 'Model', ...overrides })
    for (const node of nodes(tree)) {
      if (!node.props.ref) continue
      const key = String(node.props.role ?? node.props.className)
      if (!hosts.has(key)) hosts.set(key, host())
      node.props.ref.current = hosts.get(key)
    }
    return nodes(tree)
  })
}
const changed = vi.fn()
function control(tree: TestNode[], role: string) { return tree.find((node) => node.props.role === role)! }
function key(key: string, extra = {}) {
  const event = { key, preventDefault: vi.fn(), ...extra }
  listeners.get('keydown')?.(event)
  return event
}
beforeEach(() => {
  lifecycle = new HookLifecycle()
  listeners = new Map()
  hosts.clear()
  changed.mockClear()
  documentMock = {
    activeElement: null, body: {}, getElementById: () => null,
    addEventListener: vi.fn((type, callback) => { listeners.set(type, callback) }),
    removeEventListener: vi.fn((type) => { listeners.delete(type) }),
  }
  vi.stubGlobal('document', documentMock)
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), innerHeight: 800, innerWidth: 1200 })
})
afterEach(() => { lifecycle.unmount(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('React SettingsSelect', () => {
  it('opens a React portal, skips disabled options, selects with Enter and restores focus', () => {
    handler(control(renderSelect(), 'combobox'), 'onClick')()
    let tree = renderSelect()
    expect(control(tree, 'combobox').props['aria-expanded']).toBe(true)
    expect(control(tree, 'listbox').props.id).toBe(control(tree, 'combobox').props['aria-controls'])
    expect(control(tree, 'option').props['aria-selected']).toBe(true)
    key('ArrowDown')
    tree = renderSelect()
    expect(control(tree, 'combobox').props['aria-activedescendant']).toContain('option-2')
    key('Enter')
    tree = renderSelect()
    expect(changed).toHaveBeenCalledWith('c')
    expect(control(tree, 'combobox').props['aria-expanded']).toBe(false)
    expect(documentMock.activeElement).toBe(hosts.get('combobox'))
    expect(listeners.size).toBe(0)
  })

  it('supports initial End/ArrowUp, Home, Space, Escape and non-trapping Tab', () => {
    handler(control(renderSelect(), 'combobox'), 'onKeyDown')({ key: 'ArrowUp', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    expect(control(renderSelect(), 'combobox').props['aria-activedescendant']).toContain('option-2')
    key('Home'); renderSelect(); key(' ')
    expect(changed).toHaveBeenLastCalledWith('a')
    handler(control(renderSelect(), 'combobox'), 'onClick')(); renderSelect()
    expect(key('Tab').preventDefault).not.toHaveBeenCalled()
    expect(control(renderSelect(), 'combobox').props['aria-expanded']).toBe(false)
    handler(control(renderSelect(), 'combobox'), 'onClick')(); renderSelect()
    key('Escape')
    expect(control(renderSelect(), 'combobox').props['aria-expanded']).toBe(false)
  })

  it('filters case-insensitively, ignores disabled results and IME, keeps spaces for search', () => {
    const props = { searchable: true, noResultsLabel: 'No options' }
    handler(control(renderSelect(props), 'combobox'), 'onClick')()
    let tree = renderSelect(props)
    expect(documentMock.activeElement).toBe(hosts.get('searchbox'))
    expect(key(' ').preventDefault).not.toHaveBeenCalled()
    expect(key('Enter', { isComposing: true }).preventDefault).not.toHaveBeenCalled()
    handler(control(tree, 'searchbox'), 'onChange')({ currentTarget: { value: '  CHAR ' } })
    tree = renderSelect(props)
    expect(tree.filter((node) => node.props.role === 'option')).toHaveLength(1)
    expect(control(tree, 'searchbox').props['aria-activedescendant']).toContain('option-2')
    handler(control(tree, 'searchbox'), 'onChange')({ currentTarget: { value: 'blocked' } })
    tree = renderSelect(props)
    key('Enter')
    handler(control(tree, 'option'), 'onClick')()
    expect(changed).not.toHaveBeenCalled()
    handler(control(tree, 'searchbox'), 'onChange')({ currentTarget: { value: 'missing' } })
    tree = renderSelect(props)
    expect(control(tree, 'status').props.children).toBe('No options')
    expect(control(tree, 'searchbox').props['aria-activedescendant']).toBeUndefined()
  })

  it('closes on outside pointer, clears its search, and cleans listeners on unmount', () => {
    handler(control(renderSelect({ searchable: true }), 'combobox'), 'onClick')()
    let tree = renderSelect({ searchable: true })
    handler(control(tree, 'searchbox'), 'onChange')({ currentTarget: { value: 'Charlie' } })
    renderSelect({ searchable: true })
    listeners.get('pointerdown')?.({ target: {} })
    tree = renderSelect({ searchable: true })
    expect(control(tree, 'combobox').props['aria-expanded']).toBe(false)
    expect(documentMock.activeElement).toBe(hosts.get('combobox'))
    handler(control(tree, 'combobox'), 'onClick')()
    tree = renderSelect({ searchable: true })
    expect(control(tree, 'searchbox').props.value).toBe('')
    lifecycle.unmount()
    expect(listeners.size).toBe(0)
    expect(window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('immediately reflects controlled value/options and closes when disabled', () => {
    handler(control(renderSelect(), 'combobox'), 'onClick')(); renderSelect()
    let tree = renderSelect({ value: 'c', options: [{ value: 'c', label: 'Updated' }] })
    expect(control(tree, 'option').props['aria-selected']).toBe(true)
    tree = renderSelect({ disabled: true })
    expect(control(tree, 'combobox').props.disabled).toBe(true)
    expect(tree.some((node) => node.props.role === 'listbox')).toBe(false)
    expect(control(renderSelect(), 'combobox').props['aria-expanded']).toBe(false)
  })

  it('keeps the fixed popup within the viewport and flips above near the bottom', () => {
    const menu = host()
    const trigger = { getBoundingClientRect: () => ({ top: 700, bottom: 730, left: 1190, width: 180 }) }
    positionSettingsSelect(menu as unknown as HTMLElement, trigger as HTMLElement)
    expect(menu.style).toMatchObject({ top: 'auto', bottom: '106px', left: '1012px', minWidth: 'max(12rem, 180px)' })
  })
})

describe('React settings accessibility and help', () => {
  it('associates switches with their existing row title and accepts explicit names', () => {
    const title = { id: '' }
    const attributes = new Map<string, string>()
    const input = { closest: () => ({ querySelector: () => title }), setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) }
    const render = (label?: string, labelledBy?: string) => lifecycle.render(() => {
      const tree = nodes(SettingsSwitch({ checked: true, disabled: true, onChange: changed, label, 'aria-labelledby': labelledBy }))
      const checkbox = tree.find((node) => node.type === 'input')!
      checkbox.props.ref!.current = input
      return checkbox
    })
    expect(render().props.disabled).toBe(true)
    expect(attributes.get('aria-labelledby')).toBe(title.id)
    expect(title.id).not.toBe('')
    expect(render('Enable memory').props['aria-label']).toBe('Enable memory')
    expect(attributes.has('aria-labelledby')).toBe(false)
    render()
    render(undefined, 'explicit-title')
    expect(attributes.get('aria-labelledby')).toBe('explicit-title')
  })

  it('renders help without custom elements and opens/closes via focus, Escape and delayed hover', () => {
    vi.useFakeTimers()
    const render = () => lifecycle.render(() => nodes(InfoTip({ label: 'Helpful text' })))
    let tree = render()
    let button = tree.find((node) => node.type === 'button')!
    expect(button.props['aria-label']).toBe('help')
    handler(button, 'onFocus')()
    tree = render()
    expect(control(tree, 'tooltip').props.children).toBe('Helpful text')
    listeners.get('keydown')?.({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() })
    tree = render()
    expect(tree.some((node) => node.props.role === 'tooltip')).toBe(false)
    button = tree.find((node) => node.type === 'button')!
    handler(button, 'onMouseEnter')()
    vi.advanceTimersByTime(150)
    expect(control(render(), 'tooltip')).toBeDefined()
    handler(button, 'onMouseLeave')()
    vi.advanceTimersByTime(120)
    expect(render().some((node) => node.props.role === 'tooltip')).toBe(false)
  })
})
