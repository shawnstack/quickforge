// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AgentAccessMenu,
  AgentAccessTrigger,
  PlanModeTrigger,
  agentAccessLabel,
  positionAgentAccessMenu,
} from '../../src/components/chat/surface/ComposerAccessControls'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * Plan-mode toggle and agent-access selector used to be injected into the
 * composer's left control row by `panel-decoration/plan-mode-controls.ts`
 * (`syncPlanModeButton`) and `panel-decoration/agent-access-menu.ts`
 * (`setupAgentAccessMenu`). React renders both now.
 *
 * These cases pin the behaviour the controllers implemented: the plan toggle
 * reports `aria-pressed` and toggles on pointerdown/Enter/Space, the access
 * trigger mirrors `aria-expanded` and opens on pointerdown, the menu marks the
 * current mode and dispatches only on a different one, and the fixed menu
 * position is clamped into the viewport above the trigger.
 */
describe('composer access controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const planTrigger = () => container.querySelector<HTMLButtonElement>('.quickforge-plan-inline')
  const accessTrigger = () => container.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')

  describe('plan mode trigger', () => {
    function render(planMode: boolean, onToggle = vi.fn()) {
      act(() => { root.render(createElement(PlanModeTrigger, { planMode, onToggle })) })
      return onToggle
    }

    it('renders the pressed state and the plan copy', () => {
      render(true)

      const button = planTrigger()!
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('planModeEnabledTitle')
      expect(button.title).toBe('planModeEnabledTitle')
      expect(button.textContent).toBe('planModeLabel')
      // Both glyphs are rendered; CSS picks one per state.
      expect(button.querySelector('.quickforge-plan-mode-icon')).not.toBeNull()
      expect(button.querySelector('.quickforge-plan-remove-icon')).not.toBeNull()
    })

    it('toggles on pointerdown', () => {
      const onToggle = render(false)

      act(() => {
        planTrigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      })

      expect(onToggle).toHaveBeenCalledTimes(1)
    })

    it('toggles on Enter and Space', () => {
      const onToggle = render(false)

      for (const key of ['Enter', ' ']) {
        act(() => {
          planTrigger()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
        })
      }

      expect(onToggle).toHaveBeenCalledTimes(2)
    })
  })

  describe('agent access trigger', () => {
    it('labels the default and full-access modes', () => {
      expect(agentAccessLabel('default')).toBe('agentAccessDefaultLabel')
      expect(agentAccessLabel('full-access')).toBe('agentAccessFullLabel')

      act(() => { root.render(createElement(AgentAccessTrigger, { mode: 'full-access', expanded: false, onToggle: vi.fn() })) })
      const button = accessTrigger()!
      expect(button.className).toContain('quickforge-agent-access-inline-full')
      expect(button.textContent).toBe('agentAccessFullLabel')
      expect(button.getAttribute('aria-label')).toBe('agentAccessFullTitle')
    })

    it('mirrors aria-expanded and opens on pointerdown', () => {
      const onToggle = vi.fn()
      act(() => { root.render(createElement(AgentAccessTrigger, { mode: 'default', expanded: false, onToggle })) })
      expect(accessTrigger()!.getAttribute('aria-expanded')).toBe('false')

      act(() => {
        accessTrigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      })
      expect(onToggle).toHaveBeenCalledTimes(1)

      act(() => { root.render(createElement(AgentAccessTrigger, { mode: 'default', expanded: true, onToggle })) })
      expect(accessTrigger()!.getAttribute('aria-expanded')).toBe('true')
    })

    it('stays inert when disabled (Side Chat) and still reports aria-expanded', () => {
      const onToggle = vi.fn()
      act(() => {
        root.render(createElement(AgentAccessTrigger, { mode: 'default', expanded: false, disabled: true, onToggle }))
      })

      expect(accessTrigger()!.disabled).toBe(true)
      expect(accessTrigger()!.getAttribute('aria-expanded')).toBe('false')
      act(() => {
        accessTrigger()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      })
      expect(onToggle).not.toHaveBeenCalled()
    })
  })

  describe('agent access menu', () => {
    function renderMenu(mode: 'default' | 'full-access', onSelect = vi.fn()) {
      const menuRef = { current: null as HTMLDivElement | null }
      act(() => {
        root.render(createElement(AgentAccessMenu, {
          mode,
          anchor: null,
          menuRef: menuRef as never,
          onSelect,
        }))
      })
      return onSelect
    }

    const items = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.quickforge-agent-access-item'))

    it('lists both modes with the current one checked', () => {
      renderMenu('full-access')

      const menu = container.querySelector<HTMLElement>('.quickforge-agent-access-menu')!
      expect(menu.getAttribute('role')).toBe('menu')
      expect(menu.getAttribute('aria-label')).toBe('agentAccessMenuLabel')

      expect(items().map((item) => item.dataset.quickforgeAgentAccessMode)).toEqual(['default', 'full-access'])
      expect(items()[0].getAttribute('aria-checked')).toBe('false')
      expect(items()[1].getAttribute('aria-checked')).toBe('true')
      expect(items()[1].querySelector('.quickforge-agent-access-check-slot svg')).not.toBeNull()
      expect(items()[1].querySelector('.quickforge-agent-access-item-label')!.textContent).toBe('agentAccessFullLabel')
    })

    it('selects a mode on pointerdown', () => {
      const onSelect = renderMenu('default')

      act(() => {
        items()[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      })

      expect(onSelect).toHaveBeenCalledWith('full-access')
    })

    it('renders off-screen until it can be measured', () => {
      renderMenu('default')

      const menu = container.querySelector<HTMLElement>('.quickforge-agent-access-menu')!
      expect(menu.style.left).toBe('-9999px')
      expect(menu.style.top).toBe('-9999px')
    })

    it('positions above the trigger and clamps into the viewport', () => {
      // Plenty of room above: the menu sits MENU_GAP above the trigger's top.
      expect(positionAgentAccessMenu({ left: 300, top: 400, width: 120 }, 110, { width: 1280, height: 800 }))
        .toEqual({ width: 196, left: 300, top: 282 })

      // Near the top edge: clamped to the 12px inset instead of going negative.
      expect(positionAgentAccessMenu({ left: 300, top: 400, width: 120 }, 500, { width: 1280, height: 800 }).top).toBe(12)

      // Near the right edge: the menu is pulled back inside the viewport.
      expect(positionAgentAccessMenu({ left: 1200, top: 400, width: 120 }, 110, { width: 1280, height: 800 }).left)
        .toBe(1280 - 196 - 12)

      // Narrow viewport: the width shrinks to leave the 12px insets.
      expect(positionAgentAccessMenu({ left: 0, top: 400, width: 100 }, 110, { width: 180, height: 800 }).width).toBe(156)
    })

    it('falls back to the default height before the menu is measured', () => {
      // `measuredHeight` is 0 on the first frame; the decoration used 96px.
      expect(positionAgentAccessMenu({ left: 0, top: 400, width: 100 }, 0, { width: 1280, height: 800 }).top).toBe(400 - 96 - 8)
    })
  })
})
