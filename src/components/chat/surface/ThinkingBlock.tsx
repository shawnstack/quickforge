import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { MarkdownBlock } from './Markdown'

/**
 * React replacement for the legacy `<thinking-block>` custom element.
 * Collapsible reasoning block; streams with a shimmer "Thinking..." label.
 * Collapsed by default — the header click remains the opt-in to reveal the
 * reasoning markdown (the process groups themselves default to expanded).
 */
type ThinkingBlockProps = {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming = false }: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="qf-thinking-block thinking-block">
      <button
        type="button"
        className="thinking-header flex cursor-pointer select-none items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={isExpanded}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        <ChevronRight className={cn('inline-block size-4 transition-transform', isExpanded && 'rotate-90')} />
        <span
          className={
            isStreaming
              ? 'animate-shimmer bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent'
              : ''
          }
        >
          {t('thinkingBlockLabel')}
        </span>
      </button>
      {isExpanded ? <MarkdownBlock content={content} isThinking /> : null}
    </div>
  )
}
