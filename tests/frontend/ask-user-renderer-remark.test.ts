import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * ask_user 历史回执的**真实渲染**覆盖（不是源码字符串断言）。
 *
 * 用户提问卡提交后，工具消息折叠卡展开时沿用回执行布局；确认步填过的
 * 「补充信息」必须以独立末行回显，且不能混进任何单题答案里。
 */

const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  applyAppLanguageFromSnapshot: () => {},
}))

import { AskUserToolRenderer, askUserReviewRowsFromDetails } from '../../src/lib/tool-renderers/ask-user-tool-renderer'
import type { ReactElement } from 'react'

const questions = [
  { question: '方向？', multiSelect: false, allowCustom: true, options: [{ label: 'A' }, { label: 'B' }] },
  { question: '哪些端？', multiSelect: true, allowCustom: true, options: [{ label: 'npm' }, { label: 'Desktop' }] },
]

const params = { questions }

function render(details: Record<string, unknown> | undefined, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const result = details === undefined
    ? { role: 'toolResult', content: [{ type: 'text', text: '' }], toolCallId: 'c1', toolName: 'ask_user', timestamp: 0 }
    : { role: 'toolResult', content: [{ type: 'text', text: '' }], toolCallId: 'c1', toolName: 'ask_user', timestamp: 0, details }
  const rendered = new AskUserToolRenderer().render(params as Record<string, unknown>, result as never, false)
  return renderToStaticMarkup(rendered.content as ReactElement)
}

describe('ask_user history receipt renders the review-step note', () => {
  it('shows the note as its own trailing dashed row', () => {
    const markup = render({
      askId: 'a1',
      questions,
      answers: [{ choices: ['A'] }, { choices: ['npm'] }],
      skipped: false,
      remark: '先只动前端，别碰 dist',
    })

    // 逐题答案照旧
    expect(markup).toContain('1. 方向？')
    expect(markup).toContain('2. 哪些端？')
    // 补充信息独立成行：标签 + 内容 + 虚线行 class
    expect(markup).toContain('quickforge-ask-review-row--remark')
    expect(markup).toContain('askUserRemarkLabel')
    expect(markup).toContain('先只动前端，别碰 dist')
    // 不能混进单题答案文本（避免「A + 补充：…」这种错位）
    expect(markup).not.toContain('A\u3000\u8865\u5145\uff1a\u5148\u53ea\u52a8\u524d\u7aef')
    // 补充行必须出现在所有问答行之后
    expect(markup.indexOf('2. 哪些端？')).toBeLessThan(markup.indexOf('quickforge-ask-review-row--remark'))
  })

  it('omits the row when the user left the note empty', () => {
    const markup = render({
      askId: 'a1',
      questions,
      answers: [{ choices: ['A'] }, { choices: ['npm'] }],
      skipped: false,
    })
    expect(markup).not.toContain('quickforge-ask-review-row--remark')
    expect(markup).not.toContain('askUserRemarkLabel')
  })

  it('keeps the note visible for a skipped ask', () => {
    // 跳过态也回显补充信息：那是用户唯一留下的自由文本，不能因为 skipped 丢掉。
    const markup = render({
      askId: 'a1',
      questions,
      answers: [],
      skipped: true,
      skipReason: 'timeout',
      remark: '这段现在会出现',
    })
    expect(markup).toContain('这段现在会出现')
    expect(markup).toContain('quickforge-ask-review-row--remark')
    expect(markup).toContain('askUserSkipReasonTimeout')
    // 跳过态的问答行带上自己的行标记
    expect(markup).toContain('quickforge-ask-review-row--skipped')
  })

  it('still renders the receipt when the server persisted answers: null', () => {
    // 服务端跳过/超时路径写的是 answers: null；旧实现会因此退回原始问题清单，
    // 跳过原因和备注就一起丢了。
    const markup = render({
      askId: 'a1',
      questions,
      answers: null,
      skipped: true,
      skipReason: 'timeout',
      remark: '超时前我写了这句',
    })
    expect(markup).toContain('1. 方向？')
    expect(markup).toContain('askUserSkipReasonTimeout')
    expect(markup).toContain('超时前我写了这句')
    expect(markup).toContain('quickforge-ask-review-row')
    // 不能再退回「原始问题清单」回退视图
    expect(markup).not.toContain('quickforge-ask-tool-questions')
  })

  it('renders a custom-only answer as its own note block, not one joined line', () => {
    const markup = render({
      askId: 'a1',
      questions,
      answers: [{ custom: '只要最小改动' }, { choices: ['npm'], custom: '别碰 dist' }],
      skipped: false,
    })
    // 没选选项时明说「未选择选项」，而不是把补充文本当成答案
    expect(markup).toContain('quickforge-ask-answer-empty')
    expect(markup).toContain('askUserNoChoiceLabel')
    // 补充文本单独成块，带自己的标签
    expect(markup).toContain('quickforge-ask-answer-extra')
    expect(markup).toContain('askUserExtraLabel')
    expect(markup).toContain('只要最小改动')
    expect(markup).toContain('别碰 dist')
    // 选项渲染成 chip
    expect(markup).toContain('quickforge-ask-answer-chip')
    expect(markup).toContain('npm')
    // 旧的「选项 + 全角空格 + 补充：…」拼接串必须消失
    expect(markup).not.toContain('npm\u3000\u8865\u5145\uff1a\u522b\u78b0 dist')
  })

  it('omits the note block when the answer is choices only', () => {
    const markup = render({
      askId: 'a1',
      questions,
      answers: [{ choices: ['A'] }],
      skipped: false,
    })
    expect(markup).toContain('quickforge-ask-answer-chip')
    expect(markup).not.toContain('quickforge-ask-answer-extra')
  })

  it('keeps detailed mode on the raw view (no receipt rows at all)', () => {
    const markup = render({
      askId: 'a1',
      questions,
      answers: [{ choices: ['A'] }],
      skipped: false,
      remark: '先只动前端',
    }, true)
    expect(markup).not.toContain('quickforge-ask-review-row')
  })

  it('trims the persisted note and ignores non-string values', () => {
    expect(askUserReviewRowsFromDetails({ questions, answers: [], remark: '  前后空白  ' })?.remark).toBe('前后空白')
    expect(askUserReviewRowsFromDetails({ questions, answers: [], remark: '   ' })?.remark).toBeUndefined()
    expect(askUserReviewRowsFromDetails({ questions, answers: [], remark: 42 })?.remark).toBeUndefined()
  })
})
