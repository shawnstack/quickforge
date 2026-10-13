import { t } from '@/lib/i18n'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  ToolDetails,
  renderCodeBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  resultText,
  stringifyValue,
  toolDisplayDetailed,
  type ToolResultLike,
} from './shared'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

type EvictionItem = {
  id?: unknown
  kind?: unknown
  toolName?: unknown
  tokens?: unknown
}

function evictionItems(value: unknown): EvictionItem[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as EvictionItem[] : []
}

/** 明细行标签：toolResult 用工具名，assistantText / 缺名回退通用标签。 */
function evictionItemLabel(item: EvictionItem) {
  if (item.kind !== 'assistantText' && typeof item.toolName === 'string' && item.toolName.trim()) return item.toolName
  return t(item.kind === 'assistantText' ? 'contextEvictionItemReply' : 'contextEvictionItemToolResult')
}

/** 下拉明细清单：短 id + 标签（+ 逐条 tokens，仅 forget）。 */
function renderEvictionItems(items: EvictionItem[], withTokens: boolean) {
  if (items.length === 0) return null
  return (
    <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground">
      {items.map((item, index) => {
        const id = typeof item.id === 'string' ? item.id : ''
        const tokens = numberOr(item.tokens, 0)
        return (
          <li key={id || `item-${index}`} className="flex min-w-0 items-baseline gap-2">
            {id ? <span className="shrink-0 font-mono opacity-70">#{id.slice(0, 8)}</span> : null}
            <span className="min-w-0 truncate">{evictionItemLabel(item)}</span>
            {withTokens && tokens > 0 ? <span className="shrink-0 opacity-80">~{tokens} tokens</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

/** 参数里的 reason：卡片摘要行以斜体次要色追加显示，悬停显示全文。 */
function renderReason(params: Record<string, unknown> | undefined) {
  const reason = typeof params?.reason === 'string' && params.reason.trim() ? params.reason.trim() : ''
  if (!reason) return null
  return (
    <span className="min-w-0 max-w-[16rem] truncate italic opacity-80" title={reason}>· {reason}</span>
  )
}

/**
 * context_forget / context_recall / context_report 工具卡渲染器：
 * 摘要行 = 工具图标 + 结果计数（遗忘条数/释放 tokens、召回条数、报告占比）
 * + 斜体 reason（仅 forget，来自调用参数）。forget 摘要区分三种 0 语义：
 * 新裁剪条数、另有多少条此前已裁剪、全部已裁剪过 / 无匹配。展开体默认
 * 恒有明细区（forget 逐条 id/工具/~tokens、recall 逐条 id/工具、report
 * 完整报告文本），detailed 模式再追加 input/details JSON（与 todo_write
 * 渲染器同构）。运行中/错误状态经 renderStatus 呈现。
 */
export class ContextEvictionToolRenderer {
  private readonly toolName: 'context_forget' | 'context_recall' | 'context_report'

  constructor(toolName: 'context_forget' | 'context_recall' | 'context_report') {
    this.toolName = toolName
  }

  render(
    params: Record<string, unknown> | undefined,
    result: ToolResultLike | undefined,
    isStreaming?: boolean,
  ) {
    const details = asRecord(result?.details)
    const timing = extractQuickForgeTiming(result?.details)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const detailsJson = detailed ? stringifyValue(result?.details) : ''

    let label: Parameters<typeof t>[0]
    let labelParams: Record<string, string | number> | undefined
    let alreadySuffixCount = 0
    const forgetItems = this.toolName === 'context_forget' && details ? evictionItems(details.forgottenNow) : []
    const recallItems = this.toolName === 'context_recall' && details ? evictionItems(details.recalledItems) : []
    const reportText = this.toolName === 'context_report' && details ? resultText(result) : ''

    if (this.toolName === 'context_forget') {
      if (!details) {
        label = 'contextForgetToolRunning'
      } else {
        const forgotten = numberOr(details.forgotten, 0)
        const already = numberOr(details.alreadyForgotten, 0)
        if (forgotten > 0) {
          label = 'contextForgetToolSummary'
          labelParams = { count: forgotten, tokens: numberOr(details.tokensFreed, 0) }
          if (already > 0) alreadySuffixCount = already
        } else if (already > 0) {
          label = 'contextForgetToolAllForgotten'
          labelParams = { count: already }
        } else {
          label = 'contextForgetToolNone'
        }
      }
    } else if (this.toolName === 'context_recall') {
      label = details ? 'contextRecallToolSummary' : 'contextRecallToolRunning'
      if (details) labelParams = { count: numberOr(details.recalled, 0) }
    } else {
      label = details ? 'contextReportToolSummary' : 'contextReportToolRunning'
      if (details) labelParams = { percent: numberOr(details.percent, 0), count: numberOr(details.forgottenCount, 0) }
    }

    const status = isStreaming ? 'running' : (result as { isError?: boolean } | undefined)?.isError ? 'error' : 'done'

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell quickforge-context-eviction-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-context-eviction-tool"
            initiallyOpen={false}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon(this.toolName)}
              <span className="quickforge-tool-title flex min-w-0 items-center gap-1">
                <span className="quickforge-tool-label shrink-0">{t(label, labelParams)}</span>
                {alreadySuffixCount > 0 ? (
                  <span className="quickforge-tool-label shrink-0 opacity-80">· {t('contextForgetToolAlreadySuffix', { count: alreadySuffixCount })}</span>
                ) : null}
                {renderReason(params)}
                {renderToolChevron()}
                {renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {forgetItems.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{t('contextForgetDetailsTitle')}</div>
                  {renderEvictionItems(forgetItems, true)}
                </div>
              ) : null}
              {recallItems.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{t('contextRecallDetailsTitle')}</div>
                  {renderEvictionItems(recallItems, false)}
                </div>
              ) : null}
              {reportText ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>
                  {renderCodeBlock(reportText, 'text')}
                </div>
              ) : null}
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {detailsJson ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(detailsJson, 'json')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
