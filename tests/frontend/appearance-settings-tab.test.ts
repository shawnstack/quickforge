import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes } from './settings-react-harness'

vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
const storageSet = vi.fn(async () => undefined)
vi.mock('@/storage', () => ({ getAppStorage: () => ({ settings: { get: async () => null, set: storageSet } }) }))
vi.mock('@/lib/appearance-settings', () => ({ getCurrentTheme: () => 'light', loadAppearanceSettings: async () => ({ theme: 'light' }), saveAppearanceSettings: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
import { AppearanceSettingsTab, FontSizeSlider } from '../../src/components/settings/tabs/AppearanceSettingsTab'

const properties = new Map<string, string>()
const style = { fontSize: '', setProperty: (key: string, value: string) => properties.set(key, value), getPropertyValue: (key: string) => properties.get(key) ?? '' }
function render() { harness.begin(); return nodes(AppearanceSettingsTab()) }
async function mount() {
  render()
  harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(render().filter((node) => node.type === FontSizeSlider)).toHaveLength(2))
}
beforeEach(() => {
  harness.reset(); vi.clearAllMocks(); storageSet.mockReset(); storageSet.mockResolvedValue(undefined); properties.clear(); style.fontSize = ''
  vi.stubGlobal('document', { documentElement: { style } })
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())

describe('React appearance settings font size sliders', () => {
  it.each([[0, 16, { interfaceFontSizePx: 16, messageFontSizePx: 13 }], [1, 17, { interfaceFontSizePx: 13, messageFontSizePx: 17 }]] as const)(
    'slider %s keeps input local then applies CSS before persistence finishes', async (index, value, expected) => {
      await mount()
      storageSet.mockClear()
      const slider = () => render().filter((node) => node.type === FontSizeSlider)[index]
      slider().props.onInput(String(value))
      expect(slider().props.value).toBe(value)
      expect(storageSet).not.toHaveBeenCalled()
      expect(style.fontSize).toBe('')
      let finish!: () => void
      storageSet.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
      slider().props.onCommit(String(value))
      expect(storageSet).toHaveBeenCalledWith('font-size-settings', expected)
      expect(style.fontSize).toBe(`${expected.interfaceFontSizePx}px`)
      expect(properties.get('--quickforge-message-font-size')).toBe(`${expected.messageFontSizePx}px`)
      finish()
    },
  )

  it('attaches a native change listener, not a continuous React onChange save', () => {
    const input = Object.assign(new EventTarget(), { value: '18' })
    const onInput = vi.fn(); const onCommit = vi.fn()
    harness.begin()
    const tree = FontSizeSlider({ value: 13, onInput, onCommit })
    harness.refs[0].current = input
    const cleanups = harness.effects.map((effect) => effect())
    tree.props.onInput({ currentTarget: { value: '18' } })
    expect(onInput).toHaveBeenCalledWith('18')
    expect(onCommit).not.toHaveBeenCalled()
    input.dispatchEvent(new Event('change'))
    expect(onCommit).toHaveBeenCalledWith('18')
    expect(onCommit).toHaveBeenCalledOnce()
    cleanups.forEach((cleanup) => cleanup?.())
    input.dispatchEvent(new Event('change'))
    expect(onCommit).toHaveBeenCalledOnce()
  })
})
