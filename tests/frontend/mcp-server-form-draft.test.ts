// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { McpServerForm } from '../../src/components/mcp/mcp-server-form'
import { emptyMcpDraft, type McpServerFormData } from '../../src/lib/mcp-helpers'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

/**
 * 受控宿主：value 存在 state 里，模拟真实父组件 `onChange={setDraft}`。
 * 同屏渲染一份结构化值快照，用来断言「显示原文的同时，数据仍按解析值提交」。
 */
function Host({ initial, external }: { initial: McpServerFormData; external?: McpServerFormData }) {
  const [value, setValue] = useState(initial)
  // external 非空 = 父组件从外部换了编辑对象（比如点了另一台服务器），此时应重置草稿。
  const effective = external ?? value
  return createElement(
    'div',
    null,
    createElement('pre', { 'data-testid': 'snapshot' }, JSON.stringify({ args: effective.args, env: effective.env })),
    createElement(McpServerForm, { value: effective, isEdit: false, onChange: setValue }),
  )
}

/** 绕过 React 的 value tracker，受控 textarea 才会真的收到一次 input 事件。 */
const setNativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

describe('McpServerForm 文本框不再吞掉中间态输入', () => {
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

  function mount(initial: McpServerFormData, external?: McpServerFormData) {
    act(() => root.render(createElement(Host, { initial, external })))
  }

  function areas(): HTMLTextAreaElement[] {
    return Array.from(container.querySelectorAll('textarea'))
  }

  function type(textarea: HTMLTextAreaElement, text: string) {
    act(() => {
      setNativeValue.call(textarea, text)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function committed(): { args: string[]; env: Record<string, string> } {
    return JSON.parse(container.querySelector('[data-testid="snapshot"]')!.textContent || '{}')
  }

  it('args：刚敲下的换行不会被立刻吃掉', () => {
    mount({ ...emptyMcpDraft(), command: 'npx', args: ['--foo'] })
    type(areas()[0], '--foo\n')
    // 现状：textToArgs 过滤空行 → 父 value 回到 ['--foo'] → 受控回写把换行抹掉。
    expect(areas()[0].value).toBe('--foo\n')
    // 显示留原文，数据照旧提交解析值，保存不会丢参数。
    expect(committed().args).toEqual(['--foo'])
  })

  it('env：还没敲等号的键不会整行消失', () => {
    mount(emptyMcpDraft())
    type(areas()[1], 'FOO')
    // 现状：textToEnv 丢掉没有 `=` 的行 → 受控回写把这一行抹掉。
    expect(areas()[1].value).toBe('FOO')
    expect(committed().env).toEqual({})
  })

  it('env：等号敲完照常提交解析值', () => {
    mount(emptyMcpDraft())
    type(areas()[1], 'FOO=1')
    expect(areas()[1].value).toBe('FOO=1')
    expect(committed().env).toEqual({ FOO: '1' })
  })

  it('args：多行仍按行解析，尾随空行不算参数', () => {
    mount(emptyMcpDraft())
    type(areas()[0], 'a\nb\n')
    expect(areas()[0].value).toBe('a\nb\n')
    expect(committed().args).toEqual(['a', 'b'])
  })

  it('换成另一台服务器时草稿跟着重置', () => {
    mount(emptyMcpDraft())
    type(areas()[1], 'MINE=1')
    expect(areas()[1].value).toBe('MINE=1')

    mount(emptyMcpDraft(), { ...emptyMcpDraft(), name: 'other', command: 'uvx', env: { OTHER: '2' } })
    expect(areas()[1].value).toBe('OTHER=2')
  })
})
