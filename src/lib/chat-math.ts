import type { Element, ElementContent, Parent, Root, RootContent } from 'hast'

/**
 * Chat math pipeline (KaTeX parity with the removed pi-web-ui marked layer).
 *
 * Three stages, kept in this pure-TS module so they stay unit-testable:
 *
 * 1. `preprocessLatexDelimiters` runs *before* react-markdown: markdown treats
 *    the backslash of `\(`/`\[` as an escape and would eat it, so `\(...\)`
 *    and `\[...\]` are swapped for placeholder tokens (`QFMTHI<hex>` inline /
 *    `QFMTHB<hex>` display) that survive markdown untouched; the LaTeX lives
 *    in the returned token map. Code regions (fenced, indented and inline
 *    code) are left verbatim.
 * 2. `rehypeQfMath` runs as a rehype plugin on the hast tree: it turns the
 *    placeholders plus the `$...$` / `$$...$$` rules into
 *    `<qf-math latex display>` elements (again skipping code/pre subtrees).
 *    The `$$` block rule matches anywhere, including mid-line `a $$x$$ b`,
 *    matching the old marked block extension (see `findBlockHit`).
 * 3. The `qf-math` elements are rendered by the KatexMath component
 *    (src/components/chat/surface/KatexMath.tsx).
 */

export type MathToken = { latex: string; display: boolean }
export type MathTokenMap = Map<string, MathToken>
export type PreprocessedMath = { content: string; tokens: MathTokenMap }

const INLINE_OPEN = '\\('
const INLINE_CLOSE = '\\)'
const DISPLAY_OPEN = '\\['
const DISPLAY_CLOSE = '\\]'

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/
const INDENTED_CODE_RE = /^(?: {4}|\t)/

const INLINE_TOKEN_PREFIX = 'QFMTHI'
const DISPLAY_TOKEN_PREFIX = 'QFMTHB'

function makeToken(latex: string, display: boolean, tokens: MathTokenMap): string {
  const id = `${display ? DISPLAY_TOKEN_PREFIX : INLINE_TOKEN_PREFIX}${tokens.size.toString(16).padStart(4, '0')}`
  tokens.set(id, { latex, display })
  return id
}

type LineRun = { code: boolean; lines: string[] }

/**
 * Split content into runs of code lines (fenced blocks — tracked by fence
 * marker and length — and indented code) and prose lines. Fence/indent
 * detection is intentionally simplified (per line), which is enough for the
 * chat markdown surface: anything markdown itself would treat as code must
 * not get math placeholders.
 */
function classifyLines(content: string): LineRun[] {
  const runs: LineRun[] = []
  let fence: { marker: string; length: number } | null = null
  for (const line of content.split('\n')) {
    let code: boolean
    if (fence) {
      code = true
      const close = FENCE_CLOSE_RE.exec(line)
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null
    } else {
      const open = FENCE_OPEN_RE.exec(line)
      // CommonMark: a backtick fence's info string cannot contain backticks.
      if (open && (open[1][0] === '~' || !open[2].includes('`'))) {
        fence = { marker: open[1][0], length: open[1].length }
        code = true
      } else {
        code = INDENTED_CODE_RE.test(line)
      }
    }
    const last = runs[runs.length - 1]
    if (last && last.code === code) last.lines.push(line)
    else runs.push({ code, lines: [line] })
  }
  return runs
}

/**
 * Replace `\(...\)` / `\[...\]` (non-greedy, may span lines within the run)
 * with placeholder tokens, skipping inline code spans (backtick pairs,
 * simplified to same-line matching).
 */
function replaceDelimitersInRun(text: string, tokens: MathTokenMap): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '`') {
      // Inline code span: an opening backtick run closed by an equal-length
      // run on the same line is emitted verbatim. Without a same-line close
      // the run itself is literal text.
      let length = 1
      while (text[i + length] === '`') length++
      const lineEnd = text.indexOf('\n', i + length)
      const limit = lineEnd === -1 ? text.length : lineEnd
      let j = i + length
      let spanEnd = -1
      while (j < limit) {
        if (text[j] === '`') {
          let runLength = 1
          while (text[j + runLength] === '`') runLength++
          if (runLength === length) {
            spanEnd = j + runLength
            break
          }
          j += runLength
        } else {
          j++
        }
      }
      const end = spanEnd === -1 ? i + length : spanEnd
      out += text.slice(i, end)
      i = end
      continue
    }
    if (text.startsWith(INLINE_OPEN, i)) {
      const close = text.indexOf(INLINE_CLOSE, i + INLINE_OPEN.length)
      if (close !== -1) {
        out += makeToken(text.slice(i + INLINE_OPEN.length, close), false, tokens)
        i = close + INLINE_CLOSE.length
        continue
      }
    }
    if (text.startsWith(DISPLAY_OPEN, i)) {
      const close = text.indexOf(DISPLAY_CLOSE, i + DISPLAY_OPEN.length)
      if (close !== -1) {
        out += makeToken(text.slice(i + DISPLAY_OPEN.length, close), true, tokens)
        i = close + DISPLAY_CLOSE.length
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/**
 * Preprocess chat message content for math rendering. `\(...\)` becomes an
 * inline placeholder token and `\[...\]` a display one; the returned map
 * holds the LaTeX for each token and must be passed to `rehypeQfMath`.
 */
export function preprocessLatexDelimiters(content: string): PreprocessedMath {
  const tokens: MathTokenMap = new Map()
  const processed = classifyLines(content)
    .map((run) => (run.code ? run.lines.join('\n') : replaceDelimitersInRun(run.lines.join('\n'), tokens)))
    .join('\n')
  return { content: processed, tokens }
}

type MathHit = { start: number; end: number; latex: string; display: boolean }

function findTokenHit(value: string, from: number, tokens: MathTokenMap): MathHit | null {
  const re = /QFMTH([IB])[0-9a-f]+/g
  re.lastIndex = from
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    const token = tokens.get(match[0])
    if (token) {
      return { start: match.index, end: match.index + match[0].length, latex: token.latex, display: token.display }
    }
  }
  return null
}

/**
 * `$$...$$` block math, non-greedy and allowed to span lines. Matching is
 * not line-anchored: the old marked extension declared
 * `start: text => text.indexOf('$$')` on a `level: 'block'` extension, which
 * marked wires into `startBlock` — it ends the current paragraph right before
 * a mid-line `$$`, so `a $$x$$ b` rendered display math between two
 * paragraphs rather than staying literal.
 *
 * Same content rule as the old tokenizer (`[^$]+?`: at least one character,
 * no `$` inside) and the latex is trimmed before it reaches KaTeX.
 */
function findBlockHit(value: string, from: number): MathHit | null {
  const re = /\$\$([^$]+?)\$\$/g
  re.lastIndex = from
  const match = re.exec(value)
  if (!match) return null
  return { start: match.index, end: match.index + match[0].length, latex: match[1].trim(), display: true }
}

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

/**
 * `$...$` inline math: content holds no `$` and no line break. Guards keep
 * currency-like prose (`价格 $5 和 $6 之间`) and reserve the doubled dollars
 * of `$$...$$` for `findBlockHit`: the opening `$` is not doubled, the
 * first character after it is not whitespace, and the closing `$` is not
 * preceded by whitespace nor followed by another `$`.
 */
function findInlineHit(value: string, from: number): MathHit | null {
  for (let i = from; i < value.length - 1; i++) {
    if (value[i] !== '$') continue
    if (value[i - 1] === '$') continue
    const first = value[i + 1]
    if (first === '$' || isBlank(first)) continue
    for (let j = i + 2; j < value.length; j++) {
      const ch = value[j]
      if (ch === '\n') break
      if (ch !== '$') continue
      if (isBlank(value[j - 1])) break
      if (value[j + 1] === '$') break
      return { start: i, end: j + 1, latex: value.slice(i + 1, j), display: false }
    }
  }
  return null
}

function nextMathHit(value: string, from: number, tokens: MathTokenMap): MathHit | null {
  const candidates = [findTokenHit(value, from, tokens), findBlockHit(value, from), findInlineHit(value, from)]
  let best: MathHit | null = null
  for (const candidate of candidates) {
    if (candidate && (!best || candidate.start < best.start)) best = candidate
  }
  return best
}

type MathPart = { latex: string; display: boolean }
type TextPart = { text: string }

function splitByMath(value: string, tokens: MathTokenMap): Array<MathPart | TextPart> {
  const parts: Array<MathPart | TextPart> = []
  let pos = 0
  while (pos < value.length) {
    const hit = nextMathHit(value, pos, tokens)
    if (!hit) break
    if (hit.start > pos) parts.push({ text: value.slice(pos, hit.start) })
    parts.push({ latex: hit.latex, display: hit.display })
    pos = hit.end
  }
  if (pos < value.length) parts.push({ text: value.slice(pos) })
  return parts
}

function mathElement(latex: string, display: boolean): Element {
  // `display` is not the HTML presentation attribute here — it is the math
  // display-mode flag passed straight to the qf-math component — hence the
  // cast past hast's known-attribute typing.
  const properties = { latex, display } as unknown as Element['properties']
  return { type: 'element', tagName: 'qf-math', properties, children: [] }
}

/** Code subtrees keep their text verbatim — no math rewriting inside them. */
function isCodeElement(node: Parent): boolean {
  if (node.type !== 'element') return false
  const element = node as Element
  return element.tagName === 'code' || element.tagName === 'pre'
}

function transformTextNodes(parent: Parent, tokens: MathTokenMap): void {
  if (isCodeElement(parent)) return
  let rebuilt: Parent['children'] | null = null
  for (const child of parent.children) {
    if (child.type === 'text') {
      const parts = splitByMath(child.value, tokens)
      if (parts.length !== 1 || !('text' in parts[0])) {
        if (!rebuilt) rebuilt = []
        for (const part of parts) {
          if ('text' in part) rebuilt.push({ type: 'text', value: part.text })
          else rebuilt.push(mathElement(part.latex, part.display))
        }
        continue
      }
    }
    if (rebuilt) rebuilt.push(child)
  }
  if (rebuilt) parent.children = rebuilt
  for (const child of parent.children) {
    if ('children' in child && child.children.length > 0) transformTextNodes(child as Parent, tokens)
  }
}

/** Display math is emitted at block level, so it must never nest in a `p`. */
function isDisplayMathElement(node: RootContent): node is Element {
  return (
    node.type === 'element' &&
    node.tagName === 'qf-math' &&
    (node.properties as unknown as { display?: unknown } | undefined)?.display === true
  )
}

/**
 * Split a paragraph that mixes display math with other content into the
 * legacy shape — `<p>a </p><qf-math display><p> b</p>` — and replace a
 * paragraph holding nothing but display math by that element. Returns `null`
 * for paragraphs without display math, which are left untouched.
 * Whitespace-only text groups are dropped, matching the old renderer, which
 * emitted no empty paragraph for `$$x$$` on its own line.
 */
function splitParagraphDisplayMath(paragraph: Element): RootContent[] | null {
  const group: ElementContent[] = []
  const parts: RootContent[] = []
  let displayMath = false
  const flushGroup = () => {
    if (group.length === 0) return
    if (!group.every((node) => node.type === 'text' && node.value.trim() === '')) {
      parts.push({ type: 'element', tagName: 'p', properties: paragraph.properties, children: [...group] })
    }
    group.length = 0
  }
  for (const child of paragraph.children) {
    if (isDisplayMathElement(child)) {
      displayMath = true
      flushGroup()
      parts.push(child)
      continue
    }
    group.push(child)
  }
  flushGroup()
  return displayMath ? parts : null
}

/**
 * Legacy parity: the old marked block extension emitted display math at block
 * level, so display math must not render as a `div` nested inside a `p`
 * (invalid nesting plus React's DOM-nesting warning).
 */
function splitDisplayMathParagraphs(parent: Parent): void {
  const children = parent.children
  let rebuilt: RootContent[] | null = null
  for (const child of children) {
    if (child.type === 'element' && child.tagName === 'p') {
      const parts = splitParagraphDisplayMath(child)
      if (parts) {
        if (!rebuilt) rebuilt = []
        rebuilt.push(...parts)
        continue
      }
    }
    if (rebuilt) rebuilt.push(child)
  }
  if (rebuilt) parent.children = rebuilt
  for (const child of parent.children) {
    if ('children' in child && child.children.length > 0) splitDisplayMathParagraphs(child as Parent)
  }
}

export type RehypeQfMathOptions = { tokens: MathTokenMap }

/**
 * Rehype plugin for the chat math pipeline. Pass the token map returned by
 * `preprocessLatexDelimiters` so `\(…\)`/`\[…\]` placeholders can be
 * resolved back to their LaTeX source.
 */
export function rehypeQfMath({ tokens }: RehypeQfMathOptions) {
  return (tree: Root) => {
    transformTextNodes(tree, tokens)
    splitDisplayMathParagraphs(tree)
  }
}
