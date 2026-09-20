import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
vi.mock('react-dom', () => ({ createPortal: (content: unknown) => content }))
import { SettingsSelect, type SettingsSelectProps } from '../../src/components/settings/SettingsSelect'
import { moveSelectFocus } from '../../src/components/settings/settings-select-state'
const options = [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }, { value: 'c', label: 'Disabled', disabled: true }]
let props: SettingsSelectProps
function render() { harness.begin(); return nodes(SettingsSelect(props)) }
function trigger() { return render().find((node) => node.props.role === 'combobox')! }
function option(label: string) { return render().find((node) => node.props.role === 'option' && text(node) === label)! }
beforeEach(() => {
  harness.reset(); props = { value: '', options, onChange: vi.fn(), placeholder: 'Choose', searchable: true, noResultsLabel: 'No results' }
  vi.stubGlobal('document', { body: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), getElementById: () => null })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('React controlled settings select', () => {
  it('shows placeholder, then immediately reflects parent value/options updates', () => {
    expect(text(trigger())).toContain('Choose')
    props = { ...props, value: 'b' }
    expect(text(trigger())).toContain('Option B')
    props = { ...props, options: [{ value: 'b', label: 'Renamed' }] }
    expect(text(trigger())).toContain('Renamed')
  })
  it('emits selection without mutating controlled value, and retains the parent label through reopen', () => {
    trigger().props.onClick(); option('Option B').props.onClick()
    expect(props.onChange).toHaveBeenCalledWith('b')
    expect(text(trigger())).toContain('Choose')
    props = { ...props, value: 'b' }
    expect(text(trigger())).toContain('Option B')
    trigger().props.onClick(); expect(option('Option B').props['aria-selected']).toBe(true)
    trigger().props.onClick(); expect(text(trigger())).toContain('Option B')
  })
  it('ignores disabled options and prevents a disabled control reopening', () => {
    trigger().props.onClick(); option('Disabled').props.onClick()
    expect(props.onChange).not.toHaveBeenCalled()
    props = { ...props, disabled: true }
    expect(trigger().props['aria-expanded']).toBe(false)
    props = { ...props, disabled: false }
    expect(trigger().props['aria-expanded']).toBe(false)
  })
  it('filters options and exposes an empty search result', () => {
    trigger().props.onClick()
    const search = () => render().find((node) => node.props.role === 'searchbox')!
    search().props.onChange({ currentTarget: { value: 'option b' } })
    expect(render().filter((node) => node.props.role === 'option').map(text)).toEqual(['Option B'])
    search().props.onChange({ currentTarget: { value: 'missing' } })
    expect(text(render().find((node) => node.props.role === 'status'))).toBe('No results')
  })
  it('opens by ArrowUp on the last enabled option and removes document handlers on cleanup', () => {
    trigger().props.onKeyDown({ key: 'ArrowUp', nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    render()
    const cleanups = harness.effects.map((effect) => effect())
    const listener = vi.mocked(document.addEventListener).mock.calls.find(([type]) => type === 'keydown')![1] as (event: unknown) => void
    listener({ key: 'Enter', preventDefault: vi.fn() })
    expect(props.onChange).toHaveBeenCalledWith('b')
    cleanups.forEach((cleanup) => cleanup?.())
    expect(document.removeEventListener).toHaveBeenCalledWith('keydown', listener)
  })
  it('moves unfocused ArrowUp to the last option and ArrowDown to the first (symmetric with openMenu)', () => {
    const indexes = [0, 1, 3]
    expect(moveSelectFocus(indexes, -1, 'ArrowUp')).toBe(3)
    expect(moveSelectFocus(indexes, -1, 'ArrowDown')).toBe(0)
    expect(moveSelectFocus([], -1, 'ArrowUp')).toBe(-1)
  })
})
