/* eslint-disable react-refresh/only-export-components -- exports the MarkdownBlock component plus the pure image-scheme guard covered by tests. */
import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { preprocessLatexDelimiters, rehypeQfMath } from '@/lib/chat-math'
import { cn } from '@/lib/utils'
import { CodeBlock, codeBlockLanguage } from './CodeBlock'
import { KatexMath } from './KatexMath'

/**
 * React replacement for the legacy `<markdown-block>` custom element.
 *
 * Rendering chain follows the project's existing Markdown pipeline
 * (`react-markdown` + `remark-gfm`, see `MarkdownReader.tsx`). Fenced code
 * blocks are delegated to `CodeBlock`, which carries the legacy
 * `code-block` capabilities (copy button, language title bar, mermaid/svg
 * previews, run-in-terminal). Math (`$...$`, `$$...$$`, `\(...\)`,
 * `\[...\]`) goes through the chat-math pipeline (`src/lib/chat-math.ts`)
 * and is rendered as KaTeX by `KatexMath`, matching the legacy renderer. A
 * `qf-markdown-block` hook class is added for surface-scoped styling.
 */

type MarkdownBlockProps = {
  content: string
  isThinking?: boolean
}

/**
 * Text of a react-markdown `code` element. `react-markdown` passes fenced code
 * as a plain string (sometimes a string array), so flatten both.
 */
function codeText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map((child) => (typeof child === 'string' ? child : '')).join('')
  return ''
}

/**
 * Markdown image sources come from untrusted chat/model output. Allow only
 * http(s), `data:image/*`, `blob:` and scheme-less (relative) sources;
 * everything else (`javascript:`, `vbscript:`, `data:text/html`, …) is
 * blocked. Defense in depth on top of react-markdown's URL transform.
 */
export function isSafeMarkdownImageSrc(src: string): boolean {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(src)
  if (!schemeMatch) return true // relative path, query or `#anchor`
  const scheme = schemeMatch[1].toLowerCase()
  if (scheme === 'http' || scheme === 'https' || scheme === 'blob') return true
  return scheme === 'data' && /^image\//i.test(src.slice(schemeMatch[0].length))
}

const markdownComponents: Components = {
  // 旧 `<markdown-block>` 渲染器对超链接无条件加 `target="_blank"` +
  // `rel="noopener noreferrer"`（不区分协议）。
  a: ({ href, children }) => (
    <a className="text-primary underline" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ src, alt, title }) => (
    <img
      className="my-2 max-w-full rounded-lg"
      // Empty/stripped or scheme-unsafe sources omit the attribute entirely
      // (rendering `src=""` would re-request the page as an image).
      src={src && isSafeMarkdownImageSrc(src) ? src : undefined}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
    />
  ),
  blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-border pl-4 text-muted-foreground">{children}</blockquote>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6">{children}</ol>,
  li: ({ children, className }) => <li className={className}>{children}</li>,
  hr: () => <hr className="my-8 border-border" />,
  // 旧 `markdown-block` 渲染器把表格包进 `overflow-x-auto my-2 border
  // border-border rounded` 滚动容器（宽表格横向滚动，不再撑破消息列）。
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 border border-border rounded">
      <table>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
  pre: ({ children }) => {
    const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : undefined
    if (!codeElement) return <pre className="overflow-auto px-3 pb-3 text-xs">{children}</pre>
    return (
      <CodeBlock
        // The legacy markdown layer passed `language="text"` for fences without
        // an info string, so the title bar showed `text` (not `plaintext`).
        language={codeBlockLanguage(codeElement.props.className) ?? 'text'}
        source={codeText(codeElement.props.children).replace(/\n$/, '')}
      />
    )
  },
  code: ({ className, children }) => (
    <code className={`${className ?? ''} rounded bg-muted px-1.5 py-0.5 font-mono text-sm`}>{children}</code>
  ),
  input: ({ type, checked, disabled }) =>
    type === 'checkbox' ? (
      <input className="mr-2 align-middle accent-primary" type="checkbox" checked={checked} disabled={disabled ?? true} readOnly />
    ) : null,
}

// `qf-math` elements come from rehypeQfMath (src/lib/chat-math.ts). The tag
// is not an intrinsic element, so the extra key is asserted onto Components.
const markdownComponentsWithMath: Components = {
  ...markdownComponents,
  'qf-math': KatexMath,
} as Components

/**
 * Markdown block for chat message content.
 *
 * Empty/whitespace content renders nothing (callers skip empty text chunks,
 * but the guard keeps the component safe for standalone use).
 */
export const MarkdownBlock = memo(function MarkdownBlock({ content, isThinking = false }: MarkdownBlockProps) {
  if (!content.trim()) return null
  // `\(…\)`/`\[…\]` must be swapped for placeholder tokens before markdown
  // parsing (markdown would eat the backslash); the token map is handed to
  // rehypeQfMath below to resolve them back into LaTeX.
  const { content: mathContent, tokens } = preprocessLatexDelimiters(content)
  return (
    <div
      className={cn(
        'qf-markdown-block max-w-none break-words [&>*:last-child]:!mb-0',
        isThinking ? 'text-sm italic text-muted-foreground' : 'text-foreground',
      )}
      data-qf-thinking={isThinking ? 'true' : undefined}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeQfMath, { tokens }]]}
        components={markdownComponentsWithMath}
        skipHtml
      >
        {mathContent}
      </ReactMarkdown>
    </div>
  )
})
