import { useMemo, type ReactNode } from 'react'
import { MonacoCodeViewer } from './MonacoCodeViewer'

type MarkdownReaderProps = {
  path: string
  content: string
  language: string
  mode: MarkdownMode
}

type MarkdownMode = 'preview' | 'source'

function safeHref(value: string) {
  const href = value.trim()
  if (!href) return undefined
  if (/^(javascript|data|vbscript):/i.test(href)) return undefined
  if (/^(https?:|mailto:|#|\/|\.\.?\/)/i.test(href)) return href
  return undefined
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g
  let lastIndex = 0
  let index = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))

    const key = `${keyPrefix}-inline-${index++}`
    if (match[1]) {
      nodes.push(<code key={key} className="rounded bg-muted/35 px-1 py-0.5 font-mono text-[0.85em] text-foreground/90">{match[1]}</code>)
    } else if (match[2] && match[3]) {
      const href = safeHref(match[3])
      nodes.push(href ? (
        <a key={key} className="text-primary underline-offset-4 hover:underline" href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
          {match[2]}
        </a>
      ) : `[${match[2]}](${match[3]})`)
    } else if (match[4] || match[5]) {
      nodes.push(<strong key={key} className="font-semibold text-foreground/95">{match[4] || match[5]}</strong>)
    } else if (match[6] || match[7]) {
      nodes.push(<em key={key} className="italic">{match[6] || match[7]}</em>)
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes.length ? nodes : [text]
}

function renderInlineLines(text: string, keyPrefix: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => {
    const nodes = renderInline(line, `${keyPrefix}-line-${index}`)
    return index === 0 ? nodes : [<br key={`${keyPrefix}-br-${index}`} />, ...nodes]
  })
}

function isFence(line: string) {
  return /^\s*(```|~~~)/.test(line)
}

function isTableSeparator(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function looksLikeTable(lines: string[], index: number) {
  return Boolean(lines[index]?.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1]))
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index] ?? ''
  return (
    isFence(line) ||
    looksLikeTable(lines, index) ||
    /^\s{0,3}#{1,6}\s+/.test(line) ||
    /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^\s{0,3}>\s?/.test(line) ||
    /^\s{0,3}[-*+]\s+/.test(line) ||
    /^\s{0,3}\d+[.)]\s+/.test(line)
  )
}

function tableCells(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function renderMarkdown(content: string) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  let blockIndex = 0

  while (index < lines.length) {
    const line = lines[index]
    const key = `markdown-block-${blockIndex++}`

    if (!line.trim()) {
      index += 1
      continue
    }

    if (isFence(line)) {
      const fenceMatch = line.match(/^\s*(```|~~~)\s*([^`]*)$/)
      const fence = fenceMatch?.[1] ?? '```'
      const language = fenceMatch?.[2]?.trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <figure key={key} className="my-5 overflow-hidden rounded-xl border border-border bg-muted/20">
          {language ? <figcaption className="border-b border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground/65">{language}</figcaption> : null}
          <pre className="overflow-auto p-4 text-[12px] leading-5"><code>{codeLines.join('\n')}</code></pre>
        </figure>,
      )
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      const level = heading[1].length
      const text = heading[2]
      const className = [
        'mt-8 mb-3 border-border text-foreground/95',
        level === 1 ? 'border-b pb-3 text-3xl font-semibold tracking-tight' : '',
        level === 2 ? 'border-b pb-2 text-2xl font-semibold tracking-tight' : '',
        level === 3 ? 'text-xl font-semibold' : '',
        level === 4 ? 'text-lg font-semibold' : '',
        level >= 5 ? 'text-base font-semibold' : '',
      ].filter(Boolean).join(' ')
      const children = renderInline(text, `${key}-heading`)
      if (level === 1) blocks.push(<h1 key={key} className={className}>{children}</h1>)
      else if (level === 2) blocks.push(<h2 key={key} className={className}>{children}</h2>)
      else if (level === 3) blocks.push(<h3 key={key} className={className}>{children}</h3>)
      else if (level === 4) blocks.push(<h4 key={key} className={className}>{children}</h4>)
      else if (level === 5) blocks.push(<h5 key={key} className={className}>{children}</h5>)
      else blocks.push(<h6 key={key} className={className}>{children}</h6>)
      index += 1
      continue
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={key} className="my-6 border-border" />)
      index += 1
      continue
    }

    if (looksLikeTable(lines, index)) {
      const headers = tableCells(lines[index])
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]))
        index += 1
      }
      blocks.push(
        <div key={key} className="my-5 overflow-auto rounded-xl border border-border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/25 text-foreground/90">
              <tr>{headers.map((cell, cellIndex) => <th key={`${key}-th-${cellIndex}`} className="border-b border-border px-3 py-2 font-semibold">{renderInline(cell, `${key}-th-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${key}-row-${rowIndex}`} className="border-t border-border/70">
                  {headers.map((_, cellIndex) => <td key={`${key}-td-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top text-foreground/85">{renderInline(row[cellIndex] ?? '', `${key}-td-${rowIndex}-${cellIndex}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s{0,3}>\s?/, ''))
        index += 1
      }
      blocks.push(<blockquote key={key} className="my-4 border-l-2 border-border pl-4 text-muted-foreground/85">{renderInlineLines(quoteLines.join('\n'), `${key}-quote`)}</blockquote>)
      continue
    }

    if (/^\s{0,3}[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s{0,3}[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(<ul key={key} className="my-4 list-disc space-y-1 pl-6">{items.map((item, itemIndex) => <li key={`${key}-li-${itemIndex}`}>{renderInline(item, `${key}-li-${itemIndex}`)}</li>)}</ul>)
      continue
    }

    if (/^\s{0,3}\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s{0,3}\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s{0,3}\d+[.)]\s+/, ''))
        index += 1
      }
      blocks.push(<ol key={key} className="my-4 list-decimal space-y-1 pl-6">{items.map((item, itemIndex) => <li key={`${key}-li-${itemIndex}`}>{renderInline(item, `${key}-li-${itemIndex}`)}</li>)}</ol>)
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push(<p key={key} className="my-4 text-foreground/86">{renderInline(paragraphLines.join(' '), `${key}-p`)}</p>)
  }

  return blocks
}

export function MarkdownReader({ path, content, language, mode }: MarkdownReaderProps) {
  const renderedContent = useMemo(() => renderMarkdown(content), [content])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        {mode === 'source' ? (
          <MonacoCodeViewer path={path} content={content} language={language} />
        ) : (
          <div className="h-full overflow-auto bg-background">
            <article className="quickforge-markdown-reader mx-auto max-w-3xl px-8 py-7 text-sm leading-7 text-foreground/88">
              {renderedContent.length ? renderedContent : <p className="text-muted-foreground/70">This Markdown file is empty.</p>}
            </article>
          </div>
        )}
      </div>
    </div>
  )
}
