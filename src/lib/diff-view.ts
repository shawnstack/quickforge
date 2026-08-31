/**
 * write_file / edit_file 工具 diff 的结构化解析：
 * 支持 unified（含无 hunk 的 OpenCode pseudo-unified）与 raw 新文件文本，
 * 输出 old/new 解析行号（渲染时按行类型选择单列智能行号）及 hunk 间隙省略行。
 * 纯函数、零 DOM 依赖，renderDiff 消费其结果。
 */

export type DiffLineKind = 'ctx' | 'add' | 'del'
export type DiffTextFormat = 'unified' | 'raw'

export interface DiffLineRow {
  kind: DiffLineKind
  /** 已剥离 +/-/空格前缀的行内容 */
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface DiffGapRow {
  kind: 'gap'
  /** 间隙内未展示的未变更行数（由相邻 hunk 头行号差计算） */
  count: number
  /** 文件首个 hunk 之前的省略行（无上边框） */
  first: boolean
}

export type DiffRow = DiffLineRow | DiffGapRow

/** 单列行号：删除取旧侧，新增取新侧，上下文优先新侧并防御性回退旧侧。 */
export function diffLineNumber(row: DiffLineRow): number | null {
  if (row.kind === 'del') return row.oldNo
  if (row.kind === 'add') return row.newNo
  return row.newNo ?? row.oldNo
}

export interface DiffFileInfo {
  path: string
  isNewFile: boolean
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/
const DIFF_TRUNCATED_MARKERS = new Set(['[diff truncated]', '…[truncated]'])

function isDiffTruncatedMarker(line: string) {
  return DIFF_TRUNCATED_MARKERS.has(line)
}

export function parseDiffFileInfo(diffText: string): DiffFileInfo | null {
  const newMatch = /^\+\+\+ b\/(.+)$/m.exec(diffText)
  if (!newMatch?.[1]) return null
  const oldMatch = /^--- (?:a\/(.+)|\/dev\/null)$/m.exec(diffText)
  return {
    path: newMatch[1],
    isNewFile: oldMatch !== null && oldMatch[1] === undefined,
  }
}

export function parseDiffRows(diffText: string, format: DiffTextFormat = 'unified', truncated = false): DiffRow[] {
  if (!diffText) return []

  const lines = diffText.split('\n')
  // 仅在显式截断状态下移除精确尾标记及其分隔空行，正文同名行保持不变。
  const truncatedIndex = lines.length - 1
  if (truncated && truncatedIndex >= 0 && isDiffTruncatedMarker(lines[truncatedIndex] ?? '')) {
    lines.pop()
    if (lines[lines.length - 1] === '') lines.pop()
  }
  // 末尾换行产生的空元素不渲染，避免多出一行带行号的空行
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()

  if (format === 'raw') {
    return lines.map((text, index) => ({ kind: 'add', text, oldNo: null, newNo: index + 1 }))
  }

  const rows: DiffRow[] = []
  let oldNo = 1
  let newNo = 1
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

  return rows
}
