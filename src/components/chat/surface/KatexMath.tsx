import { memo } from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
// KaTeX stylesheet import, same pattern as `@xterm/xterm/css/xterm.css` in
// TerminalPane.tsx: the component owns its styling, so the `katex-*`
// selectors ship again without re-porting src/index.css.
import 'katex/dist/katex.min.css'

type KatexMathProps = {
  latex: string
  display?: boolean
}

const renderOptions = (display: boolean): KatexOptions => ({
  throwOnError: false,
  displayMode: display,
  // `output: 'html'` mirrors the legacy pi-web-ui markdown renderer.
  output: 'html',
})

/**
 * Renders the `qf-math` hast elements produced by `rehypeQfMath`
 * (src/lib/chat-math.ts) with KaTeX. `throwOnError: false` turns parse
 * errors into a visible `katex-error` span; an unexpected throw falls back
 * to the raw LaTeX in red monospace instead of crashing the message list.
 * Display math is wrapped in a `my-4` block, matching the legacy renderer;
 * the block also carries `quickforge-katex-scroll` so wide formulas scroll
 * inside their own row (hidden scrollbar, touch-friendly) instead of
 * stretching the chat column and surfacing a bottom scrollbar (H5).
 */
export const KatexMath = memo(function KatexMath({ latex, display = false }: KatexMathProps) {
  let html: string
  try {
    html = katex.renderToString(latex, renderOptions(display))
  } catch {
    return <span className="text-red-500 font-mono">{latex}</span>
  }
  if (display) {
    return <div className="quickforge-katex-scroll my-4" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})
