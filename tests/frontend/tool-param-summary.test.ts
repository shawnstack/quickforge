import { describe, expect, it } from 'vitest'
import { normalizeToolArguments, summarizeParams } from '../../src/lib/tool-param-summary'

describe('summarizeParams', () => {
  it('returns the command for run_command as one collapsed line', () => {
    expect(summarizeParams('run_command', { command: 'npm   run\ntest' })).toBe('npm run test')
  })

  it('prefers the description for run_command when provided', () => {
    expect(summarizeParams('run_command', { command: 'npm run test', description: '跑测试' })).toBe('跑测试')
    expect(summarizeParams('run_command', { command: 'npm run test', description: ' 跑\n测试 ' })).toBe('跑 测试')
  })

  it('falls back to the command when the run_command description is blank', () => {
    expect(summarizeParams('run_command', { command: 'npm run test', description: '   ' })).toBe('npm run test')
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

  it('joins every present_files path without an overflow count', () => {
    expect(summarizeParams('present_files', { files: ['a.html', 'b.md', 'c.ts', 'd.css', 'e.txt'] }))
      .toBe('a.html, b.md, c.ts, d.css, e.txt')
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
