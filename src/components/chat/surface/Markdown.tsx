/* eslint-disable react-refresh/only-export-components -- exports the MarkdownBlock component plus the pure image-scheme guard covered by tests. */
import { Fragment, isValidElement, memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { preprocessLatexDelimiters, rehypeQfMath } from '@/lib/chat-math'
import { ContentCache, memoizeContent } from '@/lib/render-cache'
import { cn } from '@/lib/utils'
import { CodeBlock, codeBlockLanguage } from './CodeBlock'
import { KatexMath } from './KatexMath'
import { LocalFilePathLink } from './LocalFilePathLink'
import { splitStableMarkdown } from './markdown-stream-chunks'
import { rehypeQfLocalFilePaths } from './rehype-local-file-paths'

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
  /**
   * False while the message is still streaming. In-flight content changes on
   * every frame, so it must not enter the content-addressed caches; the final
   * body is cached once when the row commits.
   */
  finalized?: boolean
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

// `qf-math` elements come from rehypeQfMath (src/lib/chat-math.ts) and
// `qf-file-path` elements from rehypeQfLocalFilePaths. Neither tag is an
// intrinsic element, so the extra keys are asserted onto Components.
const markdownComponentsWithMath: Components = {
  ...markdownComponents,
  'qf-math': KatexMath,
  'qf-file-path': ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
    const path = node?.properties?.['data-path']
    return typeof path === 'string' ? <LocalFilePathLink path={path} /> : null
  },
} as Components

/** Plugin lists are module-level constants: stable identities across renders. */
const markdownRemarkPlugins = [remarkGfm]

/**
 * 解析产物缓存（内容寻址）。
 *
 * 关键事实：`react-markdown` 的默认导出是**普通函数**（`Markdown(options)` →
 * `post(processor.runSync(processor.parse(file)), options)`），不是带 hook 的
 * 组件。所以可以在渲染期直接调用它拿到一棵已解析的元素树，而不是把它当组件
 * 交给 React——后者会在每次 remount 时重新执行整条 unified 流水线。
 *
 * 缓存键只需 `content`：`remarkPlugins` / `components` 都是模块级常量，
 * `rehypePlugins` 只携带由同一 `content` 决定的 math token 映射（token 由
 * `preprocessLatexDelimiters` 按内容缓存，因此同一 content 必然得到同一组
 * token，进而同一棵元素树）。
 *
 * 元素树是不可变描述：复用不会让渲染结果取决于挂载历史。外层组件（`CodeBlock`
 * 等）读取的 context 变化仍由 React 正常传播，这里跳过的只是字符串解析与
 * 插件执行。
 */
const markdownElementCache = new ContentCache<ReactNode>(300, 8 * 1024 * 1024)

/**
 * 流式稳定块的元素树缓存。
 *
 * 与 {@link markdownElementCache} 分开：块缓存的生命周期只有一回合（块文本随
 * 流式增长不断变化），单独限额可以避免它把历史消息的整段渲染挤出去。
 */
const streamingBlockCache = new ContentCache<ReactNode>(200, 4 * 1024 * 1024)

/** 清空 Markdown 元素缓存（测试隔离与内存回收）。 */
export function clearMarkdownElementCache(): void {
  markdownElementCache.clear()
  streamingBlockCache.clear()
}

function renderMarkdownTree(content: string, cacheable: boolean): ReactNode {
  // `\(…\)`/`\[…\]` must be swapped for placeholder tokens before markdown
  // parsing (markdown would eat the backslash); the token map is handed to
  // rehypeQfMath below to resolve them back into LaTeX.
  const { content: mathContent, tokens } = preprocessLatexDelimiters(content, cacheable)
  // Called as a plain function (not `<ReactMarkdown>`): the parse result is
  // what we want to cache, and React elements are plain objects.
  return ReactMarkdown({
    children: mathContent,
    remarkPlugins: markdownRemarkPlugins,
    rehypePlugins: [[rehypeQfMath, { tokens }], [rehypeQfLocalFilePaths]],
    components: markdownComponentsWithMath,
    skipHtml: true,
  })
}

/**
 * Markdown block for chat message content.
 *
 * Empty/whitespace content renders nothing (callers skip empty text chunks,
 * but the guard keeps the component safe for standalone use).
 */
export const MarkdownBlock = memo(function MarkdownBlock({ content, isThinking = false, finalized = true }: MarkdownBlockProps) {
  // 流式内容按「稳定块 + 活动尾块」渲染：已闭合的块按块缓存元素树，跨帧复用；
  // 只有尾块每帧重新解析。切分不安全时 `splitStableMarkdown` 返回 null，退回
  // 改动前的整段解析（视觉输出逐字一致）。
  // Hook 必须在早退之前无条件调用。
  const streamingChunks = useMemo(
    () => (finalized ? null : splitStableMarkdown(content)),
    [content, finalized],
  )
  if (!content.trim()) return null
  const body = finalized
    ? memoizeContent(markdownElementCache, [content], () => renderMarkdownTree(content, true))
    : streamingChunks
      ? (
        <>
          {streamingChunks.blocks.map((block, index) => (
            <Fragment key={index}>
              {memoizeContent(streamingBlockCache, [block], () => renderMarkdownTree(block, true))}
            </Fragment>
          ))}
          {renderMarkdownTree(streamingChunks.tail, false)}
        </>
      )
      : renderMarkdownTree(content, false)
  return (
    <div
      className={cn(
        'qf-markdown-block max-w-none break-words [&>*:last-child]:!mb-0',
        isThinking ? 'text-sm italic text-muted-foreground' : 'text-foreground',
      )}
      data-qf-thinking={isThinking ? 'true' : undefined}
    >
      {body}
    </div>
  )
})
