// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }), { virtual: true })

import { decorateProcessBlocks } from '../../src/components/chat/panel-decoration/process-folding'

/**
 * 「工具调用 → 思考 → 最终回复」后最终回复被折进过程组的复现防线。
 * 用户 DOM 取证确认：回复已渲染但被折叠层隐藏（刷新后恢复）。
 * 本测试用 jsdom 构建真实 DOM 结构，按服务端日志实证的时序驱动装饰层，
 * 断言最终回复的 markdown 始终不被搬进 .quickforge-process-group。
 */

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function buildAssistant(opts: { thinking?: string; toolCall?: boolean; text?: string }): HTMLElement {
  const assistant = el('div', 'qf-assistant-message')
  const stack = el('div', 'flex flex-col gap-1.5 px-4')
  assistant.appendChild(stack)
  if (opts.thinking !== undefined) {
    const thinking = el('div', 'qf-thinking-block')
    thinking.textContent = opts.thinking
    stack.appendChild(thinking)
  }
  if (opts.toolCall) {
    const tool = el('div', 'qf-tool-message')
    tool.textContent = 'run_command'
    stack.appendChild(tool)
  }
  if (opts.text !== undefined) {
    const markdown = el('div', 'qf-markdown-block')
    markdown.textContent = opts.text
    stack.appendChild(markdown)
  }
  return assistant
}

function buildPanel(): { panel: HTMLElement; list: HTMLElement } {
  const panel = el('div', 'qf-chat-panel')
  const list = el('div', 'qf-message-list')
  panel.appendChild(list)
  document.body.appendChild(panel)
  return { panel, list }
}

function insideProcessGroup(node: HTMLElement): boolean {
  return node.closest('.quickforge-process-group') !== null
}

describe('process folding: final reply after tool + thinking stays visible', () => {
  let panel: HTMLElement
  let list: HTMLElement
  let user: HTMLElement
  let a1: HTMLElement
  let a2: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    const built = buildPanel()
    panel = built.panel
    list = built.list
    user = el('div', 'qf-user-message')
    user.textContent = 'go'
    a1 = buildAssistant({ thinking: 'need a tool', toolCall: true })
    a2 = buildAssistant({ thinking: 'analyzing' })
    list.append(user, a1, a2)
  })

  it('user scenario: a2 text must never be folded into the process group', () => {
    // Phase 1: a1 (thinking + toolCall) streaming, a2 not yet present
    list.removeChild(a2)
    decorateProcessBlocks(panel, [user, a1], true)

    // Phase 2: a2 joins with thinking only (final text not streamed yet)
    list.appendChild(a2)
    decorateProcessBlocks(panel, [user, a1, a2], true)
    // thinking blocks belong to the process group — intended folding
    expect(insideProcessGroup(a1.querySelector('.qf-thinking-block') as HTMLElement)).toBe(true)

    // Phase 3: final text arrives on a2 while still streaming
    const stack = a2.querySelector('.flex') as HTMLElement
    const text = el('div', 'qf-markdown-block')
    text.textContent = 'the final answer'
    stack.appendChild(text)
    decorateProcessBlocks(panel, [user, a1, a2], true)
    expect(insideProcessGroup(text)).toBe(false)

    // Phase 4: turn ends (agent_end) — text must stay out of the group
    decorateProcessBlocks(panel, [user, a1, a2], false)
    expect(insideProcessGroup(text)).toBe(false)
    expect(text.isConnected).toBe(true)
  })

  it('late decoration without streaming phase: text present from the start still stays visible', () => {
    const stack = a2.querySelector('.flex') as HTMLElement
    const text = el('div', 'qf-markdown-block')
    text.textContent = 'the final answer'
    stack.appendChild(text)
    // 整轮一次性装饰（例如刷新后）：思考折叠、正文豁免
    decorateProcessBlocks(panel, [user, a1, a2], false)
    expect(insideProcessGroup(text)).toBe(false)
    // thinking 块被搬进组后不再是各 assistant 的后代：按 document 范围断言
    document.querySelectorAll('.qf-thinking-block').forEach((node) => {
      expect(insideProcessGroup(node as HTMLElement)).toBe(true)
    })
  })

  it('final summary survives a DOM node rebuild between streaming and turn end (React remount drops marks)', () => {
    // 流式阶段：text 出现并获豁免
    const stack = a2.querySelector('.flex') as HTMLElement
    const streamingText = el('div', 'qf-markdown-block')
    streamingText.textContent = 'the final answer'
    stack.appendChild(streamingText)
    decorateProcessBlocks(panel, [user, a1, a2], true)
    expect(insideProcessGroup(streamingText)).toBe(false)

    // message_end 后 React 重建该节点（message_end hand-off / remount）：旧豁免标记与 WeakMap 关联全部随旧节点失效
    const rebuiltText = el('div', 'qf-markdown-block')
    rebuiltText.textContent = 'the final answer'
    stack.replaceChild(rebuiltText, streamingText)

    // 回合结束的装饰：新节点必须被重新识别为终答，不得折进组
    decorateProcessBlocks(panel, [user, a1, a2], false)
    expect(insideProcessGroup(rebuiltText)).toBe(false)
    expect(rebuiltText.isConnected).toBe(true)
  })

  it('user bug: empty mark from thinking-only phase must be cleared when final text lands before turn end', () => {
    const stack = a2.querySelector('.flex') as HTMLElement

    // 阶段 1：流式期间 a2 只有 thinking（text 未出现）——thinking 搬进组后 a2 源变空，正确打上 empty
    const a2Thinking = a2.querySelector('.qf-thinking-block') as HTMLElement // 装饰前取引用（搬组后不再是 a2 后代）
    decorateProcessBlocks(panel, [user, a1, a2], true)
    expect(insideProcessGroup(a2Thinking)).toBe(true)
    expect(a2.classList.contains('quickforge-process-source-empty')).toBe(true)

    // 阶段 2：message_end 直接提交完整 text（pi 对 OpenAI 思考后正文无流式 tick——用户实测场景），
    // 且 message_end 与 agent_end 之间没有任何装饰触发
    const text = el('div', 'qf-markdown-block')
    text.textContent = 'the final answer'
    stack.appendChild(text)

    // 阶段 3：agent_end 后的装饰（streaming=false）。终答指纹排除后与阶段 1 匹配 → 走 skip 路径；
    // 修复前：skip 直接 return，empty 残留 → 整行连同终答被 CSS 隐藏；修复后：empty 必须被清除
    decorateProcessBlocks(panel, [user, a1, a2], false)

    expect(a2.classList.contains('quickforge-process-source-empty')).toBe(false)
    expect(insideProcessGroup(text)).toBe(false)
    expect(text.isConnected).toBe(true)
  })
})
