import { describe, it, expect } from 'vitest'
import { createTextDiff } from '../../../server/utils/text-diff.mjs'

describe('createTextDiff', () => {
  it('returns an empty diff for identical text', () => {
    const result = createTextDiff('hello\nworld', 'hello\nworld', 'test.txt')
    expect(result.addedLines).toBe(0)
    expect(result.removedLines).toBe(0)
    expect(result.oldLineCount).toBe(2)
    expect(result.newLineCount).toBe(2)
    expect(result.text).toBe('')
    expect(result.format).toBe('unified')
    expect(result.path).toBe('test.txt')
  })

  it('detects a single line addition', () => {
    const result = createTextDiff('hello\n', 'hello\nworld\n', 'test.txt')
    expect(result.addedLines).toBe(1)
    expect(result.removedLines).toBe(0)
    expect(result.oldLineCount).toBe(1)
    expect(result.newLineCount).toBe(2)
    expect(result.text).toContain('+world')
    expect(result.text).toContain('@@')
  })

  it('detects a single line deletion', () => {
    const result = createTextDiff('hello\nworld\n', 'hello\n', 'test.txt')
    expect(result.addedLines).toBe(0)
    expect(result.removedLines).toBe(1)
    expect(result.oldLineCount).toBe(2)
    expect(result.newLineCount).toBe(1)
    expect(result.text).toContain('-world')
  })

  it('detects a line change', () => {
    const result = createTextDiff('hello\nworld\n', 'hello\nearth\n', 'test.txt')
    expect(result.addedLines).toBe(1)
    expect(result.removedLines).toBe(1)
    expect(result.text).toContain('-world')
    expect(result.text).toContain('+earth')
  })

  it('handles empty old text', () => {
    const result = createTextDiff('', 'new\ncontent\n', 'new.txt')
    expect(result.addedLines).toBe(2)
    expect(result.removedLines).toBe(0)
    expect(result.oldLineCount).toBe(0)
    expect(result.newLineCount).toBe(2)
  })

  it('handles empty new text', () => {
    const result = createTextDiff('old\ncontent\n', '', 'old.txt')
    expect(result.addedLines).toBe(0)
    expect(result.removedLines).toBe(2)
    expect(result.oldLineCount).toBe(2)
    expect(result.newLineCount).toBe(0)
  })

  it('handles both old and new being empty', () => {
    const result = createTextDiff('', '', 'empty.txt')
    expect(result.addedLines).toBe(0)
    expect(result.removedLines).toBe(0)
    expect(result.text).toBe('')
  })

  it('uses /dev/null when oldExists is false', () => {
    const result = createTextDiff('', 'new\n', 'brand-new.txt', { oldExists: false })
    expect(result.text).toContain('--- /dev/null')
    expect(result.text).toContain('+++ b/brand-new.txt')
  })

  it('uses a/ prefix for old and b/ prefix for new by default', () => {
    const result = createTextDiff('old\n', 'new\n', 'file.txt')
    expect(result.text).toContain('--- a/file.txt')
    expect(result.text).toContain('+++ b/file.txt')
  })

  it('produces unified diff format with @@ hunk headers', () => {
    const result = createTextDiff('line1\nline2\nline3\n', 'line1\nmodified\nline3\n', 'f.txt')
    expect(result.text).toMatch(/@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/)
  })

  it('includes context lines around changes', () => {
    const oldText = 'a\nb\nc\nd\ne\nf\ng\n'
    const newText = 'a\nb\nC\nd\ne\nf\ng\n'
    const result = createTextDiff(oldText, newText, 'ctx.txt', { contextLines: 2 })
    // "c" is on line 3, changed to "C". With 2 context lines, we expect lines 1-5 visible.
    expect(result.text).toContain(' a')
    expect(result.text).toContain(' b')
    expect(result.text).toContain('-c')
    expect(result.text).toContain('+C')
    expect(result.text).toContain(' d')
  })

  it('respects contextLines = 0', () => {
    const oldText = 'a\nb\nc\nd\ne\n'
    const newText = 'a\nb\nC\nd\ne\n'
    const result = createTextDiff(oldText, newText, 'no-ctx.txt', { contextLines: 0 })
    const lines = result.text.split('\n')
    // Only the changed line and hunk header, no context
    expect(lines.some((l) => l === '-c')).toBe(true)
    expect(lines.some((l) => l === '+C')).toBe(true)
    expect(lines.some((l) => l === ' b')).toBe(false)
    expect(lines.some((l) => l === ' d')).toBe(false)
  })

  it('truncates output when maxChars is exceeded', () => {
    const longLine = 'x'.repeat(500) + '\n'
    const oldText = longLine.repeat(200)
    const newText = longLine.repeat(200).replace(/x/, 'y')
    const result = createTextDiff(oldText, newText, 'big.txt', { maxChars: 500 })
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('[diff truncated]')
  })

  it('truncates output when maxLines is exceeded', () => {
    const oldText = Array.from({ length: 500 }, (_, i) => `old-${i}`).join('\n')
    const newText = Array.from({ length: 500 }, (_, i) => `new-${i}`).join('\n')
    const result = createTextDiff(oldText, newText, 'many.txt', { maxLines: 50 })
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('[diff truncated]')
  })

  it('normalizes \\r\\n line endings', () => {
    const result = createTextDiff('hello\r\nworld\r\n', 'hello\r\nearth\r\n', 'crlf.txt')
    expect(result.addedLines).toBe(1)
    expect(result.removedLines).toBe(1)
  })

  it('handles multiple non-adjacent changes', () => {
    const oldText = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n'
    const newText = 'a\nB\nc\nd\ne\nf\nG\nh\ni\nj\n'
    const result = createTextDiff(oldText, newText, 'multi.txt')
    expect(result.addedLines).toBe(2)
    expect(result.removedLines).toBe(2)
    expect(result.text).toContain('-b')
    expect(result.text).toContain('+B')
    expect(result.text).toContain('-g')
    expect(result.text).toContain('+G')
  })

  it('merges close hunks when their context overlaps', () => {
    const oldText = 'a\nb\nc\n'
    const newText = 'A\nB\nC\n'
    const result = createTextDiff(oldText, newText, 'overlap.txt', { contextLines: 3 })
    // All changes are within 3 lines of each other, should produce a single hunk
    const hunkCount = (result.text.match(/@@/g) || []).length
    expect(hunkCount).toBe(2) // 2 occurrences per hunk header (@@ ... @@)
  })

  it('returns correct line counts', () => {
    const oldText = 'line1\nline2\nline3\n'
    const newText = 'line1\nline2\nline3\nline4\nline5\n'
    const result = createTextDiff(oldText, newText, 'grow.txt')
    expect(result.oldLineCount).toBe(3)
    expect(result.newLineCount).toBe(5)
  })
})
