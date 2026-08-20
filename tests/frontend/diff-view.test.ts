import { describe, expect, it } from 'vitest'
import {
  markTokenChanges,
  parseDiffFileInfo,
  parseDiffRows,
  tokenizeDiffLine,
  type DiffLineRow,
} from '../../src/lib/diff-view'

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
  it('strips prefixes and assigns dual line numbers', () => {
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

  it('emits a first gap from the file head to the first hunk', () => {
    const gap = parseDiffRows(EDIT_DIFF)[0]
    expect(gap).toEqual({ kind: 'gap', count: 17, first: true })
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
    const lineNumbers = rows
      .filter((row) => row.kind !== 'gap')
      .map((row) => (row as DiffLineRow).oldNo)
    expect(lineNumbers).toEqual([5, 6, null, 7, 12, 13, null, 14])
  })

  it('omits a leading gap when the hunk starts at line 1', () => {
    const rows = parseDiffRows('@@ -1,2 +1,2 @@\n a\n-b\n+B')
    expect(rows[0]?.kind).toBe('ctx')
  })

  it('drops the trailing empty line from a final newline', () => {
    const rows = parseDiffRows('@@ -1 +1 @@\n a\n')
    expect(rows).toHaveLength(1)
  })

  it('keeps empty context lines as rows', () => {
    const rows = parseDiffRows('@@ -1,2 +1,2 @@\n \n x')
    expect((rows[0] as DiffLineRow).text).toBe('')
    expect((rows[0] as DiffLineRow).oldNo).toBe(1)
  })

  it('renders an empty diff as a single empty context row', () => {
    expect(parseDiffRows('')).toEqual([{ kind: 'ctx', text: '', oldNo: 0, newNo: 0 }])
  })
})

describe('character-level pairing', () => {
  it('marks only the changed tokens on paired del/add rows', () => {
    const rows = parseDiffRows(EDIT_DIFF)
    const del = rows[2] as DiffLineRow
    const add = rows[3] as DiffLineRow
    const delChanged = (del.segments ?? []).filter((segment) => segment.changed).map((segment) => segment.text).join('')
    const addChanged = (add.segments ?? []).filter((segment) => segment.changed).map((segment) => segment.text).join('')
    expect(addChanged.replace(/\s/g, '')).toBe('void')
    expect(delChanged).toBe('')
    // Segments reconstruct the full line text
    expect((del.segments ?? []).map((segment) => segment.text).join('')).toBe(del.text)
    expect((add.segments ?? []).map((segment) => segment.text).join('')).toBe(add.text)
    // Unchanged parts include the shared call expression
    expect(add.segments?.some((segment) => !segment.changed && segment.text.includes('setInterval'))).toBe(true)
  })

  it('pairs the minimum of adjacent del/add block sizes', () => {
    const text = ['@@ -1,3 +1,2 @@', '-a', '-b', '+A', ' c'].join('\n')
    const rows = parseDiffRows(text)
    const paired = rows.filter((row) => (row as DiffLineRow).segments !== undefined)
    // Only -a/+A are paired; -b has no counterpart and keeps full-line rendering
    expect(paired.map((row) => row.kind)).toEqual(['del', 'add'])
    const unpairedDel = rows.find((row) => row.kind === 'del' && (row as DiffLineRow).oldNo === 2) as DiffLineRow
    expect(unpairedDel.segments).toBeUndefined()
  })

  it('marks whole lines as changed when tokens exceed the fallback limit', () => {
    const a = new Array(300).fill('x')
    const b = new Array(200).fill('y')
    const { aMarks, bMarks } = markTokenChanges(a, b)
    expect(aMarks.every(Boolean)).toBe(true)
    expect(bMarks.every(Boolean)).toBe(true)
  })

  it('marks everything as changed against an empty side', () => {
    const { aMarks } = markTokenChanges(tokenizeDiffLine('abc'), [])
    expect(aMarks.every(Boolean)).toBe(true)
  })
})

describe('tokenizeDiffLine', () => {
  it('splits words, whitespace runs, and single symbols', () => {
    expect(tokenizeDiffLine('if (running || disposed)')).toEqual([
      'if', ' ', '(', 'running', ' ', '|', '|', ' ', 'disposed', ')',
    ])
  })

  it('returns an empty list for empty text', () => {
    expect(tokenizeDiffLine('')).toEqual([])
  })
})
