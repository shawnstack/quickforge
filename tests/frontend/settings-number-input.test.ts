import { beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
import { SettingsNumberInput } from '../../src/components/settings/tabs/SettingsNumberInput'

beforeEach(() => harness.reset())
describe('React settings number input native submission semantics', () => {
  it('keeps typing local, commits native change from blur/stepper, and deduplicates Enter then blur', () => {
    const onInput = vi.fn(); const onCommit = vi.fn()
    const input = Object.assign(new EventTarget(), { value: '80' })
    const tree = SettingsNumberInput({ value: '80', onInput, onCommit })
    harness.refs[0].current = input
    const cleanups = harness.effects.map((effect) => effect())
    input.value = '81'
    tree.props.onInput({ currentTarget: input })
    expect(onInput).toHaveBeenCalledWith('81'); expect(onCommit).not.toHaveBeenCalled()
    input.dispatchEvent(new Event('change')) // stepper or blur
    expect(onCommit).toHaveBeenLastCalledWith('81')
    input.value = '82'
    const preventDefault = vi.fn()
    tree.props.onKeyDown({ key: 'Enter', nativeEvent: {}, currentTarget: input, preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onCommit).toHaveBeenLastCalledWith('82')
    input.dispatchEvent(new Event('change'))
    expect(onCommit).toHaveBeenCalledTimes(2)
    cleanups.forEach((cleanup) => cleanup?.())
    input.value = '83'; input.dispatchEvent(new Event('change'))
    expect(onCommit).toHaveBeenCalledTimes(2)
  })
  it('does not submit during IME composition', () => {
    const onCommit = vi.fn()
    const tree = SettingsNumberInput({ value: '20', onInput: vi.fn(), onCommit })
    tree.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, currentTarget: { value: '21' }, preventDefault: vi.fn() })
    expect(onCommit).not.toHaveBeenCalled()
  })
})
