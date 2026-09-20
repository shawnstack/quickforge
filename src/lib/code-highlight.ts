/**
 * Self-hosted lightweight syntax highlighting for chat code blocks.
 *
 * The legacy chat rendered code with highlight.js; that dependency was removed
 * and blocks rendered verbatim (recorded as a migration gap). This module
 * restores a restrained subset of that behavior without adding any dependency:
 * one linear, single-pass tokenizer per language family, with these invariants:
 *
 * - Monotonic scanning: every token is matched at the current index with flat,
 *   sticky (`y`) character-class regexes — no nested quantifiers, so no
 *   catastrophic backtracking, and per-block cost is O(n).
 * - Missing language names, the plaintext spellings (`text`/`plaintext`/`txt`,
 *   which legacy `hljs.getLanguage('text')` resolved to the plaintext grammar)
 *   and blocks larger than MAX_HIGHLIGHT_LENGTH return a single `plain`
 *   segment (identical to the previous no-highlight behavior).
 * - Still-unregistered language names get the conservative generic pass
 *   (`tokenizeGeneric`) instead of raw plain text — see that section for how it
 *   approximates the legacy `hljs.highlightAuto(code)` fallback and where it
 *   knowingly differs (no language guessing, no type/function detection, and a
 *   block that only matches bare numbers stays plain).
 * - Correctness is "good enough for reading": it favors never hanging or
 *   garbling text over perfect parsing. Known trade-offs:
 *   - JS/TS template literals highlight as one string; `${…}` interpolations
 *     inside them are not re-tokenized.
 *   - JS regex literals use a preceding-significant-token heuristic; regex
 *     character classes containing `/` (e.g. `/[/]/`) can end the literal early.
 *   - JSX is recognized in expression position (after `return ( { , => …`) or
 *     inside an already-open element's children; unspaced comparisons directly
 *     after `)` can be mistaken for a tag, spaced ones (`i < n`) are not.
 *   - Rust nested block comments, bash heredocs, `$()`-inner commands
 *     and YAML block scalars (`|` / `>`) are approximated.
 *   - Unterminated strings/comments while a message streams swallow to
 *     end-of-line / end-of-block and self-correct as more text arrives.
 *
 * Supported languages (see LANGUAGE_ALIASES): javascript/jsx, typescript/tsx,
 * json, bash/sh/shell, python, css/scss/less, html/xml/svg, sql, java, c,
 * cpp, go, rust, yaml, markdown, diff, toml, ini, dockerfile, makefile,
 * powershell, graphql, protobuf, nginx, apache. Everything else goes through
 * the generic pass above.
 */

/** Finite highlight token vocabulary (mirrors the `qf-hl-*` CSS classes). */
export type CodeHighlightToken =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'function'
  | 'builtin'
  | 'property'
  | 'punct'
  | 'tag'
  | 'attr'
  | 'addition'
  | 'deletion'
  | 'plain'

export type CodeHighlightSegment = { text: string; token: CodeHighlightToken }

/** Blocks larger than this are returned as one plain segment (size guard). */
export const MAX_HIGHLIGHT_LENGTH = 200 * 1024

/** token → CSS class on the `.qf-hl-<token>` palette in `src/index.css`. */
export const HIGHLIGHT_TOKEN_CLASSES: Record<CodeHighlightToken, string> = {
  comment: 'qf-hl-comment',
  string: 'qf-hl-string',
  keyword: 'qf-hl-keyword',
  number: 'qf-hl-number',
  function: 'qf-hl-function',
  builtin: 'qf-hl-builtin',
  property: 'qf-hl-property',
  punct: 'qf-hl-punct',
  tag: 'qf-hl-tag',
  attr: 'qf-hl-attr',
  addition: 'qf-hl-addition',
  deletion: 'qf-hl-deletion',
  plain: 'qf-hl-plain',
}

/** Fenced-language spellings that resolve to a supported tokenizer. */
const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: 'javascript',
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  node: 'javascript',
  mts: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  json: 'json',
  jsonc: 'json',
  bash: 'bash',
  console: 'bash',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  python: 'python',
  python3: 'python',
  css: 'css',
  less: 'css',
  scss: 'css',
  html: 'markup',
  svg: 'markup',
  xhtml: 'markup',
  xml: 'markup',
  mysql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  psql: 'sql',
  sql: 'sql',
  sqlite: 'sql',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  h: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  go: 'go',
  golang: 'go',
  java: 'java',
  rs: 'rust',
  rust: 'rust',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  diff: 'diff',
  patch: 'diff',
  yaml: 'yaml',
  yml: 'yaml',
  /* Config dialects. */
  ini: 'ini',
  toml: 'toml',
  /* Build / container files. */
  docker: 'dockerfile',
  dockerfile: 'dockerfile',
  make: 'makefile',
  makefile: 'makefile',
  mak: 'makefile',
  mk: 'makefile',
  /* Shell-adjacent languages. */
  powershell: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  /* Schema / API description languages. */
  gql: 'graphql',
  graphql: 'graphql',
  proto: 'protobuf',
  protobuf: 'protobuf',
  /* Server configs. */
  apache: 'apache',
  apacheconf: 'apache',
  httpd: 'apache',
  nginx: 'nginx',
  nginxconf: 'nginx',
}

/** Every fenced spelling that gets a real tokenizer (docs/tests). */
export const HIGHLIGHT_LANGUAGES: readonly string[] = Object.keys(LANGUAGE_ALIASES).sort()

/**
 * Legacy plaintext registrations (`highlight.js` ships `plaintext` with the
 * `text` / `txt` aliases), which must stay uncolored.
 */
const PLAINTEXT_LANGUAGES = new Set(['plaintext', 'text', 'txt'])

/**
 * Tokenize `code` for a fenced language. Plaintext spellings, missing language
 * names, unregistered ones that the generic pass cannot claim, oversized blocks
 * and empty input degrade to plain segments, so callers can render blindly.
 */
export function highlightCode(code: string, language: string | undefined): CodeHighlightSegment[] {
  if (!code) return []
  if (code.length > MAX_HIGHLIGHT_LENGTH) return [{ text: code, token: 'plain' }]
  const name = (language ?? '').trim().toLowerCase()
  if (!name || PLAINTEXT_LANGUAGES.has(name)) return [{ text: code, token: 'plain' }]
  const tokenize = LANGUAGE_TOKENIZERS[LANGUAGE_ALIASES[name] ?? '']
  if (tokenize) {
    const segments = tokenize(code)
    return segments.length ? segments : [{ text: code, token: 'plain' }]
  }
  // Unregistered name → conservative generic pass (see `tokenizeGeneric`).
  const segments = tokenizeGeneric(code)
  return segments.some((segment) => GENERIC_STRUCTURAL_TOKENS.has(segment.token))
    ? segments
    : [{ text: code, token: 'plain' }]
}

/* -------------------------------------------------------------------------
 * Scanning primitives (all linear, all shared)
 * ---------------------------------------------------------------------- */

/** Segment sink that merges adjacent same-token runs (fewer DOM spans). */
function createSink() {
  const segments: CodeHighlightSegment[] = []
  return {
    segments,
    push(text: string, token: CodeHighlightToken) {
      if (!text) return
      const last = segments[segments.length - 1]
      if (last && last.token === token) last.text += text
      else segments.push({ text, token })
    },
  }
}

function isSpace(ch: string) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}

function isIdentStart(ch: string | undefined) {
  if (!ch) return false
  return ch === '_' || ch === '$' || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')
}

/** Match a sticky regex exactly at `index`; returns '' when it does not match. */
function matchAt(pattern: RegExp, code: string, index: number): string {
  pattern.lastIndex = index
  return pattern.exec(code)?.[0] ?? ''
}

/**
 * Scan a quoted literal starting at `start` (the opening quote). Escapes skip
 * the next character; non-multiline strings stop at a newline so a stray quote
 * cannot swallow the rest of the block. PowerShell passes a backtick escape
 * character instead of the default backslash.
 */
function scanQuoted(
  code: string,
  start: number,
  quote: string,
  escapes: boolean,
  multiline: boolean,
  escapeChar = '\\',
): number {
  let i = start + 1
  while (i < code.length) {
    const ch = code[i]
    if (escapes && ch === escapeChar) {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    if (!multiline && ch === '\n') return i
    i++
  }
  return code.length
}

/** SQL/YAML single-quote scan where the escape is a doubled quote (''). */
function scanDoubledQuote(code: string, start: number, quote: string): number {
  let i = start + 1
  while (i < code.length) {
    if (code.startsWith(quote + quote, i)) {
      i += 2
      continue
    }
    if (code[i] === quote) return i + 1
    i++
  }
  return code.length
}

/** Index of the delimiter matching `code[openIndex]`; strings are skipped. */
function findMatching(code: string, openIndex: number, open: string, close: string): number {
  let depth = 0
  let i = openIndex
  while (i < code.length) {
    const ch = code[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = scanQuoted(code, i, ch, true, true)
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function wordSet(words: string): Set<string> {
  return new Set(words.split(/\s+/).filter(Boolean))
}

/* Shared sticky patterns (flat character classes only — no nested quantifiers). */
const IDENT_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/y
const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y
const NUMBER_PATTERN = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.[\d_]*|\.\d[\d_]*|\d[\d_]*)(?:[eE][+-]?\d+)?)/y
const NUMBER_SUFFIX_PATTERN = /(?:ull|llu|usize|isize|u64|u32|u16|u8|i64|i32|i16|i8|f64|f32|f16|ul|lu|ll|[nNuUlLfFjz])/y
const PLAIN_NUMBER_PATTERN = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const C_LIKE_PUNCT_PATTERN = /[{}()[\]<>=+\-*/%&|^!~?:;,.@#]+/y

/* -------------------------------------------------------------------------
 * C-family tokenizer (js/ts/jsx, python, java, c/cpp, go, rust)
 * ---------------------------------------------------------------------- */

type CLikeOptions = {
  keywords: Set<string>
  builtins: Set<string>
  lineComment?: string
  blockComment?: readonly [string, string]
  /** JS/TS `` `…` `` templates with escapes, may span lines. */
  templateString?: boolean
  /** Go raw `` `…` `` strings, no escapes, may span lines. */
  rawString?: boolean
  /** Python `"""…"""` triple-quoted strings. */
  tripleQuoted?: boolean
  /** Python r''/f''/b''/u'' prefixes. */
  stringPrefixes?: boolean
  /** JS regex literals via a preceding-token heuristic. */
  regexLiteral?: boolean
  /** JSX/TSX tags in expression position + element children. */
  jsx?: boolean
  /** `@Decorator` / `@decorator` → builtin. */
  annotation?: boolean
  /** C `#include`-style preprocessor directives → keyword. */
  preprocessor?: boolean
  /** Rust `'a` lifetimes → builtin (vs char literals). */
  lifetime?: boolean
  /** Numeric suffixes (10n, 1.5f, 42u32). */
  numberSuffix?: boolean
  /** `ident` after a `.` → property. */
  properties?: boolean
}

const BLOCK_COMMENT: readonly [string, string] = ['/*', '*/']

/** Tokens after which a `/` starts a regex literal rather than division. */
const REGEX_CONTEXTS = new Set([
  '', '(', '[', '{', ',', ';', ':', '?', '!', '=>', '=', '&&', '||', '??', '&', '|', '+', '-', '*', '%', '~', '^',
  'return', 'case', 'typeof', 'instanceof', 'in', 'of', 'delete', 'void', 'new', 'do', 'else', 'throw',
])

/** Tokens after which `<name` opens a JSX element rather than comparison. */
const JSX_CONTEXTS = new Set(['', '(', '{', ',', ';', ':', '?', '=>', '=', '&&', '||', '??', '!', '}', '>', 'return', 'case', 'else'])

/**
 * Cap on JSX interpolation recursion. Interpolations are re-tokenized with
 * the C-family tokenizer, which may open further JSX elements, so
 * adversarial nesting (`<a {<a {<a …`) recurses once per brace pair. Past
 * this depth the interpolation degrades to plain text instead of recursing
 * (stack safety + bounded O(depth × n) work).
 */
const MAX_JSX_INTERPOLATION_DEPTH = 32

const JSX_TAG_NAME_PATTERN = /[A-Za-z][A-Za-z0-9_.-]*/y
const JSX_ATTR_NAME_PATTERN = /[A-Za-z_@$][A-Za-z0-9_:$-]*/y
const PYTHON_PREFIX_PATTERN = /[rRbBuUfF]{1,2}(?=['"])/y
const RUST_LIFETIME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y

function tokenizeCLike(code: string, options: CLikeOptions, jsxRecursionDepth = 0): CodeHighlightSegment[] {
  const sink = createSink()
  const { keywords, builtins } = options
  let i = 0
  // Previous significant chunk: the punct run / identifier / keyword / marker
  // ('"' for strings, '//' comments, '0' numbers). Drives the regex-literal,
  // JSX and property heuristics.
  let prev = ''
  let jsxDepth = 0

  while (i < code.length) {
    const ch = code[i]

    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }

    if (options.lineComment && code.startsWith(options.lineComment, i)) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      prev = '//'
      i = end
      continue
    }

    if (options.blockComment && code.startsWith(options.blockComment[0], i)) {
      let end = code.indexOf(options.blockComment[1], i + options.blockComment[0].length)
      end = end === -1 ? code.length : end + options.blockComment[1].length
      sink.push(code.slice(i, end), 'comment')
      prev = '/*'
      i = end
      continue
    }

    if (options.preprocessor && ch === '#' && (i === 0 || code[i - 1] === '\n')) {
      const directive = matchAt(WORD_PATTERN, code, i + 1)
      if (directive) {
        sink.push(code.slice(i, i + 1 + directive.length), 'keyword')
        prev = '#'
        i += 1 + directive.length
        continue
      }
    }

    if (options.tripleQuoted && (code.startsWith('"""', i) || code.startsWith("'''", i))) {
      const delim = code.slice(i, i + 3)
      let end = code.indexOf(delim, i + 3)
      end = end === -1 ? code.length : end + 3
      sink.push(code.slice(i, end), 'string')
      prev = '"'
      i = end
      continue
    }

    if (options.stringPrefixes && /[rRbBuUfF]/.test(ch)) {
      const prefix = matchAt(PYTHON_PREFIX_PATTERN, code, i)
      if (prefix) {
        const end = scanQuoted(code, i + prefix.length, code[i + prefix.length], true, false)
        sink.push(code.slice(i, end), 'string')
        prev = '"'
        i = end
        continue
      }
    }

    if (options.lifetime && ch === "'") {
      // Distinguish `'a` lifetimes from `'a'` / `'\n'` char literals.
      const name = matchAt(RUST_LIFETIME_PATTERN, code, i + 1)
      if (name && code[i + 1 + name.length] !== "'") {
        sink.push(code.slice(i, i + 1 + name.length), 'builtin')
        prev = "'"
        i += 1 + name.length
        continue
      }
      const end = scanQuoted(code, i, "'", true, false)
      sink.push(code.slice(i, end), 'string')
      prev = '"'
      i = end
      continue
    }

    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      prev = '"'
      i = end
      continue
    }

    if (ch === '`' && (options.templateString || options.rawString)) {
      const end = scanQuoted(code, i, '`', Boolean(options.templateString), true)
      sink.push(code.slice(i, end), 'string')
      prev = '"'
      i = end
      continue
    }

    if (options.regexLiteral && ch === '/' && REGEX_CONTEXTS.has(prev)) {
      let j = i + 1
      let close = -1
      while (j < code.length) {
        const c = code[j]
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '\n') break
        if (c === '/') {
          close = j
          break
        }
        j++
      }
      if (close !== -1) {
        j = close + 1
        while (j < code.length && code[j] >= 'a' && code[j] <= 'z') j++
        sink.push(code.slice(i, j), 'string')
        prev = '"'
        i = j
        continue
      }
      // Not a closed literal → fall through as the division operator.
    }

    if (options.annotation && ch === '@') {
      const name = matchAt(IDENT_PATTERN, code, i + 1)
      if (name) {
        sink.push(code.slice(i, i + 1 + name.length), 'builtin')
        prev = '@'
        i += 1 + name.length
        continue
      }
    }

    if ((ch >= '0' && ch <= '9') || (ch === '.' && code[i + 1] >= '0' && code[i + 1] <= '9')) {
      const core = matchAt(NUMBER_PATTERN, code, i)
      let end = i + core.length
      if (options.numberSuffix) end += matchAt(NUMBER_SUFFIX_PATTERN, code, end).length
      sink.push(code.slice(i, end), 'number')
      prev = '0'
      i = end
      continue
    }

    if (isIdentStart(ch)) {
      const word = matchAt(IDENT_PATTERN, code, i)
      let k = i + word.length
      while (k < code.length && isSpace(code[k])) k++
      if (keywords.has(word)) sink.push(word, 'keyword')
      else if (builtins.has(word)) sink.push(word, 'builtin')
      else if (code[k] === '(') sink.push(word, 'function')
      else if (options.properties && prev.endsWith('.')) sink.push(word, 'property')
      else sink.push(word, 'plain')
      prev = word
      i += word.length
      continue
    }

    if (options.jsx && ch === '<' && (jsxDepth > 0 || JSX_CONTEXTS.has(prev))) {
      const isTag = isIdentStart(code[i + 1]) || (code[i + 1] === '/' && isIdentStart(code[i + 2]))
      if (isTag) {
        const element = emitJsxElement(code, i, sink, options, jsxRecursionDepth)
        if (element.kind === 'open') jsxDepth++
        else if (element.kind === 'closing') jsxDepth = Math.max(0, jsxDepth - 1)
        prev = '>'
        i = element.end
        continue
      }
    }

    const run = matchAt(C_LIKE_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      prev = run
      i += run.length
      continue
    }

    sink.push(ch, 'plain')
    prev = ch
    i++
  }
  return sink.segments
}

/** Emit one JSX element (`<tag attrs>`, `<tag/>` or `</tag>`) at `start`. */
function emitJsxElement(code: string, start: number, sink: ReturnType<typeof createSink>, options: CLikeOptions, jsxRecursionDepth = 0): { end: number; kind: 'open' | 'self-closed' | 'closing' | 'broken' } {
  let i = start
  if (code[i + 1] === '/') {
    sink.push('</', 'punct')
    i += 2
    const name = matchAt(JSX_TAG_NAME_PATTERN, code, i)
    if (name) {
      sink.push(name, 'tag')
      i += name.length
    }
    const gt = code.indexOf('>', i)
    if (gt === -1) {
      sink.push(code.slice(i), 'plain')
      return { end: code.length, kind: 'broken' }
    }
    if (i < gt) sink.push(code.slice(i, gt), 'plain')
    sink.push('>', 'punct')
    return { end: gt + 1, kind: 'closing' }
  }

  sink.push('<', 'punct')
  i++
  const name = matchAt(JSX_TAG_NAME_PATTERN, code, i)
  if (!name) return { end: i, kind: 'broken' }
  sink.push(name, 'tag')
  i += name.length

  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '/' && code[i + 1] === '>') {
      sink.push('/>', 'punct')
      return { end: i + 2, kind: 'self-closed' }
    }
    if (ch === '>') {
      sink.push('>', 'punct')
      return { end: i + 1, kind: 'open' }
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '{') {
      const close = findMatching(code, i, '{', '}')
      const end = close === -1 ? code.length : close + 1
      sink.push('{', 'punct')
      // Interpolation contents are re-tokenized as plain code, with the
      // recursion capped (see MAX_JSX_INTERPOLATION_DEPTH); over the cap the
      // remainder (closing brace included) stays plain instead of recursing
      // per brace pair.
      if (jsxRecursionDepth >= MAX_JSX_INTERPOLATION_DEPTH) {
        sink.push(code.slice(i + 1, end), 'plain')
        i = end
        continue
      }
      const inner = close === -1 ? code.slice(i + 1) : code.slice(i + 1, close)
      for (const segment of tokenizeCLike(inner, options, jsxRecursionDepth + 1)) sink.push(segment.text, segment.token)
      if (close !== -1) sink.push('}', 'punct')
      i = end
      continue
    }
    if (ch === '=') {
      sink.push('=', 'punct')
      i++
      continue
    }
    const attr = matchAt(JSX_ATTR_NAME_PATTERN, code, i)
    if (attr) {
      sink.push(attr, 'attr')
      i += attr.length
      continue
    }
    sink.push(ch, 'punct')
    i++
  }
  return { end: code.length, kind: 'broken' }
}

const JAVASCRIPT_KEYWORDS = wordSet(`async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield true false null undefined`)
const TYPESCRIPT_EXTRA_KEYWORDS = wordSet(`abstract any as asserts bigint boolean declare enum implements infer interface is keyof module namespace never number object out override package private protected public readonly satisfies string symbol type unknown`)
const JS_LIKE_BUILTINS = wordSet(`console window document globalThis process module exports require fetch localStorage sessionStorage setTimeout setInterval clearTimeout clearInterval queueMicrotask structuredClone NaN Infinity Math JSON Object Array String Number Boolean Function Symbol RegExp Error Date Map Set WeakMap WeakSet Promise Proxy Reflect ArrayBuffer DataView Intl BigInt`)

const JAVASCRIPT_OPTIONS: CLikeOptions = {
  keywords: JAVASCRIPT_KEYWORDS,
  builtins: JS_LIKE_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
  templateString: true,
  regexLiteral: true,
  jsx: true,
  properties: true,
}

const TYPESCRIPT_OPTIONS: CLikeOptions = {
  ...JAVASCRIPT_OPTIONS,
  keywords: new Set([...JAVASCRIPT_KEYWORDS, ...TYPESCRIPT_EXTRA_KEYWORDS]),
}

const PYTHON_KEYWORDS = wordSet(`False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case`)
const PYTHON_BUILTINS = wordSet(`print len range open int float complex str bool list dict set tuple bytes bytearray frozenset type isinstance issubclass super object enumerate zip map filter sorted reversed sum min max abs round pow divmod input format repr hash id hex oct bin iter next callable hasattr getattr setattr delattr vars dir staticmethod classmethod property exit quit self cls Exception BaseException ValueError TypeError KeyError IndexError RuntimeError StopIteration StopAsyncIteration NotImplementedError AssertionError __name__ __main__ __init__`)

const PYTHON_OPTIONS: CLikeOptions = {
  keywords: PYTHON_KEYWORDS,
  builtins: PYTHON_BUILTINS,
  lineComment: '#',
  tripleQuoted: true,
  stringPrefixes: true,
  annotation: true,
  properties: true,
}

const JAVA_KEYWORDS = wordSet(`abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed permits yield`)
const JAVA_BUILTINS = wordSet(`String Integer Long Double Float Boolean Byte Short Character Object System Math List ArrayList LinkedList Map HashMap TreeMap Set HashSet TreeSet Optional Stream Objects Arrays Collections StringBuilder StringBuffer Thread Runnable Callable Exception RuntimeException IllegalArgumentException IllegalStateException Error Override Deprecated SuppressWarnings SafeVarargs FunctionalInterface`)

const JAVA_OPTIONS: CLikeOptions = {
  keywords: JAVA_KEYWORDS,
  builtins: JAVA_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
  annotation: true,
  numberSuffix: true,
}

const C_KEYWORDS = wordSet(`auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL`)
const CPP_EXTRA_KEYWORDS = wordSet(`alignas alignof catch class constexpr decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept nullptr operator override private protected public static_assert static_cast template this thread_local throw try typeid typename using virtual wchar_t reinterpret_cast const_cast`)
const C_BUILTINS = wordSet(`size_t ssize_t ptrdiff_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t intptr_t std string vector map set pair array list queue stack cout cin cerr endl printf scanf puts getchar malloc calloc realloc free memcpy memmove memset strcpy strlen strcmp fopen fclose FILE assert EXIT_SUCCESS EXIT_FAILURE NULL`)

const C_OPTIONS: CLikeOptions = {
  keywords: C_KEYWORDS,
  builtins: C_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
  preprocessor: true,
  numberSuffix: true,
}

const CPP_OPTIONS: CLikeOptions = {
  ...C_OPTIONS,
  keywords: new Set([...C_KEYWORDS, ...CPP_EXTRA_KEYWORDS]),
}

const GO_KEYWORDS = wordSet(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota`)
const GO_BUILTINS = wordSet(`append bool byte cap close complex64 complex128 copy delete error float32 float64 imag int int8 int16 int32 int64 len make new panic print println real recover rune string uint uint8 uint16 uint32 uint64 uintptr any comparable min max clear`)

const GO_OPTIONS: CLikeOptions = {
  keywords: GO_KEYWORDS,
  builtins: GO_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
  rawString: true,
}

const RUST_KEYWORDS = wordSet(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while`)
const RUST_BUILTINS = wordSet(`bool char str String Vec Option Result Some None Ok Err Box Rc Arc Cell RefCell Mutex RwLock HashMap HashSet BTreeMap BTreeSet Cow i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 usize isize f16 f32 f64 println print eprintln eprint format vec write writeln assert assert_eq panic`)

const RUST_OPTIONS: CLikeOptions = {
  keywords: RUST_KEYWORDS,
  builtins: RUST_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
  lifetime: true,
  numberSuffix: true,
}

/* -------------------------------------------------------------------------
 * JSON
 * ---------------------------------------------------------------------- */

const JSON_PUNCT_PATTERN = /[{}[\],:]+/y

function tokenizeJson(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '"') {
      const end = scanQuoted(code, i, '"', true, false)
      let k = end
      while (k < code.length && isSpace(code[k])) k++
      sink.push(code.slice(i, end), code[k] === ':' ? 'property' : 'string')
      i = end
      continue
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const num = matchAt(PLAIN_NUMBER_PATTERN, code, i)
      if (num) {
        sink.push(num, 'number')
        i += num.length
        continue
      }
    }
    const word = matchAt(WORD_PATTERN, code, i)
    if (word) {
      sink.push(word, word === 'true' || word === 'false' || word === 'null' ? 'keyword' : 'plain')
      i += word.length
      continue
    }
    const run = matchAt(JSON_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Bash / sh
 * ---------------------------------------------------------------------- */

const BASH_KEYWORDS = wordSet(`if then else elif fi for while until do done case esac function select time coproc in return break continue local declare typeset export readonly unset`)
const BASH_COMMAND_KEYWORDS = wordSet(`then else do done esac fi in elif`)
const BASH_BUILTINS = wordSet(`echo printf cd pwd exit eval exec shift source alias unalias set unset trap true false test read wait jobs disown hash type command let getopts pushd popd builtin caller`)
const SHELL_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*/y
const SHELL_VAR_PATTERN = /\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@#?*!$-]|\{[^}\n]*\})/y
const SHELL_FLAG_PATTERN = /--?[A-Za-z0-9][A-Za-z0-9-]*/y
const SHELL_PUNCT_PATTERN = /[;|&()<>=/]+/y

function tokenizeBash(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  // Command position: file start, after newline/;/|/&&/(/ or control keywords.
  let commandStart = true
  // Right after `VAR=`: the next word is the value, and the word after the
  // value on the same line is a command again (`NODE_ENV=x npm run build`).
  let assignmentValue = false
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      if (code.slice(i, j).includes('\n')) {
        commandStart = true
        assignmentValue = false
      }
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '#' && (commandStart || code[i - 1] === ' ' || code[i - 1] === '\t')) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      commandStart = false
      i = end
      continue
    }
    if (ch === "'" || ch === '"') {
      const end = ch === "'" ? scanQuoted(code, i, "'", false, false) : scanQuoted(code, i, '"', true, false)
      sink.push(code.slice(i, end), 'string')
      commandStart = false
      i = end
      continue
    }
    if (ch === '`') {
      const end = scanQuoted(code, i, '`', false, true)
      sink.push(code.slice(i, end), 'builtin')
      commandStart = false
      i = end
      continue
    }
    if (ch === '$') {
      if (code[i + 1] === '(') {
        const close = findMatching(code, i + 1, '(', ')')
        const end = close === -1 ? code.length : close + 1
        sink.push(code.slice(i, end), 'builtin')
        i = end
        commandStart = false
        continue
      }
      const variable = matchAt(SHELL_VAR_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        i += variable.length
        commandStart = false
        continue
      }
    }
    if (!commandStart && ch === '-') {
      const flag = matchAt(SHELL_FLAG_PATTERN, code, i)
      if (flag) {
        sink.push(flag, 'attr')
        i += flag.length
        commandStart = false
        continue
      }
    }
    if (isIdentStart(ch)) {
      const word = matchAt(SHELL_WORD_PATTERN, code, i)
      if (commandStart && /^[A-Za-z_][A-Za-z0-9_]*$/.test(word) && code[i + word.length] === '=') {
        sink.push(word, 'property')
        assignmentValue = true
        commandStart = false
      } else if (BASH_KEYWORDS.has(word)) {
        sink.push(word, 'keyword')
        commandStart = BASH_COMMAND_KEYWORDS.has(word)
        assignmentValue = false
      } else if (BASH_BUILTINS.has(word)) {
        sink.push(word, 'builtin')
        commandStart = false
        assignmentValue = false
      } else if (commandStart) {
        sink.push(word, 'function')
        commandStart = false
        assignmentValue = false
      } else {
        sink.push(word, 'plain')
        if (assignmentValue) {
          commandStart = true
          assignmentValue = false
        }
      }
      i += word.length
      continue
    }
    if (ch >= '0' && ch <= '9') {
      const num = matchAt(NUMBER_PATTERN, code, i) || ch
      sink.push(num, 'number')
      commandStart = false
      i += num.length
      continue
    }
    const run = matchAt(SHELL_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      const control = run.includes(';') || run.includes('|') || run.includes('&') || run.includes('(')
      commandStart = control
      // A bare '=' keeps the assignment-value context alive.
      if (control) assignmentValue = false
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    commandStart = false
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * CSS (approximates scss/less)
 * ---------------------------------------------------------------------- */

const CSS_AT_RULE_PATTERN = /@[-a-zA-Z]+/y
const CSS_SELECTOR_PATTERN = /[.#][A-Za-z_][A-Za-z0-9_-]*/y
const CSS_PSEUDO_PATTERN = /:{1,2}[A-Za-z-]+/y
const CSS_WORD_PATTERN = /-{0,2}[A-Za-z_][A-Za-z0-9_-]*/y
const CSS_SELECTOR_PUNCT_PATTERN = /[>+~*,]+/y
const CSS_HEX_PATTERN = /#[0-9a-fA-F]{3,8}/y
const CSS_IMPORTANT_PATTERN = /![ \t]*important/y
const CSS_NUMBER_PATTERN = /-?(?:\d[\d.]*|\.\d[\d.]*)(?:%|[a-zA-Z]+)?/y
const CSS_DECL_PUNCT_PATTERN = /[(){}:,]+/y

function tokenizeCss(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  let inDeclaration = false
  let atRuleCondition = false
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (code.startsWith('/*', i)) {
      let end = code.indexOf('*/', i + 2)
      end = end === -1 ? code.length : end + 2
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (!inDeclaration) {
      if (ch === '{') {
        sink.push('{', 'punct')
        inDeclaration = true
        atRuleCondition = false
        i++
        continue
      }
      if (ch === '@') {
        const atRule = matchAt(CSS_AT_RULE_PATTERN, code, i)
        if (atRule) {
          sink.push(atRule, 'keyword')
          atRuleCondition = /^@(media|supports|container|layer|scope|page|property|starting-style)/i.test(atRule)
          i += atRule.length
          continue
        }
      }
      const selector = matchAt(CSS_SELECTOR_PATTERN, code, i)
      if (selector) {
        sink.push(selector, selector[0] === '.' ? 'function' : 'builtin')
        i += selector.length
        continue
      }
      const pseudo = matchAt(CSS_PSEUDO_PATTERN, code, i)
      if (pseudo) {
        sink.push(pseudo, 'keyword')
        i += pseudo.length
        continue
      }
      // Numbers only appear in selector state inside at-rule conditions.
      if ((ch >= '0' && ch <= '9') || (ch === '.' && (code[i + 1] ?? '') >= '0' && (code[i + 1] ?? '') <= '9')) {
        const num = matchAt(CSS_NUMBER_PATTERN, code, i)
        if (num) {
          sink.push(num, 'number')
          i += num.length
          continue
        }
      }
      const word = matchAt(CSS_WORD_PATTERN, code, i)
      if (word) {
        let k = i + word.length
        while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
        sink.push(word, atRuleCondition && code[k] === ':' ? 'property' : 'tag')
        i += word.length
        continue
      }
      const run = matchAt(CSS_SELECTOR_PUNCT_PATTERN, code, i)
      if (run) {
        sink.push(run, 'punct')
        i += run.length
        continue
      }
      sink.push(ch, 'punct')
      i++
      continue
    }
    // Declaration state.
    if (ch === '}') {
      sink.push('}', 'punct')
      inDeclaration = false
      i++
      continue
    }
    if (ch === ';') {
      sink.push(';', 'punct')
      i++
      continue
    }
    if (ch === '#') {
      const hex = matchAt(CSS_HEX_PATTERN, code, i)
      if (hex) {
        sink.push(hex, 'number')
        i += hex.length
        continue
      }
    }
    // Nested rules (scss / @media blocks): `.child` / `#id` selectors inside a
    // declaration block (a leading '.' before a letter is never a decimal).
    if (ch === '.' || ch === '#') {
      const nested = matchAt(CSS_SELECTOR_PATTERN, code, i)
      if (nested) {
        sink.push(nested, nested[0] === '.' ? 'function' : 'builtin')
        i += nested.length
        continue
      }
    }
    if (ch === '!') {
      const important = matchAt(CSS_IMPORTANT_PATTERN, code, i)
      if (important) {
        sink.push(important, 'keyword')
        i += important.length
        continue
      }
    }
    if ((ch >= '0' && ch <= '9') || ch === '.' || (ch === '-' && (code[i + 1] ?? '') >= '0' && (code[i + 1] ?? '') <= '9')) {
      const num = matchAt(CSS_NUMBER_PATTERN, code, i)
      if (num) {
        sink.push(num, 'number')
        i += num.length
        continue
      }
    }
    const word = matchAt(CSS_WORD_PATTERN, code, i)
    if (word) {
      let k = i + word.length
      while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
      if (code[k] === ':') sink.push(word, 'property')
      else if (code[k] === '(') sink.push(word, 'function')
      else sink.push(word, 'plain')
      i += word.length
      continue
    }
    const run = matchAt(CSS_DECL_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      i += run.length
      continue
    }
    sink.push(ch, 'punct')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * HTML / XML / SVG markup
 * ---------------------------------------------------------------------- */

const MARKUP_NAME_PATTERN = /[A-Za-z][A-Za-z0-9_.:-]*/y
const MARKUP_ATTR_PATTERN = /[A-Za-z_:@-][^\s=/>"'<]*/y

function tokenizeMarkup(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (code.startsWith('<!--', i)) {
      let end = code.indexOf('-->', i + 4)
      end = end === -1 ? code.length : end + 3
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('<![CDATA[', i)) {
      let end = code.indexOf(']]>', i + 9)
      end = end === -1 ? code.length : end + 3
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('<!', i)) {
      let end = code.indexOf('>', i)
      end = end === -1 ? code.length : end + 1
      sink.push(code.slice(i, end), 'keyword')
      i = end
      continue
    }
    if (code.startsWith('<?', i)) {
      let end = code.indexOf('?>', i)
      end = end === -1 ? code.length : end + 2
      sink.push(code.slice(i, end), 'keyword')
      i = end
      continue
    }
    const closing = code[i + 1] === '/'
    const nameStart = i + (closing ? 2 : 1)
    if (ch === '<' && isIdentStart(code[nameStart])) {
      const name = matchAt(MARKUP_NAME_PATTERN, code, nameStart)
      if (!name) {
        sink.push('<', 'plain')
        i++
        continue
      }
      sink.push(closing ? '</' : '<', 'punct')
      sink.push(name, 'tag')
      let cursor = nameStart + name.length
      if (closing) {
        const gt = code.indexOf('>', cursor)
        if (gt === -1) {
          sink.push(code.slice(cursor), 'plain')
          i = code.length
          continue
        }
        if (cursor < gt) sink.push(code.slice(cursor, gt), 'plain')
        sink.push('>', 'punct')
        i = gt + 1
        continue
      }
      // Attribute scan until the tag's '>'.
      while (cursor < code.length) {
        const c = code[cursor]
        if (isSpace(c)) {
          let j = cursor + 1
          while (j < code.length && isSpace(code[j])) j++
          sink.push(code.slice(cursor, j), 'plain')
          cursor = j
          continue
        }
        if (c === '/' && code[cursor + 1] === '>') {
          sink.push('/>', 'punct')
          cursor += 2
          break
        }
        if (c === '>') {
          sink.push('>', 'punct')
          cursor++
          break
        }
        if (c === '"' || c === "'") {
          const end = scanQuoted(code, cursor, c, false, false)
          sink.push(code.slice(cursor, end), 'string')
          cursor = end
          continue
        }
        if (c === '=') {
          sink.push('=', 'punct')
          cursor++
          // Unquoted attribute value (quoted ones are handled by the quote branch).
          const n = code[cursor]
          if (n && n !== '"' && n !== "'" && !isSpace(n) && n !== '>' && n !== '/') {
            let j = cursor
            while (j < code.length && !isSpace(code[j]) && code[j] !== '>' && code[j] !== '/') j++
            if (j > cursor) {
              sink.push(code.slice(cursor, j), 'string')
              cursor = j
            }
          }
          continue
        }
        const attr = matchAt(MARKUP_ATTR_PATTERN, code, cursor)
        if (attr) {
          sink.push(attr, 'attr')
          cursor += attr.length
          continue
        }
        sink.push(c, 'punct')
        cursor++
      }
      i = cursor
      continue
    }
    // Text run until the next '<'.
    let end = code.indexOf('<', i + 1)
    if (end === -1) end = code.length
    sink.push(code.slice(i, end), 'plain')
    i = end
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * SQL
 * ---------------------------------------------------------------------- */

const SQL_KEYWORDS = wordSet(`add all alter analyze and any as asc begin between by case cast check collate column commit constraint create cross current_date current_time current_timestamp database default delete desc distinct drop else end escape except exists explain foreign from full function grant group having if in index inner insert intersect into is join key lateral left like limit localtime merge natural not null nulls offset on or order outer over partition precision primary procedure references returning right rollback rollup select set table temporary then time timestamp transaction trigger truncate union unique update values view vacuum when where with recursive materialized generated identity conflict nothing cascade window rows range unbounded preceding following current first last only top character varying integer smallint bigint decimal numeric serial text boolean date interval`)

const SQL_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_$#@]*/y
const SQL_VAR_PATTERN = /@[A-Za-z_][A-Za-z0-9_]*/y
const SQL_PUNCT_PATTERN = /[()[\],;.=<>+\-*/%|]+/y

function tokenizeSql(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (code.startsWith('--', i)) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('/*', i)) {
      let end = code.indexOf('*/', i + 2)
      end = end === -1 ? code.length : end + 2
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === "'") {
      const end = scanDoubledQuote(code, i, "'")
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '"' || ch === '`') {
      const end = ch === '"' ? scanDoubledQuote(code, i, '"') : scanQuoted(code, i, '`', false, true)
      sink.push(code.slice(i, end), 'property')
      i = end
      continue
    }
    if (ch === '@') {
      const variable = matchAt(SQL_VAR_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        i += variable.length
        continue
      }
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const num = matchAt(PLAIN_NUMBER_PATTERN, code, i)
      if (num) {
        sink.push(num, 'number')
        i += num.length
        continue
      }
    }
    const word = matchAt(SQL_WORD_PATTERN, code, i)
    if (word) {
      let k = i + word.length
      while (k < code.length && isSpace(code[k])) k++
      if (SQL_KEYWORDS.has(word.toLowerCase())) sink.push(word, 'keyword')
      else if (code[k] === '(') sink.push(word, 'function')
      else sink.push(word, 'plain')
      i += word.length
      continue
    }
    const run = matchAt(SQL_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * YAML
 * ---------------------------------------------------------------------- */

const YAML_KEYWORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~'])
const YAML_WORD_PATTERN = /[^\s:#[\]{},"'&|>]+/y
const YAML_ANCHOR_PATTERN = /[&*][^\s:#[\]{},]+/y
const YAML_PUNCT_PATTERN = /[[]{},:]+/y
const YAML_NUMBER_PATTERN = /^[-+]?(?:\d[\d_]*(?:\.\d+)?|0[xX][0-9a-fA-F_]+|\.\d+)(?:[eE][-+]?\d+)?$/

function tokenizeYaml(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  // Key position: at a line start (after indentation) or right after a '-'.
  let atKey = true
  let afterDash = false
  const leaveKeyPosition = () => {
    atKey = false
    afterDash = false
  }
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') {
      sink.push('\n', 'plain')
      atKey = true
      afterDash = false
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '#' && (i === 0 || isSpace(code[i - 1]))) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      leaveKeyPosition()
      i = end
      continue
    }
    if ((atKey || afterDash) && ch === '-' && (code[i + 1] === undefined || code[i + 1] === ' ' || code[i + 1] === '\n')) {
      sink.push('-', 'punct')
      afterDash = true
      atKey = false
      i++
      continue
    }
    if (ch === '&' || ch === '*') {
      const anchor = matchAt(YAML_ANCHOR_PATTERN, code, i)
      if (anchor) {
        sink.push(anchor, 'builtin')
        leaveKeyPosition()
        i += anchor.length
        continue
      }
    }
    if (ch === '"' || ch === "'") {
      const end = ch === '"' ? scanQuoted(code, i, '"', true, false) : scanDoubledQuote(code, i, "'")
      sink.push(code.slice(i, end), 'string')
      leaveKeyPosition()
      i = end
      continue
    }
    if ((atKey || afterDash) && (ch === '|' || ch === '>')) {
      // Block scalar indicator; the body below is approximated as plain text.
      sink.push(ch, 'punct')
      leaveKeyPosition()
      i++
      continue
    }
    if (atKey || afterDash) {
      const candidate = matchAt(YAML_WORD_PATTERN, code, i)
      let k = i + candidate.length
      while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
      // `key:` (a colon must be followed by space/EOL to be a mapping).
      if (candidate && code[k] === ':' && (code[k + 1] === undefined || code[k + 1] === ' ' || code[k + 1] === '\n')) {
        sink.push(candidate, 'property')
        leaveKeyPosition()
        i += candidate.length
        continue
      }
    }
    const word = matchAt(YAML_WORD_PATTERN, code, i)
    if (word) {
      if (YAML_KEYWORDS.has(word.toLowerCase())) sink.push(word, 'keyword')
      else if (YAML_NUMBER_PATTERN.test(word)) sink.push(word, 'number')
      else sink.push(word, 'plain')
      leaveKeyPosition()
      i += word.length
      continue
    }
    const run = matchAt(YAML_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      leaveKeyPosition()
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    leaveKeyPosition()
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Markdown
 * ---------------------------------------------------------------------- */

const MARKDOWN_LIST_PATTERN = /(?:[-*+]|\d{1,9}\.)(?=[ \t])/y
const MARKDOWN_LINK_PATTERN = /\[[^\]\n]*\]\([^)\n]*\)/y

function tokenizeMarkdown(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  let lineStart = true
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') {
      sink.push('\n', 'plain')
      lineStart = true
      i++
      continue
    }
    if (lineStart && (ch === ' ' || ch === '\t')) {
      let j = i + 1
      while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (lineStart) {
      let lineEnd = code.indexOf('\n', i)
      if (lineEnd === -1) lineEnd = code.length
      const rest = code.slice(i, lineEnd)
      if (/^#{1,6}( |$)/.test(rest)) {
        sink.push(rest, 'keyword')
        i = lineEnd
        lineStart = false
        continue
      }
      if (/^(```|~~~)/.test(rest)) {
        sink.push(rest, 'punct')
        i = lineEnd
        lineStart = false
        continue
      }
      if (rest.includes('|') && rest.includes('-') && /^[|: \t-]+$/.test(rest)) {
        sink.push(rest, 'punct')
        i = lineEnd
        lineStart = false
        continue
      }
      if (ch === '>') {
        sink.push('>', 'punct')
        lineStart = false
        i++
        continue
      }
      const marker = matchAt(MARKDOWN_LIST_PATTERN, code, i)
      if (marker) {
        sink.push(marker, 'punct')
        lineStart = false
        i += marker.length
        continue
      }
      lineStart = false
    }
    if (ch === '`') {
      let end = code.indexOf('`', i + 1)
      end = end === -1 ? code.length : end + 1
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '[') {
      const link = matchAt(MARKDOWN_LINK_PATTERN, code, i)
      if (link) {
        const closeBracket = i + link.indexOf(']')
        const openParen = i + link.indexOf('(')
        sink.push('[', 'punct')
        sink.push(code.slice(i + 1, closeBracket), 'plain')
        sink.push(']', 'punct')
        sink.push('(', 'punct')
        sink.push(code.slice(openParen + 1, i + link.length - 1), 'builtin')
        sink.push(')', 'punct')
        i += link.length
        continue
      }
      sink.push('[', 'punct')
      i++
      continue
    }
    let j = i
    while (j < code.length && code[j] !== '\n' && code[j] !== '`' && code[j] !== '[') j++
    if (j === i) j = i + 1
    sink.push(code.slice(i, j), 'plain')
    i = j
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Diff / patch
 * ---------------------------------------------------------------------- */

/*
 * Legacy highlight.js `Diff` grammar order, kept rule by rule:
 *
 *   1. `meta` — hunk header plus the `***` / `---` range headers
 *   2. `comment` — `Index: `, `index`, `===`, `---`, `*** `, `+++`,
 *      `diff --git` (all consuming to end of line) and the 15-star separator
 *   3. `addition` — leading `+`
 *   4. `deletion` — leading `-`
 *   5. `addition` — leading `!`
 *
 * The legacy `.hljs-meta` colour is the very same `--syntax-constant` oklch
 * value as `--qf-hl-number`, so hunk headers reuse the `number` token instead
 * of adding a dedicated palette entry.
 */
const DIFF_META_PATTERNS: readonly RegExp[] = [
  /^@@ +-\d+,\d+ +\+\d+,\d+ +@@/,
  /^\*\*\* +\d+,\d+ +\*\*\*\*$/,
  /^--- +\d+,\d+ +----$/,
]

/** Legacy comment rules anchored at the line start. */
const DIFF_COMMENT_ANCHORED = /^(?:index|---|\*\*\* |\+\+\+|diff --git)/

/** Legacy comment rules whose begin may start mid-line (`Index: ` / `===`). */
const DIFF_COMMENT_MIDLINE = /Index: |={3,}/

/** Legacy `{ match: /^\*{15}$/ }` unified-diff separator. */
const DIFF_COMMENT_SEPARATOR = /^\*{15}$/

/** Pushes one diff line, reproducing the legacy whole-line rule semantics. */
function pushDiffLine(line: string, sink: ReturnType<typeof createSink>) {
  for (const pattern of DIFF_META_PATTERNS) {
    const match = pattern.exec(line)
    if (match) {
      sink.push(match[0], 'number')
      sink.push(line.slice(match[0].length), 'plain')
      return
    }
  }
  if (DIFF_COMMENT_SEPARATOR.test(line)) {
    sink.push(line, 'comment')
    return
  }
  const anchored = DIFF_COMMENT_ANCHORED.test(line)
  const midline = anchored ? -1 : line.search(DIFF_COMMENT_MIDLINE)
  const commentStart = anchored ? 0 : midline
  if (commentStart >= 0) {
    sink.push(line.slice(0, commentStart), 'plain')
    sink.push(line.slice(commentStart), 'comment')
    return
  }
  const token: CodeHighlightToken = line.startsWith('+') || line.startsWith('!')
    ? 'addition'
    : line.startsWith('-')
      ? 'deletion'
      : 'plain'
  sink.push(line, token)
}

function tokenizeDiff(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    let end = code.indexOf('\n', i)
    const hasNewline = end !== -1
    if (!hasNewline) end = code.length
    pushDiffLine(code.slice(i, end), sink)
    if (hasNewline) sink.push('\n', 'plain')
    i = hasNewline ? end + 1 : end
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * TOML / INI (key/value config dialects)
 * ---------------------------------------------------------------------- */

/** Dialect switches between TOML (tables, datetimes, `"""`) and INI (`;`, `:`). */
type ConfigDialect = {
  /** Comment lead characters (`#` for TOML, `#`/`;` for INI). */
  commentChars: string
  /** INI also accepts `key: value` next to `key = value`. */
  colonSeparator: boolean
  /** TOML `"""…"""` / `'''…'''` strings and `[[array.of.tables]]` headers. */
  toml: boolean
}

const TOML_DIALECT: ConfigDialect = { commentChars: '#', colonSeparator: false, toml: true }
const INI_DIALECT: ConfigDialect = { commentChars: '#;', colonSeparator: true, toml: false }

const CONFIG_BARE_KEY_PATTERN = /[A-Za-z0-9_-]+/y
const CONFIG_DOTTED_KEY_PATTERN = /[A-Za-z0-9_.-]+/y
const CONFIG_NAME_PATTERN = /[A-Za-z0-9_.-]+/y
const CONFIG_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*/y
const CONFIG_NUMBER_PATTERN = /-?(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/y
const CONFIG_DATE_PATTERN = /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?/y
const CONFIG_PUNCT_PATTERN = /[=[\]{},]+/y
const TOML_BOOLEAN_WORDS = new Set(['true', 'false'])
const INI_BOOLEAN_WORDS = new Set(['true', 'false', 'yes', 'no', 'on', 'off'])

/** Section header contents: `[server]`, `[a.b]`, `[[steps]]`, `["quoted key"]`. */
function pushConfigSectionName(name: string, sink: ReturnType<typeof createSink>) {
  let i = 0
  while (i < name.length) {
    const ch = name[i]
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < name.length && (name[j] === ' ' || name[j] === '\t')) j++
      sink.push(name.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(name, i, ch, false, false)
      sink.push(name.slice(i, end), 'string')
      i = end
      continue
    }
    const part = matchAt(CONFIG_NAME_PATTERN, name, i)
    if (part) {
      sink.push(part, 'builtin')
      i += part.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
}

function tokenizeConfig(code: string, dialect: ConfigDialect): CodeHighlightSegment[] {
  const sink = createSink()
  const booleans = dialect.toml ? TOML_BOOLEAN_WORDS : INI_BOOLEAN_WORDS
  let i = 0
  let atLineStart = true
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') {
      sink.push('\n', 'plain')
      atLineStart = true
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (dialect.commentChars.includes(ch) && (atLineStart || isSpace(code[i - 1]))) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (atLineStart && ch === '[') {
      const doubled = dialect.toml && code[i + 1] === '['
      const open = doubled ? 2 : 1
      const close = code.indexOf(doubled ? ']]' : ']', i + open)
      const lineEnd = code.indexOf('\n', i)
      if (close > i + open && (lineEnd === -1 || close < lineEnd)) {
        sink.push(code.slice(i, i + open), 'punct')
        pushConfigSectionName(code.slice(i + open, close), sink)
        sink.push(code.slice(close, close + open), 'punct')
        i = close + open
        atLineStart = false
        continue
      }
    }
    if (ch === '"' || ch === "'") {
      if (dialect.toml && code.startsWith(ch + ch + ch, i)) {
        const delimiter = ch + ch + ch
        let end = code.indexOf(delimiter, i + 3)
        end = end === -1 ? code.length : end + 3
        sink.push(code.slice(i, end), 'string')
        atLineStart = false
        i = end
        continue
      }
      const end = scanQuoted(code, i, ch, dialect.toml && ch === '"', false)
      sink.push(code.slice(i, end), 'string')
      atLineStart = false
      i = end
      continue
    }
    if (ch === '=' || (dialect.colonSeparator && ch === ':')) {
      sink.push(ch, 'punct')
      atLineStart = false
      i++
      continue
    }
    if (atLineStart) {
      const key = matchAt(dialect.toml ? CONFIG_DOTTED_KEY_PATTERN : CONFIG_BARE_KEY_PATTERN, code, i)
      if (key) {
        let k = i + key.length
        while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
        if (code[k] === '=' || (dialect.colonSeparator && code[k] === ':')) {
          sink.push(key, 'property')
          atLineStart = false
          i += key.length
          continue
        }
      }
    }
    if (dialect.toml && ch >= '0' && ch <= '9') {
      const date = matchAt(CONFIG_DATE_PATTERN, code, i)
      if (date) {
        sink.push(date, 'number')
        atLineStart = false
        i += date.length
        continue
      }
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const number = matchAt(CONFIG_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        atLineStart = false
        i += number.length
        continue
      }
    }
    const word = matchAt(CONFIG_WORD_PATTERN, code, i)
    if (word) {
      sink.push(word, booleans.has(word.toLowerCase()) ? 'keyword' : 'plain')
      atLineStart = false
      i += word.length
      continue
    }
    const run = matchAt(CONFIG_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      atLineStart = false
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    atLineStart = false
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Dockerfile
 * ---------------------------------------------------------------------- */

const DOCKERFILE_INSTRUCTIONS = wordSet(`add arg as cmd copy entrypoint env expose from healthcheck label maintainer onbuild run shell stopsignal user volume workdir`)
const DOCKERFILE_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*/y
const DOCKERFILE_FLAG_PATTERN = /--?[A-Za-z0-9][A-Za-z0-9-]*/y
const DOCKERFILE_PUNCT_PATTERN = /[=[\]{},:;()]+/y

function tokenizeDockerfile(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  // Instructions are the first word of a line (leading spaces included);
  // continuation lines keep their words plain.
  let atLineStart = true
  // Instruction of the current line, for the `FROM ... AS stage` alias.
  let instruction = ''
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') {
      sink.push('\n', 'plain')
      atLineStart = true
      instruction = ''
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    // Only a line-leading `#` is a comment; elsewhere it is an argument.
    if (atLineStart && ch === '#') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      atLineStart = false
      i = end
      continue
    }
    if (ch === '$') {
      const variable = matchAt(SHELL_VAR_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        atLineStart = false
        i += variable.length
        continue
      }
    }
    // Flags need a token boundary, so `node:20-alpine` keeps `-alpine` plain.
    if (ch === '-' && (i === 0 || isSpace(code[i - 1]))) {
      const flag = matchAt(DOCKERFILE_FLAG_PATTERN, code, i)
      if (flag) {
        sink.push(flag, 'attr')
        i += flag.length
        continue
      }
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(PLAIN_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        atLineStart = false
        i += number.length
        continue
      }
    }
    const word = matchAt(DOCKERFILE_WORD_PATTERN, code, i)
    if (word) {
      const lower = word.toLowerCase()
      if (atLineStart && DOCKERFILE_INSTRUCTIONS.has(lower)) {
        sink.push(word, 'keyword')
        instruction = lower
      } else if (instruction === 'from' && lower === 'as') {
        // `FROM image AS stage`: the alias belongs to the FROM instruction.
        sink.push(word, 'keyword')
      } else {
        sink.push(word, 'plain')
      }
      atLineStart = false
      i += word.length
      continue
    }
    const run = matchAt(DOCKERFILE_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      atLineStart = false
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    atLineStart = false
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Makefile
 * ---------------------------------------------------------------------- */

const MAKEFILE_DIRECTIVES = wordSet(`define else enddef endif endef export ifdef ifeq ifndef ifneq include override private sinclude unexport vpath`)
const MAKEFILE_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*/y
const MAKEFILE_TARGET_PATTERN = /[A-Za-z_.%/][A-Za-z0-9_.%/-]*/y
const MAKEFILE_ASSIGN_PATTERN = /[:?+!]?=/y
const MAKEFILE_VARIABLE_PATTERN = /\$(?:\([^)\n]*\)|\{[^}\n]*\}|[A-Za-z_@<^?*$])/y
const MAKEFILE_FLAG_PATTERN = /--?[A-Za-z0-9][A-Za-z0-9-]*/y
const MAKEFILE_SEPARATOR_PATTERN = /[;|&]+/y

function tokenizeMakefile(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  let atLineStart = true
  // A leading tab opens a recipe line; `commandStart` marks the command word
  // of that recipe (and the words after `;` / `|` / `&&`).
  let recipe = false
  let commandStart = false
  while (i < code.length) {
    const ch = code[i]
    if (ch === '\n') {
      sink.push('\n', 'plain')
      atLineStart = true
      recipe = false
      commandStart = false
      i++
      continue
    }
    if (ch === '\t' && atLineStart && !recipe) {
      sink.push('\t', 'plain')
      recipe = true
      commandStart = true
      atLineStart = false
      i++
      continue
    }
    if (ch === ' ' || ch === '\t') {
      let j = i + 1
      while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '#') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      commandStart = false
      i = end
      continue
    }
    if (ch === '$') {
      const variable = matchAt(MAKEFILE_VARIABLE_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        commandStart = false
        atLineStart = false
        i += variable.length
        continue
      }
    }
    if (recipe && ch === '-' && (i === 0 || isSpace(code[i - 1]))) {
      const flag = matchAt(MAKEFILE_FLAG_PATTERN, code, i)
      if (flag) {
        sink.push(flag, 'attr')
        commandStart = false
        i += flag.length
        continue
      }
    }
    if (!recipe && atLineStart) {
      // Rule head: `target: deps` (a `:=` assignment is not a rule).
      const target = matchAt(MAKEFILE_TARGET_PATTERN, code, i)
      if (target) {
        if (code[i + target.length] === ':' && code[i + target.length + 1] !== '=') {
          sink.push(target, 'function')
          atLineStart = false
          i += target.length
          continue
        }
        let k = i + target.length
        while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
        if (matchAt(MAKEFILE_ASSIGN_PATTERN, code, k)) {
          sink.push(target, 'property')
          atLineStart = false
          i += target.length
          continue
        }
      }
      const directive = matchAt(MAKEFILE_WORD_PATTERN, code, i)
      if (directive && MAKEFILE_DIRECTIVES.has(directive)) {
        sink.push(directive, 'keyword')
        atLineStart = false
        i += directive.length
        continue
      }
    }
    const word = matchAt(MAKEFILE_WORD_PATTERN, code, i)
    if (word) {
      sink.push(word, recipe && commandStart ? 'function' : 'plain')
      commandStart = false
      atLineStart = false
      i += word.length
      continue
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(PLAIN_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        commandStart = false
        atLineStart = false
        i += number.length
        continue
      }
    }
    const assignment = matchAt(MAKEFILE_ASSIGN_PATTERN, code, i)
    if (assignment) {
      sink.push(assignment, 'punct')
      commandStart = false
      atLineStart = false
      i += assignment.length
      continue
    }
    if (ch === ':') {
      sink.push(':', 'punct')
      atLineStart = false
      i++
      continue
    }
    const separator = matchAt(MAKEFILE_SEPARATOR_PATTERN, code, i)
    if (separator) {
      sink.push(separator, 'punct')
      commandStart = recipe
      i += separator.length
      continue
    }
    sink.push(ch, 'plain')
    commandStart = false
    atLineStart = false
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * PowerShell
 * ---------------------------------------------------------------------- */

const POWERSHELL_KEYWORDS = wordSet(`begin break catch class continue data default do dynamicparam else elseif end enum exit filter finally for foreach function hidden if in namespace param process return sequence static switch throw trap try until using var while workflow`)
/** `-eq`/`-notmatch`/… operators, told apart from `-Parameter` arguments. */
const POWERSHELL_OPERATORS = wordSet(`and as band bnot bor bxor contains eq ge gt in is isnot le like lt match ne not notcontains notin notlike notmatch or replace shl shr split join`)
const POWERSHELL_VARIABLE_PATTERN = /\$(?:[A-Za-z_][A-Za-z0-9_:]*|\{[^}\n]*\}|[?!$^_]|\d+)/y
const POWERSHELL_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y
/** `Verb-Noun` cmdlets (plain `foo-bar` identifiers land here too). */
const POWERSHELL_COMMAND_PATTERN = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z][A-Za-z0-9]*)+/y
const POWERSHELL_PARAMETER_PATTERN = /-[A-Za-z][A-Za-z0-9-]*/y
const POWERSHELL_NUMBER_PATTERN = /(?:0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.[\d_]+)?(?:[kKmMgGtTpP][bB]?)?)/y
const POWERSHELL_PUNCT_PATTERN = /[{}()[\],;.=<>!+*/%&|^~?:]+/y

function tokenizePowershell(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '#') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('<#', i)) {
      let end = code.indexOf('#>', i + 2)
      end = end === -1 ? code.length : end + 2
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === '@' && (code[i + 1] === '"' || code[i + 1] === "'")) {
      // Here-strings (`@"…"@` / `@'…'@`) close on the quote + `@` at a line start.
      const quote = code[i + 1]
      const terminator = `\n${quote}@`
      const close = code.indexOf(terminator, i + 2)
      const end = close === -1 ? code.length : close + terminator.length
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '"' || ch === "'") {
      // PowerShell escapes with a backtick; single quotes are literal.
      const end = ch === '"'
        ? scanQuoted(code, i, '"', true, false, '`')
        : scanQuoted(code, i, "'", false, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '$') {
      const variable = matchAt(POWERSHELL_VARIABLE_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        i += variable.length
        continue
      }
    }
    if (ch === '-') {
      const parameter = matchAt(POWERSHELL_PARAMETER_PATTERN, code, i)
      if (parameter) {
        sink.push(parameter, POWERSHELL_OPERATORS.has(parameter.slice(1).toLowerCase()) ? 'keyword' : 'attr')
        i += parameter.length
        continue
      }
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(POWERSHELL_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        i += number.length
        continue
      }
    }
    const command = matchAt(POWERSHELL_COMMAND_PATTERN, code, i)
    if (command) {
      sink.push(command, 'function')
      i += command.length
      continue
    }
    const word = matchAt(POWERSHELL_WORD_PATTERN, code, i)
    if (word) {
      sink.push(word, POWERSHELL_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'plain')
      i += word.length
      continue
    }
    const run = matchAt(POWERSHELL_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * GraphQL
 * ---------------------------------------------------------------------- */

const GRAPHQL_KEYWORDS = wordSet(`directive enum extend fragment implements input interface mutation on query repeatable scalar schema subscription type union true false null`)
const GRAPHQL_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y
const GRAPHQL_VARIABLE_PATTERN = /\$[A-Za-z_][A-Za-z0-9_]*/y
const GRAPHQL_DIRECTIVE_PATTERN = /@[A-Za-z_][A-Za-z0-9_]*/y
const GRAPHQL_PUNCT_PATTERN = /[{}()[\],:!|&=.]+/y

function tokenizeGraphql(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '#') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('"""', i)) {
      // Block string / description.
      let end = code.indexOf('"""', i + 3)
      end = end === -1 ? code.length : end + 3
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '"') {
      const end = scanQuoted(code, i, '"', true, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch === '$') {
      const variable = matchAt(GRAPHQL_VARIABLE_PATTERN, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        i += variable.length
        continue
      }
    }
    if (ch === '@') {
      const directive = matchAt(GRAPHQL_DIRECTIVE_PATTERN, code, i)
      if (directive) {
        sink.push(directive, 'builtin')
        i += directive.length
        continue
      }
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(PLAIN_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        i += number.length
        continue
      }
    }
    const word = matchAt(GRAPHQL_WORD_PATTERN, code, i)
    if (word) {
      let k = i + word.length
      while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++
      // Keyword → selection/field call → argument name → type name (capitalized).
      if (GRAPHQL_KEYWORDS.has(word)) sink.push(word, 'keyword')
      else if (code[k] === '(') sink.push(word, 'function')
      else if (code[k] === ':') sink.push(word, 'property')
      else if (word[0] >= 'A' && word[0] <= 'Z') sink.push(word, 'builtin')
      else sink.push(word, 'plain')
      i += word.length
      continue
    }
    const run = matchAt(GRAPHQL_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      i += run.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Protobuf (reuses the C-family tokenizer)
 * ---------------------------------------------------------------------- */

const PROTOBUF_KEYWORDS = wordSet(`enum extend extensions false group import map max message oneof option optional package public repeated required reserved returns rpc service stream syntax to true weak`)
const PROTOBUF_BUILTINS = wordSet(`bool bytes double fixed32 fixed64 float int32 int64 sfixed32 sfixed64 sint32 sint64 string uint32 uint64`)

const PROTOBUF_OPTIONS: CLikeOptions = {
  keywords: PROTOBUF_KEYWORDS,
  builtins: PROTOBUF_BUILTINS,
  lineComment: '//',
  blockComment: BLOCK_COMMENT,
}

/* -------------------------------------------------------------------------
 * nginx / Apache httpd configs
 * ---------------------------------------------------------------------- */

/** Dialect switches (Apache variables and `<Section …>` tags). */
type ServerConfigDialect = {
  variablePattern: RegExp
  angleSections: boolean
}

const NGINX_DIALECT: ServerConfigDialect = { variablePattern: /\$[A-Za-z_][A-Za-z0-9_]*/y, angleSections: false }
const APACHE_DIALECT: ServerConfigDialect = { variablePattern: /(?:\$|%)(?:\{[^}\n]*\}|[A-Za-z0-9_]+)/y, angleSections: true }

const SERVER_DIRECTIVE_PATTERN = /[A-Za-z_][A-Za-z0-9_.-]*/y
const SERVER_VALUE_PATTERN = /[^\s;{}()"'#]+/y
const SERVER_NUMBER_PATTERN = /\d+(?:\.\d+)?[kKmMgGhHdD]?/y
const SERVER_PUNCT_PATTERN = /[{};()]+/y
const APACHE_SECTION_ARG_PATTERN = /[^\s>"']+/y

/** Emit one `<Directory …>` / `</Directory>` Apache section; returns after `>`. */
function pushAngleSection(code: string, start: number, sink: ReturnType<typeof createSink>): number {
  const closing = code[start + 1] === '/'
  sink.push(closing ? '</' : '<', 'punct')
  let i = start + (closing ? 2 : 1)
  let first = true
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    if (ch === '>') {
      sink.push('>', 'punct')
      return i + 1
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, false, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (first) {
      const name = matchAt(SERVER_DIRECTIVE_PATTERN, code, i)
      if (name) {
        sink.push(name, 'tag')
        first = false
        i += name.length
        continue
      }
    }
    const argument = matchAt(APACHE_SECTION_ARG_PATTERN, code, i)
    if (argument) {
      sink.push(argument, 'attr')
      i += argument.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return i
}

function tokenizeServerConfig(code: string, dialect: ServerConfigDialect): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  // Directives start a statement: at a line start, after `;` or after a brace.
  let statementStart = true
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      const run = code.slice(i, j)
      sink.push(run, 'plain')
      if (run.includes('\n')) statementStart = true
      i = j
      continue
    }
    if (ch === '#' && (statementStart || isSpace(code[i - 1]))) {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (dialect.angleSections && ch === '<') {
      i = pushAngleSection(code, i, sink)
      statementStart = false
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      statementStart = false
      i = end
      continue
    }
    if (ch === '$' || ch === '%') {
      const variable = matchAt(dialect.variablePattern, code, i)
      if (variable) {
        sink.push(variable, 'builtin')
        statementStart = false
        i += variable.length
        continue
      }
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(SERVER_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        statementStart = false
        i += number.length
        continue
      }
    }
    const word = matchAt(SERVER_DIRECTIVE_PATTERN, code, i)
    if (word) {
      // The first word of a statement is the directive / context name.
      sink.push(word, statementStart ? 'keyword' : 'plain')
      statementStart = false
      i += word.length
      continue
    }
    const run = matchAt(SERVER_PUNCT_PATTERN, code, i)
    if (run) {
      sink.push(run, 'punct')
      if (run.includes('{') || run.includes('}') || run.includes(';')) statementStart = true
      i += run.length
      continue
    }
    const value = matchAt(SERVER_VALUE_PATTERN, code, i)
    if (value) {
      sink.push(value, 'plain')
      statementStart = false
      i += value.length
      continue
    }
    sink.push(ch, 'plain')
    statementStart = false
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Generic pass for unregistered language names (legacy highlightAuto stand-in)
 * ---------------------------------------------------------------------- */

/*
 * The legacy `<code-block>` called `hljs.highlight(code, {language})` when the
 * fence named a registered highlight.js grammar and `hljs.highlightAuto(code)`
 * otherwise, so an unregistered fence still came out colored. This module does
 * not detect languages; unregistered names instead get one conservative generic
 * scan over the signals that mean the same thing nearly everywhere: comments,
 * strings, numbers and a set of common cross-language keywords.
 *
 * Known differences from the legacy auto-detection: no language guessing, no
 * type/function/decorator tagging, and — see GENERIC_STRUCTURAL_TOKENS — a block
 * whose only matches are bare numbers stays verbatim.
 */
const GENERIC_KEYWORDS = wordSet(`abstract and as async await break case catch class const continue default def delete do done elif else elseif end endif enum except extends false finally fn for foreach from func function goto if implements import in include interface internal is let match module namespace new nil no none not null of or override package private protected public raise return sealed self static struct super switch then this throw throws trait true try type undefined until use using var virtual void when where while with yield yes`)

const GENERIC_WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/y
const GENERIC_NUMBER_PATTERN = /(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/y

/**
 * Tokens that make the generic pass confident enough to claim the block. A
 * scan that only found bare numbers (a data table, an ID list, `val x = 1`)
 * renders verbatim — low confidence, and the legacy contract for such blocks
 * (`CodeBlock` / `ToolCodeBlock` render no `qf-hl-*` span) stays intact.
 */
const GENERIC_STRUCTURAL_TOKENS: ReadonlySet<CodeHighlightToken> = new Set<CodeHighlightToken>(['comment', 'string', 'keyword'])

function tokenizeGeneric(code: string): CodeHighlightSegment[] {
  const sink = createSink()
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (isSpace(ch)) {
      let j = i + 1
      while (j < code.length && isSpace(code[j])) j++
      sink.push(code.slice(i, j), 'plain')
      i = j
      continue
    }
    // Comment markers only start a comment at a token boundary, so URLs
    // (`https://…`) and `color:#fff` are not mistaken for comments.
    const atBoundary = i === 0 || isSpace(code[i - 1])
    if (atBoundary && ch === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      const block = code[i + 1] === '*'
      const close = block ? code.indexOf('*/', i + 2) : code.indexOf('\n', i)
      const end = close === -1 ? code.length : close + (block ? 2 : 0)
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (atBoundary && ch === '#') {
      let end = code.indexOf('\n', i)
      if (end === -1) end = code.length
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (code.startsWith('<!--', i)) {
      let end = code.indexOf('-->', i + 4)
      end = end === -1 ? code.length : end + 3
      sink.push(code.slice(i, end), 'comment')
      i = end
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = scanQuoted(code, i, ch, true, false)
      sink.push(code.slice(i, end), 'string')
      i = end
      continue
    }
    if (ch >= '0' && ch <= '9') {
      const number = matchAt(GENERIC_NUMBER_PATTERN, code, i)
      if (number) {
        sink.push(number, 'number')
        i += number.length
        continue
      }
    }
    const word = matchAt(GENERIC_WORD_PATTERN, code, i)
    if (word) {
      sink.push(word, GENERIC_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'plain')
      i += word.length
      continue
    }
    sink.push(ch, 'plain')
    i++
  }
  return sink.segments
}

/* -------------------------------------------------------------------------
 * Dispatch table
 * ---------------------------------------------------------------------- */

const LANGUAGE_TOKENIZERS: Record<string, (code: string) => CodeHighlightSegment[]> = {
  apache: (code) => tokenizeServerConfig(code, APACHE_DIALECT),
  bash: tokenizeBash,
  c: (code) => tokenizeCLike(code, C_OPTIONS),
  cpp: (code) => tokenizeCLike(code, CPP_OPTIONS),
  css: tokenizeCss,
  diff: tokenizeDiff,
  dockerfile: tokenizeDockerfile,
  go: (code) => tokenizeCLike(code, GO_OPTIONS),
  graphql: tokenizeGraphql,
  ini: (code) => tokenizeConfig(code, INI_DIALECT),
  java: (code) => tokenizeCLike(code, JAVA_OPTIONS),
  javascript: (code) => tokenizeCLike(code, JAVASCRIPT_OPTIONS),
  json: tokenizeJson,
  makefile: tokenizeMakefile,
  markdown: tokenizeMarkdown,
  markup: tokenizeMarkup,
  nginx: (code) => tokenizeServerConfig(code, NGINX_DIALECT),
  powershell: tokenizePowershell,
  protobuf: (code) => tokenizeCLike(code, PROTOBUF_OPTIONS),
  python: (code) => tokenizeCLike(code, PYTHON_OPTIONS),
  rust: (code) => tokenizeCLike(code, RUST_OPTIONS),
  sql: tokenizeSql,
  toml: (code) => tokenizeConfig(code, TOML_DIALECT),
  typescript: (code) => tokenizeCLike(code, TYPESCRIPT_OPTIONS),
  yaml: tokenizeYaml,
}
