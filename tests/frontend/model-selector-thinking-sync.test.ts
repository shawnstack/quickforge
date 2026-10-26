// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

import {
  closeComposerModelMenu,
  openCustomOnlyModelSelector,
  type ModelSelectorHandle,
} from '../../src/lib/custom-model-selector'
import { THINKING_SLIDER_LEVELS } from '../../src/lib/thinking-slider'

/**
 * 弹层保持打开期间切换模型时，底部滑杆必须跟着变。
 *
 * 真实故障：`useModelActions` 早期没有接收 `openCustomOnlyModelSelector` 的
 * 返回值，切到非推理模型时状态已被强制 `off`，但滑杆仍停在打开弹层那一刻的
 * 旧档位——用户看到「模型不支持思考、滑杆却显示 high」，拖一下才会被打回。
 * 这些用例锁定 handle 的同步能力，进而锁定那条接线可用。
 */

function model(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: 'model-1',
    provider: 'provider',
    api: 'openai',
    baseUrl: 'https://example.test',
    reasoning: true,
    input: ['text'],
    ...overrides,
  } as unknown as Model<Api>
}

let anchor: HTMLButtonElement
let handle: ModelSelectorHandle | null

beforeEach(() => {
  anchor = document.createElement('button')
  anchor.className = 'quickforge-model-trigger'
  document.body.append(anchor)
  handle = null
})

afterEach(() => {
  closeComposerModelMenu(anchor)
  handle = null
  anchor.remove()
  document.body.replaceChildren()
})

function openSelector(thinkingLevel: 'off' | 'low' | 'medium' | 'high' | 'xhigh' = 'high') {
  handle = openCustomOnlyModelSelector(
    model(),
    [model()],
    () => {},
    undefined,
    {
      anchor,
      thinkingLevel,
      onThinkingLevelChange: () => {},
    },
  )
  return handle!
}

const track = () => document.querySelector<HTMLElement>('.quickforge-model-thinking-track')
const stack = () => document.querySelector<HTMLElement>('.quickforge-model-thinking-stack')

describe('model selector thinking sync', () => {
  it('mounts the thinking slider only when a level and a change handler are provided', () => {
    openSelector('high')
    expect(track()).not.toBeNull()
    expect(track()!.getAttribute('aria-valuetext')).toBe('thinkingHigh')

    closeComposerModelMenu(anchor)
    openCustomOnlyModelSelector(model(), [model()], () => {}, undefined, { anchor })
    expect(track()).toBeNull()
  })

  it('positions the rolling column on the provided level at open time', () => {
    openSelector('high')
    // 打开弹层首帧就必须在 high（下标 3），不能停在第一行「关」。
    expect(track()!.getAttribute('aria-valuenow')).toBe('3')
    expect(stack()!.style.transform).not.toBe('')
    expect(stack()!.style.transform).not.toBe('translateY(0.00px)')
  })

  it('re-renders the slider when the session level changes while open', () => {
    const selector = openSelector('high')

    selector.setThinkingLevel?.('low')

    expect(track()!.getAttribute('aria-valuenow')).toBe('1')
    expect(track()!.getAttribute('aria-valuetext')).toBe('thinkingLow')

    selector.setThinkingLevel?.('off')
    expect(track()!.getAttribute('aria-valuenow')).toBe('0')
  })

  it('disables the slider after switching to a non-reasoning model', () => {
    const selector = openSelector('high')
    expect(track()!.getAttribute('aria-disabled')).toBe('false')
    expect(track()!.tabIndex).toBe(0)

    selector.setThinkingDisabled?.(true)

    expect(track()!.getAttribute('aria-disabled')).toBe('true')
    expect(track()!.tabIndex).toBe(-1)

    selector.setThinkingDisabled?.(false)
    expect(track()!.getAttribute('aria-disabled')).toBe('false')
  })

  it('keeps every level reachable through the handle setter', () => {
    const selector = openSelector('off')

    THINKING_SLIDER_LEVELS.forEach((level, index) => {
      selector.setThinkingLevel?.(level)
      expect(track()!.getAttribute('aria-valuenow')).toBe(String(index))
      expect(track()!.getAttribute('aria-valuetext')).toBe(
        `thinking${level === 'off' ? 'Off' : level === 'xhigh' ? 'XHigh' : level[0].toUpperCase() + level.slice(1)}`,
      )
    })
  })

  it('exposes the sync hooks on the mobile sheet handle too', () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })

    try {
      const selector = openSelector('medium')
      expect(document.querySelector('.quickforge-model-sheet')).not.toBeNull()

      selector.setThinkingLevel?.('xhigh')
      expect(track()!.getAttribute('aria-valuenow')).toBe('4')

      selector.setThinkingDisabled?.(true)
      expect(track()!.getAttribute('aria-disabled')).toBe('true')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })
})
