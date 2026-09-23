import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { MarkdownBlock } from './Markdown'
import { emitReadingIntent } from '../scroll-sync'

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
        /*
         * 流式期间装饰层（process-folding）每帧重排 header 子级，click 事件派发
         * 不可靠；与 shouldToggleProcessSummary（process-folding.ts）同一先例：
         * pointerdown 优先触发切换（不 preventDefault，保留原生 focus 等默认行为），
         * 真实鼠标产生的 click（e.detail > 0）视为已由 pointerdown 处理直接忽略，
         * 只有键盘 Enter/Space 或程序触发（e.detail === 0）的 click 才在这里切换。
         */
        onPointerDown={(event) => {
          setIsExpanded((expanded) => !expanded)
          // 手动展开/收起思考过程 = 阅读意图：解除贴底跟随，避免展开内容在
          // 下一帧被 resize/事件跟随滚动拉出视口（READING_INTENT_EVENT）。
          emitReadingIntent(event.currentTarget)
        }}
        onClick={(event) => {
          if (event.detail > 0) return
          setIsExpanded((expanded) => !expanded)
          emitReadingIntent(event.currentTarget)
        }}
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
