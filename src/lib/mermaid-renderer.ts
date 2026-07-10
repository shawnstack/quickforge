export const MERMAID_SOURCE_MAX_LENGTH = 100_000

const UNSAFE_SVG_MARKUP_PATTERN = /<\s*(script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=|(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i
const EXTERNAL_RESOURCE_ATTRIBUTE_PATTERN = /\b(?:href|xlink:href|src)\s*=\s*(["'])\s*(?:https?:)?\/\//i
const EXTERNAL_CSS_URL_PATTERN = /url\(\s*(["']?)\s*(?:https?:)?\/\//i
const EXTERNAL_CSS_IMPORT_PATTERN = /@import\s+(?:url\(\s*)?["']?\s*(?:https?:)?\/\//i

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
let renderSequence = 0

export function isMermaidLanguage(language: unknown) {
  return String(language ?? '').trim().toLowerCase() === 'mermaid'
}

export function isSafeMermaidSvg(svg: string) {
  const trimmed = svg.trim()
  return /^<svg[\s>]/i.test(trimmed)
    && /<\/svg>\s*$/i.test(trimmed)
    && !UNSAFE_SVG_MARKUP_PATTERN.test(trimmed)
    && !EXTERNAL_RESOURCE_ATTRIBUTE_PATTERN.test(trimmed)
    && !EXTERNAL_CSS_URL_PATTERN.test(trimmed)
    && !EXTERNAL_CSS_IMPORT_PATTERN.test(trimmed)
}

export function createMermaidSvgDataUrl(svg: string) {
  if (!isSafeMermaidSvg(svg)) throw new Error('Unsafe Mermaid SVG output')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

async function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'neutral',
      htmlLabels: false,
    })
    return mermaid
  })
  return mermaidPromise
}

export async function renderMermaidSvg(source: string) {
  const normalized = source.trim()
  if (!normalized) throw new Error('Mermaid source is empty')
  if (normalized.length > MERMAID_SOURCE_MAX_LENGTH) throw new Error('Mermaid source is too large')

  const mermaid = await loadMermaid()
  const renderId = `quickforge-mermaid-${Date.now().toString(36)}-${++renderSequence}`
  const { svg } = await mermaid.render(renderId, normalized)
  if (!isSafeMermaidSvg(svg)) throw new Error('Unsafe Mermaid SVG output')
  return svg
}
