import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FONT_SIZE_SETTINGS_CHANGED_EVENT,
  applyFontSizeSettings,
} from '../../src/lib/font-size-settings'

type FakeDocument = {
  documentElement: {
    style: {
      fontSize: string
      setProperty: (name: string, value: string) => void
      getPropertyValue: (name: string) => string
    }
  }
}

function createFakeDocument(): FakeDocument {
  const properties = new Map<string, string>()
  return {
    documentElement: {
      style: {
        fontSize: '',
        setProperty: (name, value) => {
          properties.set(name, value)
        },
        getPropertyValue: (name) => properties.get(name) ?? '',
      },
    },
  }
}

function createFakeWindow() {
  return new EventTarget()
}

describe('font size settings apply', () => {
  let fakeDocument: FakeDocument
  let fakeWindow: ReturnType<typeof createFakeWindow>

  beforeEach(() => {
    fakeDocument = createFakeDocument()
    fakeWindow = createFakeWindow()
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('window', fakeWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('skips redundant writes and events when nothing changed', () => {
    const events: unknown[] = []
    fakeWindow.addEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, (event) =>
      events.push((event as CustomEvent).detail),
    )

    applyFontSizeSettings({ interfaceFontSizePx: 14, messageFontSizePx: 15 })
    expect(events).toHaveLength(1)
    expect(fakeDocument.documentElement.style.fontSize).toBe('14px')
    expect(fakeDocument.documentElement.style.getPropertyValue('--quickforge-message-font-size')).toBe('15px')

    applyFontSizeSettings({ interfaceFontSizePx: 14, messageFontSizePx: 15 })
    expect(events).toHaveLength(1)
  })

  it('updates message CSS variables without dispatching an event', () => {
    const events: unknown[] = []
    fakeWindow.addEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, (event) =>
      events.push((event as CustomEvent).detail),
    )

    applyFontSizeSettings({ interfaceFontSizePx: 14, messageFontSizePx: 13 })
    applyFontSizeSettings({ interfaceFontSizePx: 14, messageFontSizePx: 16 })
    expect(events).toHaveLength(1)
    expect(fakeDocument.documentElement.style.fontSize).toBe('14px')
    expect(fakeDocument.documentElement.style.getPropertyValue('--quickforge-message-font-size')).toBe('16px')
    expect(fakeDocument.documentElement.style.getPropertyValue('--quickforge-message-line-height')).toBe('1.625')
  })

  it('dispatches an event when the interface font size changes', () => {
    const events: unknown[] = []
    fakeWindow.addEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, (event) =>
      events.push((event as CustomEvent).detail),
    )

    applyFontSizeSettings({ interfaceFontSizePx: 13, messageFontSizePx: 13 })
    applyFontSizeSettings({ interfaceFontSizePx: 16, messageFontSizePx: 16 })
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({ interfaceFontSizePx: 16, messageFontSizePx: 16 })
    expect(fakeDocument.documentElement.style.fontSize).toBe('16px')
  })
})
