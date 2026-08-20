import { describe, expect, it } from 'vitest'
import { normalizeToolArguments, summarizeParams, truncateSummary } from '../../src/lib/tool-param-summary'

describe('summarizeParams', () => {
  it('returns the command for run_command', () => {
    expect(summarizeParams('run_command', { command: 'npm run test' })).toBe('npm run test')
  })

  it('prefers the path field when present', () => {
    expect(summarizeParams('read_file', { path: 'src/lib/foo.ts' })).toBe('src/lib/foo.ts')
    expect(summarizeParams('write_file', { path: 'docs/README.md' })).toBe('docs/README.md')
  })

  it('falls back to query and search_query fields', () => {
    expect(summarizeParams('custom_tool', { query: 'quickforge' })).toBe('quickforge')
    expect(summarizeParams('custom_tool', { search_query: 'marquee' })).toBe('marquee')
  })

  it('formats grep_files with mode and scope', () => {
    expect(summarizeParams('grep_files', { query: 'tool', path: 'src' })).toBe('text: tool in src')
    expect(summarizeParams('grep_files', { query: 'tool', path: 'src', regex: true })).toBe('regex: tool in src')
    expect(summarizeParams('grep_files', { query: 'tool' })).toBe('text: tool in current workspace')
  })

  it('reads query/path from result details when params lack them', () => {
    expect(summarizeParams('grep_files', undefined, { details: { query: 'from-details', path: 'server' } }))
      .toBe('text: from-details in server')
  })

  it('joins up to three present_files paths with overflow count', () => {
    expect(summarizeParams('present_files', { files: ['a.html', 'b.md', 'c.ts', 'd.css', 'e.txt'] }))
      .toBe('a.html, b.md, c.ts +2')
  })

  it('returns an empty string without params or details', () => {
    expect(summarizeParams('read_file', undefined)).toBe('')
  })
})

describe('normalizeToolArguments', () => {
  it('passes through record values', () => {
    expect(normalizeToolArguments({ path: 'a.ts' })).toEqual({ path: 'a.ts' })
  })

  it('parses JSON string arguments', () => {
    expect(normalizeToolArguments('{"command":"npm test"}')).toEqual({ command: 'npm test' })
  })

  it('rejects invalid inputs', () => {
    expect(normalizeToolArguments('not json')).toBeUndefined()
    expect(normalizeToolArguments('')).toBeUndefined()
    expect(normalizeToolArguments(42)).toBeUndefined()
    expect(normalizeToolArguments('[1,2]')).toBeUndefined()
  })
})

describe('truncateSummary', () => {
  it('keeps short text unchanged', () => {
    expect(truncateSummary('npm test', 80)).toBe('npm test')
  })

  it('truncates long text with an ellipsis', () => {
    const long = 'a'.repeat(120)
    expect(truncateSummary(long, 80)).toBe(`${'a'.repeat(80)}…`)
  })

  it('handles non-positive limits', () => {
    expect(truncateSummary('abc', 0)).toBe('')
  })
})
