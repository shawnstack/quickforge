import { describe, expect, it } from 'vitest'
import {
  ASK_TIMEOUT_MS,
  getPendingAskForSession,
  pendingAsks,
  normalizeAskQuestions,
  formatAskResult,
} from '../../server/ask-store.mjs'

describe('normalizeAskQuestions', () => {
  it('normalizes the canonical questions array', () => {
    const questions = normalizeAskQuestions({
      questions: [
        {
          question: '发布流程遇到测试失败时怎么处理？',
          options: [
            { label: '先修复再发布', description: '阻塞发布' },
            { label: '跳过失败用例继续' },
          ],
        },
        { question: '需要覆盖哪些端？', multiSelect: true, options: [{ label: 'npm' }, { label: 'Desktop' }] },
      ],
    })
    expect(questions).toEqual([
      {
        question: '发布流程遇到测试失败时怎么处理？',
        multiSelect: false,
        allowCustom: true,
        options: [
          { label: '先修复再发布', description: '阻塞发布' },
          { label: '跳过失败用例继续' },
        ],
      },
      { question: '需要覆盖哪些端？', multiSelect: true, allowCustom: true, options: [{ label: 'npm' }, { label: 'Desktop' }] },
    ])
  })

  it('accepts the single-question shorthand', () => {
    expect(normalizeAskQuestions({ question: '继续吗？', options: [{ label: '是' }, { label: '否' }] }))
      .toEqual([{ question: '继续吗？', multiSelect: false, allowCustom: true, options: [{ label: '是' }, { label: '否' }] }])
  })

  it('caps at 4 questions and 4 options, drops empty entries', () => {
    const questions = normalizeAskQuestions({
      questions: [
        ...Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, options: [{ label: `o${i}` }] })),
        { question: '   ' },
        null,
      ],
    })
    expect(questions).toHaveLength(4)
    expect(normalizeAskQuestions({ question: 'x', options: [{ label: 'a' }, { label: ' ' }, null, { label: 'b' }] })[0].options)
      .toEqual([{ label: 'a' }, { label: 'b' }])
  })

  it('honors allowCustom=false', () => {
    expect(normalizeAskQuestions({ question: 'x', allowCustom: false })[0].allowCustom).toBe(false)
  })

  it('returns empty for invalid input', () => {
    expect(normalizeAskQuestions(undefined)).toEqual([])
    expect(normalizeAskQuestions({})).toEqual([])
    expect(normalizeAskQuestions({ questions: [] })).toEqual([])
  })
})

describe('formatAskResult', () => {
  const questions = normalizeAskQuestions({
    questions: [
      { question: '方向？', options: [{ label: 'A' }, { label: 'B' }] },
      { question: '哪些端？', options: [{ label: 'npm' }, { label: 'Desktop' }] },
    ],
  })

  it('formats choices and custom supplements per question', () => {
    const text = formatAskResult(questions, [{ choices: ['A'] }, { choices: ['npm', 'Desktop'], custom: '桌面先不发' }], false)
    expect(text).toBe('用户的回答：\n1. 方向？ → A\n2. 哪些端？ → npm、Desktop　补充：桌面先不发')
  })

  it('marks unanswered questions', () => {
    const text = formatAskResult(questions, [{ custom: '我自己的想法' }], false)
    expect(text).toContain('2. 哪些端？ → 用户未回答')
    expect(text).toContain('1. 方向？ → 我自己的想法')
  })

  it('renders skip variants with a reason and a continue instruction', () => {
    for (const reason of ['timeout', 'aborted', 'no-questions', undefined]) {
      const text = formatAskResult(questions, null, true, reason)
      expect(text).toContain('用户没有回答这些问题')
      expect(text).toContain('请按你的默认方案继续')
    }
    expect(formatAskResult(questions, null, true, 'timeout')).toContain('等待超时')
  })
})

describe('pendingAsks store', () => {
  it('exposes the pending ask for its session only', () => {
    pendingAsks.set('ask-1', { sessionId: 's1', toolCallId: 't1', questions: [], requestedAt: 1, expiresAt: 2 })
    pendingAsks.set('ask-2', { sessionId: 's2', toolCallId: 't2', questions: [], requestedAt: 3, expiresAt: 4 })
    expect(getPendingAskForSession('s1')).toMatchObject({ askId: 'ask-1', toolCallId: 't1' })
    expect(getPendingAskForSession('s3')).toBeNull()
    pendingAsks.clear()
  })

  it('uses a generous 30-minute timeout', () => {
    expect(ASK_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })
})
