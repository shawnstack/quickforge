/**
 * 流式 Markdown 的「稳定块」切分。
 *
 * 流式期间每帧都把**全部已产出文本**重新交给 react-markdown 解析：一回合的
 * 累计成本是 O(N²)（N = 最终字符数），长回答（含长代码块）会把主线程占满。
 * 但流式文本只会在末尾增长，前面已经闭合的 Markdown 块（空行分隔的段落、
 * 已闭合的围栏代码块、标题…）的渲染结果与后续追加无关。
 *
 * 因此把内容切成：
 * - `blocks`：已闭合、可安全独立渲染的块（按块缓存元素树，跨帧复用）；
 * - `tail`：尚未闭合的活动尾部（每帧解析，长度有界）。
 *
 * 等价性由「保守切分」保证：只在**空行**处切，且两侧都不处于会跨空行延续的
 * 结构里（列表项、引用块、缩进代码、表格行、setext 下划线、HTML 块）。任何
 * 一条不满足就退化为整段解析（返回 null），视觉输出与改动前逐字一致。
 */

export type StreamingMarkdownChunks = {
  /** 已闭合的块，每块以空行结尾（含在块文本里）。 */
  blocks: string[]
  /** 未闭合的尾部：每帧重新解析。 */
  tail: string
}

/** 低于这个长度的内容不值得切分（切分开销大于解析开销）。 */
const MIN_CHUNK_CHARS = 240
/** 一次最多回退多少个空行候选，避免病态内容上的长扫描。 */
const MAX_CANDIDATES = 12

type FenceRange = { start: number; end: number }

/** 行首围栏（``` / ~~~，允许 0–3 个前导空格）。 */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/**
 * 扫描围栏代码块区间 `[start, end)`。
 *
 * 未闭合的围栏一直延伸到内容末尾——这正是「围栏内的空行不能当切分点」需要的
 * 语义：切在围栏中间会得到两段语法都错的内容。
 */
function scanFences(content: string): FenceRange[] {
  const ranges: FenceRange[] = []
  let openAt = -1
  let openMarker = ''
  let lineStart = 0
  while (lineStart <= content.length) {
    let lineEnd = content.indexOf('\n', lineStart)
    if (lineEnd < 0) lineEnd = content.length
    const line = content.slice(lineStart, lineEnd)
    const match = FENCE_OPEN.exec(line)
    if (match) {
      const marker = match[1]
      if (openAt < 0) {
        openAt = lineStart
        openMarker = marker[0]
      } else if (marker[0] === openMarker && marker.length >= openMarker.length) {
        ranges.push({ start: openAt, end: lineEnd })
        openAt = -1
        openMarker = ''
      }
    }
    if (lineEnd === content.length) break
    lineStart = lineEnd + 1
  }
  if (openAt >= 0) ranges.push({ start: openAt, end: content.length })
  return ranges
}

function insideFence(ranges: FenceRange[], position: number): boolean {
  for (const range of ranges) {
    if (position >= range.start && position < range.end) return true
  }
  return false
}

/** 会跨空行延续（或依赖相邻行）的块级形态。 */
function isContinuationSensitive(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  // 缩进代码块 / 列表项 / 引用块 / 表格行
  if (/^(\t| {4})/.test(line)) return true
  if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/.test(line)) return true
  if (/^ {0,3}>/.test(line)) return true
  if (/^ {0,3}\|/.test(line)) return true
  // 分隔线 / setext 下划线：单独出现是 hr，紧跟段落时是标题下划线。
  if (/^ {0,3}(?:-{3,}|={3,}|\*{3,}|_{3,})\s*$/.test(line)) return true
  // HTML 块：跨空行才闭合，无法安全切分。
  if (/^ {0,3}</.test(line)) return true
  return false
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) return lines[index]
  }
  return ''
}

function firstLine(text: string): string {
  const end = text.indexOf('\n')
  return end < 0 ? text : text.slice(0, end)
}

/**
 * 切点前的最后一行（不含切点本身的两个换行）。
 *
 * 只取这一行，不切整段前缀：`content.slice(0, position)` 在每帧 × 每个候选上
 * 都是 O(n) 拷贝，12 个候选就是 12n——比它要省的解析还贵。
 */
function lineBeforeBoundary(content: string, boundary: number): string {
  const previousBreak = content.lastIndexOf('\n', boundary - 1)
  return content.slice(previousBreak + 1, boundary)
}

/** 切点后的第一行。 */
function lineAfterBoundary(content: string, boundary: number): string {
  const start = boundary + 2
  const nextBreak = content.indexOf('\n', start)
  return content.slice(start, nextBreak < 0 ? content.length : nextBreak)
}

/**
 * 切点是否安全。
 *
 * 两侧都不能是「会跨空行延续」的行：列表的 loose item、引用块、表格行在空行
 * 两侧仍属同一结构，切开会让它们渲染成两个独立结构（间距/编号/表头都会变）。
 */
function isSafeBoundary(content: string, boundary: number): boolean {
  const before = lastNonEmptyLine(lineBeforeBoundary(content, boundary))
  const after = firstLine(lineAfterBoundary(content, boundary))
  if (!before || !after.trim()) return false
  if (isContinuationSensitive(before)) return false
  if (isContinuationSensitive(after)) return false
  return true
}

/**
 * 把流式内容切成「稳定块 + 活动尾块」。
 *
 * 返回 null 表示「不要切分」（内容太短、找不到安全边界、或全部在未闭合围栏里），
 * 调用方退回整段解析——那是改动前的行为。
 */
export function splitStableMarkdown(content: string): StreamingMarkdownChunks | null {
  if (content.length < MIN_CHUNK_CHARS * 2) return null
  const fences = scanFences(content)
  const boundaries: number[] = []
  let searchFrom = content.length
  for (let attempt = 0; attempt < MAX_CANDIDATES; attempt += 1) {
    const position = content.lastIndexOf('\n\n', searchFrom - 1)
    if (position < 0) break
    searchFrom = position
    if (insideFence(fences, position)) continue
    if (position + 2 < MIN_CHUNK_CHARS) break
    if (isSafeBoundary(content, position)) {
      boundaries.push(position + 2)
    }
  }
  if (boundaries.length === 0) return null

  // 从最早的合法边界开始，逐块切；块 = 到下一个合法边界（或末尾）为止。
  const cuts = [...boundaries].sort((left, right) => left - right)
  const blocks: string[] = []
  let cursor = 0
  for (const cut of cuts) {
    if (cut <= cursor) continue
    blocks.push(content.slice(cursor, cut))
    cursor = cut
  }
  const tail = content.slice(cursor)
  if (blocks.length === 0 || !tail.trim()) return null
  // 冻结前缀必须自身完整：跨空行的数学定界符或 HTML 块切开后会渲染成两段
  // 坏结构。这类内容（聊天里少见）整体退化为逐帧解析。
  if (!isSelfContained(content.slice(0, cursor))) return null
  return { blocks, tail }
}

/** 前缀是否自包含：数学定界符成对、没有 HTML 块起始行。 */
function isSelfContained(stable: string): boolean {
  if (/^ {0,3}</m.test(stable)) return false
  const count = (pattern: RegExp) => (stable.match(pattern) ?? []).length
  if (count(/\\\[/g) !== count(/\\\]/g)) return false
  if (count(/\\\(/g) !== count(/\\\)/g)) return false
  return true
}
