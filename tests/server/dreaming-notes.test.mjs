import { describe, expect, it } from 'vitest'
import {
  MAX_NOTE_LINES,
  MAX_NOTE_LINE_CHARS,
  NOTE_SECTION_TITLE,
  composeAutoSection,
  diffNoteLines,
  normalizeNoteLines,
  parseNoteLines,
} from '../../server/dreaming/notes.mjs'

describe('note parsing', () => {
  it('reads bullets out of an existing auto section', () => {
    const markdown = [
      NOTE_SECTION_TITLE,
      '',
      '- 用户偏好中文交互',
      '- [pitfall] 回滚前先用 git log 确认后续没有改动',
    ].join('\n')
    expect(parseNoteLines(markdown)).toEqual([
      '用户偏好中文交互',
      '[pitfall] 回滚前先用 git log 确认后续没有改动',
    ])
  })

  it('ignores headings, blank lines and fenced code', () => {
    const reply = [
      '## Notes',
      '',
      '- kept',
      '```',
      '- inside a fence',
      '```',
      '* also a bullet',
    ].join('\n')
    expect(parseNoteLines(reply)).toEqual(['kept', 'also a bullet'])
  })

  it('drops fenced code but keeps a plain bullet list', () => {
    expect(parseNoteLines('- 正常\n- 也正常')).toEqual(['正常', '也正常'])
  })
})

describe('note normalization', () => {
  it('trims, dedupes and collapses whitespace', () => {
    const { lines } = normalizeNoteLines('-   重复   空格  \n- 重复 空格\n- 另一条')
    expect(lines).toEqual(['重复 空格', '另一条'])
  })

  it('caps a single note and the total count', () => {
    const long = normalizeNoteLines(`- ${'字'.repeat(MAX_NOTE_LINE_CHARS + 50)}`)
    expect(long.lines[0]).toHaveLength(MAX_NOTE_LINE_CHARS)

    const many = Array.from({ length: MAX_NOTE_LINES + 5 }, (_value, index) => `- note ${index}`).join('\n')
    const result = normalizeNoteLines(many)
    expect(result.lines).toHaveLength(MAX_NOTE_LINES)
    expect(result.dropped.filter((entry) => entry.reason === 'over_limit')).toHaveLength(5)
  })

  it('drops credential-looking notes only when sensitive content is disallowed', () => {
    const reply = '- 令牌是 sk-live-abcdefghijklmnopqrstuvwxyz012345\n- 配置存放在 .env，永不提交'
    expect(normalizeNoteLines(reply, { allowSensitive: true }).lines).toHaveLength(2)
    const filtered = normalizeNoteLines(reply, { allowSensitive: false })
    expect(filtered.lines).toEqual(['配置存放在 .env，永不提交'])
    expect(filtered.dropped).toEqual([{ reason: 'sensitive', content: expect.stringContaining('sk-live') }])
  })

  it('treats prose as no notes instead of inventing any', () => {
    expect(normalizeNoteLines('I could not find anything durable today.').lines).toEqual([])
  })
})

describe('auto section composition', () => {
  it('renders a titled bullet list', () => {
    expect(composeAutoSection(['a', 'b'])).toBe(`${NOTE_SECTION_TITLE}\n\n- a\n- b`)
  })

  it('returns an empty string for an empty list so the section is removed', () => {
    expect(composeAutoSection([])).toBe('')
  })

  it('trims from the tail until the block fits the byte budget', () => {
    const lines = Array.from({ length: MAX_NOTE_LINES }, (_value, index) => `${index} ${'x'.repeat(200)}`)
    const section = composeAutoSection(lines)
    expect(Buffer.byteLength(section, 'utf8')).toBeLessThanOrEqual(3800)
    expect(parseNoteLines(section).length).toBeLessThan(lines.length)
  })
})

describe('note diff', () => {
  it('reports added and removed lines', () => {
    expect(diffNoteLines(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
  })

  it('is empty when the list is unchanged', () => {
    expect(diffNoteLines(['a'], ['a'])).toEqual({ added: [], removed: [] })
  })
})
