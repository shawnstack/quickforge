// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import {
  injectAskUserCard,
  submitAskTextToPendingAsk,
} from '../../src/components/chat/panel-decoration/ask-user-card'

/**
 * Composer → card routing.
 *
 * While an `ask_user` call is pending the agent loop is blocked inside the tool
 * execute, so a steer message would sit in the queue until the ask settles (or
 * times out after 30 minutes). The composer therefore feeds the mounted card
 * instead: text becomes the current question's free-form answer, an exact
 * option label when free-form is disallowed, or the card-level note on the
 * review step.
 */

function makePanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.className = 'qf-chat-panel'
  const list = document.createElement('div')
  list.className = 'qf-message-list'
  panel.append(list)
  document.body.append(panel)
  return panel
}

function makeAsk(overrides: Record<string, unknown> = {}) {
  return {
    askId: 'ask-1',
    toolCallId: 'call-1',
    questions: [{ question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }],
    requestedAt: 1,
    expiresAt: 2,
    ...overrides,
  } as never
}

function inject(panel: HTMLElement, ask = makeAsk(), deps: Partial<Parameters<typeof injectAskUserCard>[0]> = {}) {
  const onSubmit = vi.fn()
  const onSkip = vi.fn()
  injectAskUserCard({ panel, onSubmit, onSkip, ...deps }, ask)
  return { onSubmit, onSkip }
}

function progressText(panel: HTMLElement): string | null {
  return panel.querySelector('.quickforge-ask-progress')?.textContent ?? null
}

describe('composer text routed into a pending ask card', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // jsdom implements neither: the card scrolls itself into view and escapes
    // the ask id for the display-signature selector.
    Element.prototype.scrollIntoView = () => {}
    const css = (globalThis as unknown as { CSS?: { escape?: (value: string) => string } }).CSS
      ?? ((globalThis as unknown as { CSS: unknown }).CSS = {})
    if (typeof css.escape !== 'function') css.escape = (value: string) => value
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('returns false when no card is mounted', () => {
    expect(submitAskTextToPendingAsk(makePanel(), '随便说说')).toBe(false)
  })

  it('treats the text as the free-form answer and advances like the card does', async () => {
    const panel = makePanel()
    const { onSubmit } = inject(panel)

    expect(submitAskTextToPendingAsk(panel, '  用 B 方案  ')).toBe(true)
    await vi.advanceTimersByTimeAsync(200)

    // Same wizard step the card's own Enter handler produces.
    expect(progressText(panel)).toBe('askUserReviewTitle')
    const submit = panel.querySelector<HTMLButtonElement>('.quickforge-ask-button--primary')
    submit?.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(onSubmit).toHaveBeenCalledWith([{ custom: '用 B 方案' }], undefined)
  })

  it('matches an exact option label when the question forbids free-form answers', async () => {
    const panel = makePanel()
    const ask = makeAsk({
      questions: [{ question: '部署到哪？', allowCustom: false, options: [{ label: 'Staging' }, { label: 'Prod' }] }],
    })
    const { onSubmit } = inject(panel, ask)

    // 无法映射的文本交回宿主（继续按原逻辑入队），不能被静默吞掉。
    expect(submitAskTextToPendingAsk(panel, '随便写点什么')).toBe(false)
    expect(progressText(panel)).toBe('askUserProgress')

    expect(submitAskTextToPendingAsk(panel, '  prod ')).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    panel.querySelector<HTMLButtonElement>('.quickforge-ask-button--primary')?.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(onSubmit).toHaveBeenCalledWith([{ choices: ['Prod'] }], undefined)
  })

  it('adds review-step text to the card note instead of answering a question', async () => {
    const panel = makePanel()
    const { onSubmit } = inject(panel)

    expect(submitAskTextToPendingAsk(panel, '先按 B 做')).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(submitAskTextToPendingAsk(panel, '别动生产库')).toBe(true)
    expect(panel.querySelector<HTMLTextAreaElement>('.quickforge-ask-remark-input')?.value).toBe('别动生产库')

    panel.querySelector<HTMLButtonElement>('.quickforge-ask-button--primary')?.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(onSubmit).toHaveBeenCalledWith([{ custom: '先按 B 做' }], '别动生产库')
  })

  it('ignores composer text while the card is disabled', () => {
    const panel = makePanel()
    inject(panel, makeAsk(), { disabled: true })
    expect(submitAskTextToPendingAsk(panel, '答案')).toBe(false)
    expect(progressText(panel)).toBe('askUserProgress')
  })
})
