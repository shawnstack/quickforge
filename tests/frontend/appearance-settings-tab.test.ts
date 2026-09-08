import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateResult } from 'lit'

const piWebUiMocks = vi.hoisted(() => ({
  getAppStorage: vi.fn(),
  requestUpdate: vi.fn(),
}))

vi.mock('@earendil-works/pi-web-ui', () => ({
  getAppStorage: piWebUiMocks.getAppStorage,
  SettingsTab: class {
    requestUpdate() {
      piWebUiMocks.requestUpdate()
    }
  },
}))
vi.mock('@/lib/appearance-settings', () => ({
  getCurrentTheme: () => 'light',
  loadAppearanceSettings: vi.fn(async () => ({ theme: 'light' })),
  saveAppearanceSettings: vi.fn(async () => undefined),
}))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/lib/info-tip', () => ({}))

const properties = new Map<string, string>()
const fakeDocument = {
  documentElement: {
    style: {
      fontSize: '',
      setProperty: (name: string, value: string) => properties.set(name, value),
      getPropertyValue: (name: string) => properties.get(name) ?? '',
    },
  },
  createElement: () => ({ style: {}, remove: () => undefined }),
  createTreeWalker: () => ({}),
  createComment: () => ({}),
}

let registeredTab: new () => TestTab
vi.stubGlobal('document', fakeDocument)
vi.stubGlobal('window', new EventTarget())
vi.stubGlobal('customElements', {
  get: () => undefined,
  define: (_name: string, constructor: new () => TestTab) => {
    registeredTab = constructor
  },
})

await import('../../src/lib/appearance-settings-tab')

type SliderTemplate = TemplateResult & { values: unknown[] }
type TestTab = {
  interfaceFontSizePx: number
  messageFontSizePx: number
  updateInterfaceFontSize: (value: string) => void
  updateMessageFontSize: (value: string) => void
  renderFontSizeSlider: (
    label: string,
    note: string | null,
    value: number,
    onInput: (value: string) => void,
  ) => SliderTemplate
}

function sliderHandlers(template: SliderTemplate) {
  const handlers = template.values.filter((value): value is (event?: Event) => unknown => typeof value === 'function')
  expect(handlers).toHaveLength(2)
  return { onInput: handlers[0], onChange: handlers[1] }
}

describe('appearance settings font size sliders', () => {
  const storageSet = vi.fn(async () => undefined)

  beforeEach(() => {
    properties.clear()
    fakeDocument.documentElement.style.fontSize = ''
    storageSet.mockClear()
    piWebUiMocks.requestUpdate.mockClear()
    piWebUiMocks.getAppStorage.mockReturnValue({ settings: { set: storageSet } })
  })

  it.each([
    {
      name: 'interface',
      value: 16,
      bindInput: (tab: TestTab) => (next: string) => tab.updateInterfaceFontSize(next),
      expected: { interfaceFontSizePx: 16, messageFontSizePx: 13 },
    },
    {
      name: 'message',
      value: 17,
      bindInput: (tab: TestTab) => (next: string) => tab.updateMessageFontSize(next),
      expected: { interfaceFontSizePx: 13, messageFontSizePx: 17 },
    },
  ])('$name slider keeps input local and applies immediately on change', async ({ value, bindInput, expected }) => {
    const tab = new registeredTab()
    const template = tab.renderFontSizeSlider('label', null, 13, bindInput(tab))
    const { onInput, onChange } = sliderHandlers(template)

    onInput({ target: { value: String(value) } } as unknown as Event)

    expect(tab.interfaceFontSizePx).toBe(expected.interfaceFontSizePx)
    expect(tab.messageFontSizePx).toBe(expected.messageFontSizePx)
    expect(piWebUiMocks.requestUpdate).toHaveBeenCalledOnce()
    expect(storageSet).not.toHaveBeenCalled()
    expect(fakeDocument.documentElement.style.fontSize).toBe('')
    expect(properties.get('--quickforge-message-font-size')).toBeUndefined()

    let finishPersist!: () => void
    storageSet.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishPersist = resolve
    }))
    const saving = onChange()

    expect(storageSet).toHaveBeenCalledOnce()
    expect(storageSet).toHaveBeenCalledWith('font-size-settings', expected)
    expect(fakeDocument.documentElement.style.fontSize).toBe(`${expected.interfaceFontSizePx}px`)
    expect(properties.get('--quickforge-message-font-size')).toBe(`${expected.messageFontSizePx}px`)

    finishPersist()
    await saving

    expect(fakeDocument.documentElement.style.fontSize).toBe(`${expected.interfaceFontSizePx}px`)
    expect(properties.get('--quickforge-message-font-size')).toBe(`${expected.messageFontSizePx}px`)
  })
})
