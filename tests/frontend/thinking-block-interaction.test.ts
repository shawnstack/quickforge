import React from 'react'
import { describe, expect, it, vi } from 'vitest'

// 交互层测试只关心 header 按钮的事件处理器：mock 掉 markdown / 图标 / i18n，
// 避免拉起 react-markdown、katex 等重依赖。
vi.mock('lucide-react', () => ({ ChevronRight: () => null }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/components/chat/surface/Markdown', () => ({ MarkdownBlock: () => null }))

import { ThinkingBlock } from '../../src/components/chat/surface/ThinkingBlock'

/**
 * 回归护栏：流式期间点击「思考过程」文字必须能展开（历史上装饰层每帧重排
 * header 子级与 click 派发竞态，click 打在文字上不触发 React onClick；修复为
 * pointerdown 优先切换、真实鼠标 click（e.detail > 0）忽略，与
 * shouldToggleProcessSummary 的先例对齐）。
 *
 * 测试方式限制：本仓库 vitest 跑 node 环境（无 jsdom），renderToStaticMarkup
 * 也不序列化事件处理器，无法合成真实 pointer→click 事件序列。这里沿用仓库
 * 「手写最小 fake 表面」的既有约定（见 thinking-header-adoption.test.ts）：直调
 * 组件函数拿到 React 元素，从 header 按钮的 props 上取出 onPointerDown /
 * onClick 手动调用；组件内的 useState 通过 React development 构建暴露的
 * client internals（hook 调度器 H）注入最小桩——状态恒为 false、setter 捕获
 * updater，以「是否发起切换请求」作为断言口径。
 */

type ToggleRequest = (previous: boolean) => boolean

type HookDispatcher = {
  useState: <S>(initial: S | (() => S)) => [S, (update: S | ((previous: S) => S)) => void]
}

const internals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: { H: HookDispatcher | null }
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

if (!internals) {
  throw new Error('React client internals 不可用（production 构建或导出名变化），需改用 jsdom 合成事件重写本文件')
}

/** 直调 ThinkingBlock，返回 header 按钮的事件处理器与捕获到的切换请求。 */
function renderThinkingHeader() {
  const toggleRequests: ToggleRequest[] = []
  const previousDispatcher = internals.H
  const stubDispatcher = {
    // ThinkingBlock 只用 useState(false)：状态恒 false，setter 捕获 updater。
    useState: (initial: unknown) => {
      const value = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [value, (update: unknown) => { toggleRequests.push(update as ToggleRequest) }]
    },
  }
  internals.H = stubDispatcher as unknown as HookDispatcher
  try {
    const root = ThinkingBlock({ content: 'reasoning trace', isStreaming: true })
    const button = root.props.children[0]
    expect(button.type).toBe('button')
    expect(button.props.className).toContain('thinking-header')
    expect(button.props['aria-expanded']).toBe(false)
    return {
      onPointerDown: button.props.onPointerDown as (event: { preventDefault: () => void }) => void,
      onClick: button.props.onClick as (event: { detail: number }) => void,
      toggleRequests,
    }
  } finally {
    internals.H = previousDispatcher
  }
}

describe('ThinkingBlock header interaction (pointerdown-first during streaming)', () => {
  it('toggles on pointerdown and keeps native defaults (no preventDefault)', () => {
    const { onPointerDown, toggleRequests } = renderThinkingHeader()
    const event = { preventDefault: vi.fn() }

    onPointerDown(event)

    expect(toggleRequests).toHaveLength(1)
    expect(toggleRequests[0]?.(false)).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores the mouse-originated click that follows pointerdown (detail > 0)', () => {
    const { onPointerDown, onClick, toggleRequests } = renderThinkingHeader()

    onPointerDown({ preventDefault: () => {} })
    onClick({ detail: 1 })

    // 一次鼠标点击只切换一次：pointerdown 已处理，随后的真实 click 被忽略。
    expect(toggleRequests).toHaveLength(1)
  })

  it('still toggles on keyboard/programmatic clicks (detail === 0)', () => {
    const { onClick, toggleRequests } = renderThinkingHeader()

    onClick({ detail: 0 })

    expect(toggleRequests).toHaveLength(1)
    expect(toggleRequests[0]?.(false)).toBe(true)
  })
})
