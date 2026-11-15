import { describe, expect, it } from 'vitest'
import { normalizeCommitMessage } from '../../../server/routes/workspace-git-service.mjs'

// 提交信息超长时曾经 `.slice(0, 4000)`：尾巴被悄悄截掉，git 历史里留下的和用户写的
// 不是同一段文字，界面上也没有任何提示。这类「静默丢数据」改成报错，让用户自己决定怎么缩短。
describe('normalizeCommitMessage', () => {
  it('超长提交信息报 400，并把实际长度报出来', () => {
    let outcome
    try {
      outcome = normalizeCommitMessage('a'.repeat(4100))
    } catch (error) {
      outcome = error
    }
    expect(outcome).toBeInstanceOf(Error)
    expect(outcome.statusCode).toBe(400)
    expect(outcome.message).toContain('4100')
  })

  it('正好 4000 字符原样通过，一个字都不动', () => {
    const message = 'b'.repeat(4000)
    expect(normalizeCommitMessage(message)).toBe(message)
  })

  it('CRLF 归一化成 LF 的既有行为不变', () => {
    expect(normalizeCommitMessage('标题\r\n\r\n正文\r结束')).toBe('标题\n\n正文\n结束')
  })

  it('空信息仍然报 400', () => {
    let outcome
    try {
      outcome = normalizeCommitMessage('   ')
    } catch (error) {
      outcome = error
    }
    expect(outcome).toBeInstanceOf(Error)
    expect(outcome.statusCode).toBe(400)
  })
})
