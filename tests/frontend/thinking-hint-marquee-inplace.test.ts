// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingBlock } from '../../src/components/chat/surface/ThinkingBlock'
import { decorateProcessThinkingBlocks } from '../../src/components/chat/panel-decoration/process-folding'
// 注册 `quickforge-tool-marquee` 自定义元素：hint 的真实宿主（跑马灯双视图在它内部创建）。
import '../../src/lib/tool-renderers/shared'

/**
 * 「同一句重复显示两次」的真实 DOM 回归（装饰层 → 自定义元素 → ToolMarqueeController 全链路）。
 *
 * 症状：思考行右侧尾行提示在流式「同一行内增长」时被反复整行滚入（旧文上滚出 + 新文下滚入
 * 两个视图同时可见），而两个视图的内容是同一句（只差几个字）→ 观感就是同一句话上下两份。
 *
 * 这条用例把之前只在纯逻辑层（`tool-marquee.test.ts`）和 fake DOM 层（`thinking-hint.test.ts`）
 * 覆盖的两半串起来：真 React 渲染 + 真自定义元素 + 真装饰层写序，然后断言
 * 「同一行内增长只留一个可见视图、且不产生任何纵向滚入动画」，行切换仍照旧滚入。
 * 旧实现（growth 也走 beginRoll）在第一条断言上即红灯。
 */

/**
 * `marqueeEnv.animate` 是 `(target, keyframes, options) => target.animate(keyframes, options)` 的
 * 适配层，因此桩收到的实参是 `(keyframes, options)`：纵向滚入的 keyframes 以 `translateY` 开头，
 * 横向跑马灯以 `translateX` 开头，用它区分「是否发生了整行滚入」。
 */
type AnimateCall = [Array<{ transform: string }>, KeyframeAnimationOptions]

function styleOf(element: Element | null | undefined): CSSStyleDeclaration {
  return (element as HTMLElement).style
}

function marqueeViews(hint: Element): HTMLElement[] {
  return Array.from(hint.querySelectorAll<HTMLElement>('.quickforge-marquee-view'))
}

function visibleViews(hint: Element): HTMLElement[] {
  return marqueeViews(hint).filter((view) => styleOf(view).visibility !== 'hidden')
}

function rollCalls(animate: ReturnType<typeof vi.fn>): AnimateCall[] {
  return (animate.mock.calls as unknown as AnimateCall[]).filter((call) => (
    Array.isArray(call[0]) && String(call[0][0]?.transform ?? '').startsWith('translateY')
  ))
}

describe('thinking tail hint: same-line growth stays in place (no duplicate sentence)', () => {
  let container: HTMLDivElement
  let root: Root
  let animate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    vi.setSystemTime(0)
    // jsdom 无 WAAPI：桩住动画即可观察「是否发生滚入」，并让滚入停在飞行中（两视图都可写断言）。
    animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: () => undefined }))
    ;(Element.prototype as unknown as { animate: unknown }).animate = animate
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    delete (Element.prototype as unknown as { animate?: unknown }).animate
  })

  function renderTree(): void {
    act(() => {
      root.render(
        createElement(
          'div',
          { className: 'qf-chat-panel' },
          createElement(
            'div',
            { className: 'qf-message-list' },
            createElement(
              'div',
              { className: 'qf-assistant-message' },
              createElement(
                'div',
                { className: 'flex flex-col' },
                createElement(
                  'div',
                  { className: 'quickforge-process-group' },
                  createElement(
                    'div',
                    { className: 'quickforge-process-body' },
                    // 真实 ThinkingBlock：header 子级就是 [svg, span]，装饰层据此接管。
                    createElement(ThinkingBlock, { content: 'first line\nsecond', isStreaming: true }),
                  ),
                ),
              ),
            ),
          ),
        ),
      )
    })
  }

  /** 模拟流式帧：bridge 上镜像最新 message.content（thinking 累积文本）与 isStreaming。 */
  function streamTo(thinking: string, streaming = true): void {
    const bridge = container.querySelector<HTMLElement & { message?: unknown; isStreaming?: boolean }>(
      '.qf-assistant-message',
    )
    if (!bridge) throw new Error('assistant bridge missing')
    bridge.message = { role: 'assistant', content: [{ type: 'thinking', thinking }] }
    bridge.isStreaming = streaming
  }

  function decorate(): HTMLElement {
    const group = container.querySelector<HTMLElement>('.quickforge-process-group')
    if (!group) throw new Error('process group missing')
    decorateProcessThinkingBlocks(group)
    const hint = container.querySelector<HTMLElement>('.quickforge-process-thinking-hint')
    if (!hint) throw new Error('hint slot missing')
    return hint
  }

  it('keeps exactly one visible copy while the line grows, and still rolls on a new line', () => {
    renderTree()
    streamTo('first line\nsecond')
    const hint = decorate()

    // 接管后 hint 就是 attribute 驱动的自定义元素，内部有且只有两个等价视图。
    expect(hint.tagName.toLowerCase()).toBe('quickforge-tool-marquee')
    expect(marqueeViews(hint)).toHaveLength(2)
    expect(hint.getAttribute('text')).toBe('second')
    expect(visibleViews(hint)).toHaveLength(1)

    // 同一行内增长（节流窗口过后）：文本就地追平，仍然只有一个可见视图、零纵向滚入动画。
    vi.setSystemTime(1000)
    streamTo('first line\nsecond line grows')
    const grown = decorate()

    expect(grown).toBe(hint)
    expect(hint.getAttribute('text')).toBe('second line grows')
    // 症状级断言先行：同行增长不得产生整行滚入（旧实现两次 animate）、只留一个可见视图。
    expect(rollCalls(animate)).toHaveLength(0)
    expect(visibleViews(hint)).toHaveLength(1)
    expect(hint.getAttribute('roll')).toBe('false')
    expect(visibleViews(hint)[0].querySelector('.quickforge-marquee-static')?.textContent)
      .toBe('second line grows')

    // 再看一帧增长：仍然零滚入（这是此前每 ~300ms 触发一次的重复显示来源）。
    vi.setSystemTime(2000)
    streamTo('first line\nsecond line grows more')
    decorate()

    expect(rollCalls(animate)).toHaveLength(0)
    expect(visibleViews(hint)).toHaveLength(1)

    // 行切换（新一行思考开始）仍走整行滚入：两个视图分别摆到滚出/滚入起点。
    streamTo('first line\nsecond line grows more\nthird')
    expect(decorate()).toBe(hint)

    expect(hint.getAttribute('text')).toBe('third')
    expect(hint.getAttribute('roll')).toBe('true')
    expect(rollCalls(animate)).toHaveLength(2)
    expect(styleOf(marqueeViews(hint)[0]).transform).toBe('translateY(0)')
    expect(styleOf(marqueeViews(hint)[1]).transform).toBe('translateY(100%)')
    expect(marqueeViews(hint)[1].querySelector('.quickforge-marquee-static')?.textContent).toBe('third')

    // 流式结束：整体淡出（hint 隐藏），文本清空。
    streamTo('first line\nsecond line grows more\nthird', false)
    decorate()

    expect(hint.classList.contains('quickforge-process-thinking-hint-visible')).toBe(false)
    expect(hint.getAttribute('text')).toBe('')
  })
})
