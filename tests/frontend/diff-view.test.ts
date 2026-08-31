import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  diffLineNumber,
  parseDiffFileInfo,
  parseDiffRows,
  type DiffLineRow,
} from '../../src/lib/diff-view'

const localTools = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const renderDiffSource = localTools.slice(
  localTools.indexOf('function renderDiffRow'),
  localTools.indexOf('function formatDuration'),
)
const localRendererSource = localTools.slice(
  localTools.indexOf('class LocalWorkspaceToolRenderer'),
  localTools.indexOf('function askUserQuestionsFromParams'),
)
const openCodeRendererSource = localTools.slice(
  localTools.indexOf('class OpenCodeToolRenderer'),
  localTools.indexOf('function parseMcpToolName'),
)

const EDIT_DIFF = [
  '--- a/src/lib/scheduler.ts',
  '+++ b/src/lib/scheduler.ts',
  '@@ -18,4 +18,4 @@',
  '   let running = false;',
  '-  const timer = setInterval(() => tick(), interval);',
  '+  const timer = setInterval(() => void tick(), interval);',
  '   const tick = async () => {',
].join('\n')

describe('parseDiffFileInfo', () => {
  it('extracts path from the +++ header', () => {
    expect(parseDiffFileInfo(EDIT_DIFF)).toEqual({ path: 'src/lib/scheduler.ts', isNewFile: false })
  })

  it('marks /dev/null old side as a new file', () => {
    const text = '--- /dev/null\n+++ b/scripts/prune-cache.mjs\n@@ -0,0 +1,1 @@\n+#!/usr/bin/env node'
    expect(parseDiffFileInfo(text)).toEqual({ path: 'scripts/prune-cache.mjs', isNewFile: true })
  })

  it('returns null without a +++ header', () => {
    expect(parseDiffFileInfo('@@ -1 +1 @@\n-a\n+b')).toBeNull()
  })
})

describe('parseDiffRows', () => {
  it('strips prefixes and keeps old/new numbers for smart single-column selection', () => {
    const rows = parseDiffRows(EDIT_DIFF)
    expect(rows.map((row) => row.kind)).toEqual(['gap', 'ctx', 'del', 'add', 'ctx'])
    expect((rows[1] as DiffLineRow).oldNo).toBe(18)
    expect((rows[1] as DiffLineRow).newNo).toBe(18)
    expect((rows[2] as DiffLineRow).oldNo).toBe(19)
    expect((rows[2] as DiffLineRow).newNo).toBeNull()
    expect((rows[3] as DiffLineRow).oldNo).toBeNull()
    expect((rows[3] as DiffLineRow).newNo).toBe(19)
    expect((rows[2] as DiffLineRow).text).toBe('  const timer = setInterval(() => tick(), interval);')
  })

  it('selects one smart line number by row kind with context fallback', () => {
    expect(diffLineNumber({ kind: 'del', text: 'old', oldNo: 7, newNo: null })).toBe(7)
    expect(diffLineNumber({ kind: 'add', text: 'new', oldNo: null, newNo: 8 })).toBe(8)
    expect(diffLineNumber({ kind: 'ctx', text: 'same', oldNo: 9, newNo: 10 })).toBe(10)
    expect(diffLineNumber({ kind: 'ctx', text: 'fallback', oldNo: 11, newNo: null })).toBe(11)
  })

  it('emits gaps between hunks and keeps numbers continuous', () => {
    const text = [
      '@@ -5,2 +5,2 @@',
      ' a',
      '-b',
      '+B',
      ' c',
      '@@ -12,2 +12,2 @@',
      ' d',
      '-e',
      '+E',
      ' f',
    ].join('\n')
    const rows = parseDiffRows(text)
    expect(rows.filter((row) => row.kind === 'gap')).toEqual([
      { kind: 'gap', count: 4, first: true },
      { kind: 'gap', count: 4, first: false },
    ])
    expect(rows.filter((row) => row.kind !== 'gap').map((row) => (row as DiffLineRow).oldNo))
      .toEqual([5, 6, null, 7, 12, 13, null, 14])
  })

  it('preserves raw text from its first character and numbers new lines from 1', () => {
    expect(parseDiffRows('alpha\nbeta', 'raw')).toEqual([
      { kind: 'add', text: 'alpha', oldNo: null, newNo: 1 },
      { kind: 'add', text: 'beta', oldNo: null, newNo: 2 },
    ])
  })

  it('numbers pseudo-unified +/- lines from 1 when there is no hunk header', () => {
    expect(parseDiffRows('-old\n+new')).toEqual([
      { kind: 'del', text: 'old', oldNo: 1, newNo: null },
      { kind: 'add', text: 'new', oldNo: null, newNo: 1 },
    ])
  })

  it.each(['[diff truncated]', '…[truncated]'])('drops the exact truncation marker %s and trailing separator only when explicitly truncated', (marker) => {
    const rows = parseDiffRows(`@@ -1 +1 @@\n-old\n+new\n\n${marker}`, 'unified', true)
    expect(rows).toEqual([
      { kind: 'del', text: 'old', oldNo: 1, newNo: null },
      { kind: 'add', text: 'new', oldNo: null, newNo: 1 },
    ])
  })

  it('drops the exact OpenCode marker from long diff parse rows when explicitly truncated', () => {
    const rows = parseDiffRows(`alpha\n${'x'.repeat(20_000).slice(0, 16 * 1024 - 6)}\n…[truncated]`, 'raw', true)
    expect(rows[0]).toEqual({ kind: 'add', text: 'alpha', oldNo: null, newNo: 1 })
    expect(rows.some((row) => row.kind !== 'gap' && row.text === '…[truncated]')).toBe(false)
  })

  it.each(['[diff truncated]', '…[truncated]'])('preserves exact tail marker %s as raw body text when not truncated', (marker) => {
    expect(parseDiffRows(`alpha\n${marker}`, 'raw', false)).toEqual([
      { kind: 'add', text: 'alpha', oldNo: null, newNo: 1 },
      { kind: 'add', text: marker, oldNo: null, newNo: 2 },
    ])
  })

  it.each(['[diff truncated]', '…[truncated]'])('preserves exact tail marker %s as unified body text when not truncated', (marker) => {
    expect(parseDiffRows(`@@ -1,2 +1,2 @@\n alpha\n ${marker}`, 'unified', false)).toEqual([
      { kind: 'ctx', text: 'alpha', oldNo: 1, newNo: 1 },
      { kind: 'ctx', text: marker, oldNo: 2, newNo: 2 },
    ])
  })

  it('keeps marker-like lines when they are not the exact tail marker', () => {
    expect(parseDiffRows('…[truncated]\nafter', 'raw')).toEqual([
      { kind: 'add', text: '…[truncated]', oldNo: null, newNo: 1 },
      { kind: 'add', text: 'after', oldNo: null, newNo: 2 },
    ])
    expect(parseDiffRows('prefix …[truncated] suffix', 'raw')).toEqual([
      { kind: 'add', text: 'prefix …[truncated] suffix', oldNo: null, newNo: 1 },
    ])
  })

  it('returns no rows for an empty diff', () => {
    expect(parseDiffRows('')).toEqual([])
    expect(parseDiffRows('', 'raw')).toEqual([])
  })
})

describe('diff rendering source contract', () => {
  it('renders static summary counts as separately colored text without badge styling', () => {
    const statsSource = localTools.slice(
      localTools.indexOf('function renderInlineDiffStats'),
      localTools.indexOf('function renderDiffRow'),
    )
    expect(statsSource).toContain('<span class="quickforge-diff-stats-add">+${addedLines}</span>')
    expect(statsSource).toContain('<span class="quickforge-diff-stats-del">−${removedLines}</span>')
    expect(statsSource).not.toContain('quickforge-tool-meta-hover')
    expect(localTools).toContain("typeof candidate.addedLines === 'number' || typeof candidate.removedLines === 'number'")
    expect(localTools).not.toContain('quickforge-diff-counter')
    expect(css).toMatch(/\.quickforge-diff-stats-add\s*\{[^}]*color:/s)
    expect(css).toMatch(/\.quickforge-diff-stats-del\s*\{[^}]*color:/s)
    expect(css).toMatch(/html\.dark \.quickforge-diff-stats-add\s*\{[^}]*color:/s)
    expect(css).toMatch(/html\.dark \.quickforge-diff-stats-del\s*\{[^}]*color:/s)
    const statsCss = css.slice(css.indexOf('.quickforge-diff-stats {'), css.indexOf('.quickforge-diff-view {'))
    expect(statsCss).not.toMatch(/background|border|border-radius|animation/)
  })

  it('renders a body only for complete string text and passes explicit new-file state', () => {
    expect(renderDiffSource).toContain("const hasText = typeof diff.text === 'string'")
    expect(renderDiffSource).toContain("hasText\n        ? diffText !== ''")
    expect(renderDiffSource).toContain('parseDiffRows(diffText, format, Boolean(diff.truncated))')
    expect(localRendererSource).toContain("typeof diff?.text === 'string' ? renderDiff(diff, isNewFile)")
    expect(localRendererSource).toContain('visibleDetails.created === true')
    expect(renderDiffSource).toContain("t('diffNewFile')")
    expect(renderDiffSource).toContain("t('diffNoChanges')")
  })

  it('shows OpenCode summary counts whenever diff data exists', () => {
    expect(openCodeRendererSource).toContain('renderInlineDiffStats(diff)')
    expect(openCodeRendererSource).toContain("typeof diff?.text === 'string' ? renderDiff(diff, isNewFile)")
  })

  it('does not repeat titles, paths, chips, or character-level marks', () => {
    expect(renderDiffSource).not.toContain('<span>Diff</span>')
    expect(renderDiffSource).not.toContain('quickforge-diff-path')
    expect(renderDiffSource).not.toContain('quickforge-diff-badge')
    expect(renderDiffSource).not.toContain('<mark>')
  })

  it('renders one smart line-number cell and a gap with only a visible ellipsis', () => {
    const rowTemplate = renderDiffSource.slice(
      renderDiffSource.indexOf('function renderDiffRow'),
      renderDiffSource.indexOf('function renderDiff('),
    )
    expect(rowTemplate.match(/class="quickforge-diff-ln"/g)).toHaveLength(1)
    expect(rowTemplate).toContain('${diffLineNumber(row) ?? \'\'}')
    expect(rowTemplate).not.toContain('${row.oldNo')
    expect(rowTemplate).not.toContain('${row.newNo')
    expect(rowTemplate).toContain("aria-label=${t('diffOmittedLines', { count: row.count })}")
    expect(rowTemplate).toContain('>⋯</div>')
    expect(rowTemplate).not.toContain('quickforge-diff-gap-dots')
    expect(rowTemplate).not.toContain("<span>${t('diffOmittedLines'")
    expect(rowTemplate).not.toContain('aria-hidden="true"')
  })

  it('uses short state copy in both locales', () => {
    expect(localTools).toContain("t('diffNewFile')")
    expect(localTools).toContain("t('diffTruncated')")
    expect(localTools).toContain("t('diffNoChanges')")
    const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
    expect(i18n).toContain("diffNewFile: 'new file'")
    expect(i18n).toContain("diffTruncated: 'truncated'")
    expect(i18n).toContain("diffNoChanges: 'no changes'")
    expect(i18n).toContain("diffNewFile: '新文件'")
    expect(i18n).toContain("diffTruncated: '已截断'")
    expect(i18n).toContain("diffNoChanges: '无变化'")
  })

  it('keeps the two-column shared grid, display:contents rows, and long-line background model', () => {
    expect(css).toMatch(/\.quickforge-diff-block\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*3\.1rem minmax\(max-content, 1fr\)/s)
    expect(css).not.toMatch(/grid-template-columns:\s*3\.1rem 3\.1rem/)
    expect(css).toMatch(/\.quickforge-diff-row\s*\{[^}]*display:\s*contents/s)
    expect(css).toMatch(/\.quickforge-diff-row-add \.quickforge-diff-code\s*\{[^}]*background:/s)
    expect(css).toMatch(/\.quickforge-diff-gap\s*\{[^}]*grid-column:\s*1 \/ -1/s)
    expect(css).not.toContain('.quickforge-diff-code mark')
  })
})
