// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ComposerPlusPopover,
  ComposerPlusTrigger,
  useComposerPlusMenu,
} from '../../src/components/chat/surface/ComposerPlusMenu'
import type { CapabilitySuggestion } from '../../src/components/chat/capability-suggestions'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * The composer "+" menu used to be injected by
 * `panel-decoration/composer-plus-menu.ts` in two places: the trigger was
 * prepended into the left control row, the popover inserted before the editor
 * card. It rebuilt the popover's `innerHTML` per view and dismissed itself from
 * a document-level capture pointerdown.
 *
 * React renders both halves from one controller now. These cases pin the
 * behaviour: the main view offers attach/plugins per capability, the plugins
 * view lists capability rows and goes back, selecting dispatches and closes, and
 * dismissal follows the same outside-press rule.
 */
const pluginRow = (overrides: Partial<CapabilitySuggestion> = {}): CapabilitySuggestion => ({
  kind: 'plugin',
  pluginName: 'pdf-tools',
  label: 'PDF Tools',
  description: 'Work with PDFs',
  iconKind: 'document',
  ...overrides,
} as CapabilitySuggestion)

describe('composer plus menu', () => {
  let container: HTMLDivElement
  let root: Root
  let selectPluginCapability: ReturnType<typeof vi.fn>
  let onPickAttachment: ReturnType<typeof vi.fn>
  let onBeforeOpen: ReturnType<typeof vi.fn>
  let rows: CapabilitySuggestion[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    selectPluginCapability = vi.fn()
    onPickAttachment = vi.fn()
    onBeforeOpen = vi.fn()
    rows = [pluginRow()]
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function Harness({
    attachmentsEnabled = true,
    pluginsEnabled = true,
    composerDisabled = false,
  }: { attachmentsEnabled?: boolean; pluginsEnabled?: boolean; composerDisabled?: boolean }) {
    const controller = useComposerPlusMenu(onBeforeOpen)
    return createElement('div', null, [
      createElement(ComposerPlusPopover, {
        key: 'popover',
        controller,
        attachmentsEnabled,
        pluginsEnabled,
        availablePluginRows: () => rows,
        selectPluginCapability: selectPluginCapability as never,
        onPickAttachment: onPickAttachment as never,
      }),
      createElement(ComposerPlusTrigger, { key: 'trigger', controller, disabled: composerDisabled }),
    ])
  }

  function render(overrides: { attachmentsEnabled?: boolean; pluginsEnabled?: boolean; composerDisabled?: boolean } = {}) {
    act(() => {
      root.render(createElement(Harness, overrides))
    })
  }

  const trigger = () => container.querySelector<HTMLButtonElement>('.quickforge-plus-inline')
  const popover = () => container.querySelector<HTMLElement>('.quickforge-plus-popover')
  const items = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.quickforge-plus-popover-item'))

  function open() {
    act(() => {
      trigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
  }

  it('renders the trigger with menu semantics', () => {
    render()

    const button = trigger()!
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('composerAddMenu')
    expect(popover()).toBeNull()
  })

  it('opens the main view on pointerdown and closes on a second press', () => {
    render()
    open()

    expect(trigger()!.getAttribute('aria-expanded')).toBe('true')
    expect(popover()).not.toBeNull()
    expect(popover()!.getAttribute('role')).toBe('menu')
    expect(container.querySelector('.quickforge-plus-popover-header')!.textContent).toBe('composerAddMenu')
    expect(items().map((item) => item.textContent)).toEqual([
      'composerAddAttachment',
      'composerAddPlugins',
    ])
    expect(onBeforeOpen).toHaveBeenCalledTimes(1)

    open()
    expect(popover()).toBeNull()
  })

  it('offers only attach when plugins are unavailable', () => {
    render({ pluginsEnabled: false })
    open()

    expect(items()).toHaveLength(1)
    expect(items()[0].textContent).toBe('composerAddAttachment')
  })

  it('offers no rows at all when attachments are off and no plugins exist', () => {
    render({ attachmentsEnabled: false, pluginsEnabled: false })
    open()

    expect(popover()).not.toBeNull()
    expect(items()).toHaveLength(0)
  })

  it('opens the file picker from the attach row and closes', () => {
    render()
    open()

    act(() => {
      items()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })

    expect(onPickAttachment).toHaveBeenCalledTimes(1)
    expect(popover()).toBeNull()
  })

  it('switches to the plugins view, lists rows and goes back', () => {
    render()
    open()

    act(() => {
      items()[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('.quickforge-plus-popover-header')!.textContent).toBe('composerAddPlugins')
    // Back row first, then the capability rows.
    const pluginItems = items()
    expect(pluginItems[0].className).toContain('quickforge-plus-popover-back')
    expect(pluginItems).toHaveLength(2)
    expect(pluginItems[1].dataset.quickforgePluginName).toBe('pdf-tools')
    expect(pluginItems[1].querySelector('.quickforge-plus-popover-item-label')!.textContent).toBe('PDF Tools')
    expect(pluginItems[1].querySelector('.quickforge-plus-popover-item-description')!.textContent).toBe('Work with PDFs')

    act(() => {
      pluginItems[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('.quickforge-plus-popover-header')!.textContent).toBe('composerAddMenu')
  })

  it('selects a plugin capability and closes', () => {
    render()
    open()
    act(() => {
      items()[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })

    act(() => {
      items()[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    })

    expect(selectPluginCapability).toHaveBeenCalledWith('pdf-tools')
    expect(popover()).toBeNull()
  })

  it('renders the trigger in its disabled state and ignores presses', () => {
    // Side Chat keeps the control visible but inert (`disableComposerControls`).
    render({ composerDisabled: true })

    expect(trigger()!.disabled).toBe(true)
    open()
    expect(trigger()!.getAttribute('aria-expanded')).toBe('false')
    expect(popover()).toBeNull()
  })

  it('dismisses on an outside pointerdown but not on an inside one', () => {
    render()
    open()

    act(() => {
      popover()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(popover()).not.toBeNull()

    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(popover()).toBeNull()
  })
})
