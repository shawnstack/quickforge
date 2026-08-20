/**
 * write_file / edit_file 工具 unified diff 的结构化解析：
 * 行号（old/new 双侧）、hunk 间隙省略行、配对删/加行的字符级变化段。
 * 纯函数、零 DOM 依赖，renderDiff 消费其结果（设计稿见 design-mockups/diff-display-optimization.html）。
 */

export type DiffLineKind = 'ctx' | 'add' | 'del'

export interface DiffSegment {
  text: string
  changed: boolean
}

export interface DiffLineRow {
  kind: DiffLineKind
  /** 已剥离 +/-/空格前缀的行内容 */
  text: string
  oldNo: number | null
  newNo: number | null
  /** 仅配对成功的删/加行携带；段拼接还原 text，changed 段用加重底色渲染 */
  segments?: DiffSegment[]
}

export interface DiffGapRow {
  kind: 'gap'
  /** 间隙内未展示的未变更行数（由相邻 hunk 头行号差计算） */
  count: number
  /** 文件首个 hunk 之前的省略行（无上边框） */
  first: boolean
}

export type DiffRow = DiffLineRow | DiffGapRow

export interface DiffFileInfo {
  path: string
  isNewFile: boolean
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
/** token 数乘积超过上限时放弃细粒度对比、整行视为变化，避免长行 O(n*m) 表阻塞主线程 */
const MAX_TOKEN_PAIRS = 40000

export function parseDiffFileInfo(diffText: string): DiffFileInfo | null {
  const newMatch = /^\+\+\+ b\/(.+)$/m.exec(diffText)
  if (!newMatch?.[1]) return null
  const oldMatch = /^--- (?:a\/(.+)|\/dev\/null)$/m.exec(diffText)
  return {
    path: newMatch[1],
    isNewFile: oldMatch !== null && oldMatch[1] === undefined,
  }
}

export function parseDiffRows(diffText: string): DiffRow[] {
  const lines = diffText.split('\n')
  // 末尾换行产生的空元素不渲染，避免多出一行带行号的空行
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  const rows: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let prevOldEnd = 0
  let sawContent = false
  let firstHunk = true

  for (const raw of lines) {
    if (raw.startsWith('--- ') || raw.startsWith('+++ ')) continue
    const hunk = HUNK_HEADER_RE.exec(raw)
    if (hunk) {
      const oldStart = Number.parseInt(hunk[1] ?? '1', 10)
      const gap = oldStart - prevOldEnd - 1
      if (gap > 0) rows.push({ kind: 'gap', count: gap, first: firstHunk && !sawContent })
      oldNo = oldStart
      newNo = Number.parseInt(hunk[2] ?? '1', 10)
      firstHunk = false
      continue
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw.slice(1), oldNo: null, newNo: newNo++ })
    } else if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw.slice(1), oldNo: oldNo++, newNo: null })
    } else {
      rows.push({ kind: 'ctx', text: raw.length > 0 ? raw.slice(1) : raw, oldNo: oldNo++, newNo: newNo++ })
    }
    prevOldEnd = oldNo - 1
    sawContent = true
  }

  annotateDiffPairs(rows)
  return rows
}

/** 相邻的删块与紧随的加块按位置配对，逐行做 token 级对比；未配对的行保持整行底色 */
function annotateDiffPairs(rows: DiffRow[]) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.kind !== 'del') continue
    let j = i
    const dels: DiffLineRow[] = []
    const adds: DiffLineRow[] = []
    while (rows[j]?.kind === 'del') dels.push(rows[j++] as DiffLineRow)
    while (rows[j]?.kind === 'add') adds.push(rows[j++] as DiffLineRow)
    const pairs = Math.min(dels.length, adds.length)
    for (let k = 0; k < pairs; k++) {
      const del = dels[k] as DiffLineRow
      const add = adds[k] as DiffLineRow
      const a = tokenizeDiffLine(del.text)
      const b = tokenizeDiffLine(add.text)
      const { aMarks, bMarks } = markTokenChanges(a, b)
      del.segments = toSegments(a, aMarks)
      add.segments = toSegments(b, bMarks)
    }
    i = j - 1
  }
}

/** 单词 + 空白 + 单符号三分段，保证缩进与标点独立成 token */
export function tokenizeDiffLine(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9_$]+|./gu) ?? []
}

/** token LCS：返回两侧"是否变化"标记（false 为公共子序列） */
export function markTokenChanges(a: string[], b: string[]): { aMarks: boolean[]; bMarks: boolean[] } {
  const aMarks = new Array<boolean>(a.length).fill(true)
  const bMarks = new Array<boolean>(b.length).fill(true)
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_TOKEN_PAIRS) {
    return { aMarks, bMarks }
  }
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j]
        ? (dp[i + 1]![j + 1] ?? 0) + 1
        : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0)
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      aMarks[i] = false
      bMarks[j] = false
      i++
      j++
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      i++
    } else {
      j++
    }
  }
  return { aMarks, bMarks }
}

/** 相邻同标记 token 合并为段，段拼接还原原文 */
function toSegments(tokens: string[], marks: boolean[]): DiffSegment[] {
  const segments: DiffSegment[] = []
  let current: DiffSegment | undefined
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k] ?? ''
    if (current && current.changed === marks[k]) current.text += token
    else {
      current = { text: token, changed: marks[k] ?? true }
      segments.push(current)
    }
  }
  return segments
}
