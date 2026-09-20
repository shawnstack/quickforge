import { isValidElement, useMemo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isMermaidLanguage } from '@/lib/mermaid-renderer'
import { MermaidDiagram } from './MermaidDiagram'
import { MonacoCodeViewer } from './MonacoCodeViewer'
import { resolveMarkdownImageSource } from './markdown-resource'

type MarkdownReaderProps = {
  projectId?: string
  path: string
  content: string
  language: string
  mode: MarkdownMode
  wordWrap?: boolean
}

type MarkdownMode = 'preview' | 'source'

type CodeElementProps = {
  className?: string
  children?: ReactNode
}

function codeLanguage(className: string | undefined) {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]
}

function createMarkdownComponents(projectId: string | undefined, path: string): Components {
  return {
    h1: ({ children }) => <h1 className="mt-8 mb-3 border-b border-border pb-3 text-3xl font-semibold tracking-tight">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-8 mb-3 border-b border-border pb-2 text-2xl font-semibold tracking-tight">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-8 mb-3 text-xl font-semibold">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-8 mb-3 text-lg font-semibold">{children}</h4>,
    h5: ({ children }) => <h5 className="mt-8 mb-3 text-base font-semibold">{children}</h5>,
    h6: ({ children }) => <h6 className="mt-8 mb-3 text-base font-semibold">{children}</h6>,
    p: ({ children }) => <p className="my-4">{children}</p>,
    a: ({ href, children }) => (
      <a
        className="text-primary underline-offset-4 hover:underline"
        href={href}
        target={href?.startsWith('http') || href?.startsWith('//') ? '_blank' : undefined}
        rel="noreferrer"
      >
        {children}
      </a>
    ),
    img: ({ src, alt, title }) => {
      const resolvedSource = resolveMarkdownImageSource(projectId, path, src)
      if (!resolvedSource) return alt ? <span className="text-muted-foreground">{alt}</span> : null
      return (
        <img
          className="my-5 h-auto max-w-full rounded-xl border border-border object-contain"
          src={resolvedSource}
          alt={alt ?? ''}
          title={title}
          loading="lazy"
        />
      )
    },
    blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-border pl-4">{children}</blockquote>,
    ul: ({ children, className }) => <ul className={`my-4 list-disc space-y-1 pl-6 ${className ?? ''}`}>{children}</ul>,
    ol: ({ children, className }) => <ol className={`my-4 list-decimal space-y-1 pl-6 ${className ?? ''}`}>{children}</ol>,
    li: ({ children, className }) => <li className={className}>{children}</li>,
    hr: () => <hr className="my-6 border-border" />,
    table: ({ children }) => (
      <div className="my-5 overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="">{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className="border-t first:border-t-0">{children}</tr>,
    th: ({ children }) => <th className="border-b border-border px-3 py-2 font-semibold">{children}</th>,
    td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
    pre: ({ children }) => {
      const codeElement = isValidElement<CodeElementProps>(children) ? children : undefined
      const language = codeLanguage(codeElement?.props.className)
      const source = String(codeElement?.props.children ?? '').replace(/\n$/, '')
      if (isMermaidLanguage(language)) return <MermaidDiagram source={source} />

      return (
        <figure className="my-5 overflow-hidden rounded-xl border border-border">
          {language ? <figcaption className="border-b border-border px-3 py-1.5 font-mono text-[11px]">{language}</figcaption> : null}
          <pre className="overflow-auto p-4 text-[12px] leading-5 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
        </figure>
      )
    },
    code: ({ className, children }) => (
      <code className={`${className ?? ''} rounded px-1 py-0.5 font-mono text-[0.85em]`}>
        {children}
      </code>
    ),
    input: ({ type, checked, disabled }) => type === 'checkbox' ? (
      <input className="mr-2 align-middle" type="checkbox" checked={checked} disabled={disabled ?? true} readOnly />
    ) : null,
  }
}

export function MarkdownReader({ projectId, path, content, language, mode, wordWrap = false }: MarkdownReaderProps) {
  const components = useMemo(() => createMarkdownComponents(projectId, path), [projectId, path])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {mode === 'source' ? (
          <MonacoCodeViewer path={path} content={content} language={language} wordWrap={wordWrap} />
        ) : (
          <div className="h-full overflow-auto bg-background">
            <article className="quickforge-markdown-reader mx-auto max-w-3xl px-8 py-7 text-sm leading-7">
              {content.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
                  {content}
                </ReactMarkdown>
              ) : <p className="">This Markdown file is empty.</p>}
            </article>
          </div>
        )}
      </div>
    </div>
  )
}
