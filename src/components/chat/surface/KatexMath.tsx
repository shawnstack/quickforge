/* eslint-disable react-refresh/only-export-components -- exports the KatexMath component plus the cache-reset helper covered by tests. */
import { memo } from 'react'
import katex from 'katex'
import type { KatexOptions } from 'katex'
import { ContentCache, memoizeContent } from '@/lib/render-cache'
// KaTeX stylesheet import, same pattern as `@xterm/xterm/css/xterm.css` in
// TerminalPane.tsx: the component owns its styling, so the `katex-*`
// selectors ship again without re-porting the global stylesheet.
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
 * KaTeX 输出的内容寻址缓存。
 *
 * `katex.renderToString` 是 (latex, display) 的纯函数，但 React 的 `memo`
 * 只在同一次挂载内生效：会话切换会整树 remount（`ChatSurface` 按会话 key），
 * 历史消息里的每个公式都会重新执行一次 renderToString。按内容缓存后，
 * 二次打开同一会话的公式渲染成本降为查表。
 *
 * 只缓存成功结果；`throwOnError: false` 让语法错误也产出 html（红色 fallback
 * 由 KaTeX 自己生成），异常路径不入缓存，与原先行为一致。
 */
const katexHtmlCache = new ContentCache<string>(400)

function renderKatexHtml(latex: string, display: boolean): string {
  return memoizeContent(katexHtmlCache, [display ? '1' : '0', latex], () => katex.renderToString(latex, renderOptions(display)))
}

/** 清空 KaTeX 输出缓存（测试隔离与内存回收）。 */
export function clearKatexHtmlCache(): void {
  katexHtmlCache.clear()
}

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
    html = renderKatexHtml(latex, display)
  } catch {
    return <span className="text-red-500 font-mono">{latex}</span>
  }
  if (display) {
    return <div className="quickforge-katex-scroll my-4" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />
})
