import type { AppTextKey } from '@/lib/i18n'
import { t } from '@/lib/i18n'
import { buildRecallExperienceViewModel, recallRecencyDays, type RecallExperienceKind } from '@/lib/recall-experience-history'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  ToolDetails,
  renderCodeBlock,
  renderConsoleBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  resultText,
  stringifyValue,
  toolDisplayDetailed,
  toolStatus,
  type ToolResultLike,
} from './shared'

/**
 * `recall_experience` 渲染器。
 *
 * 兜底卡把命中列表渲染成一整段 JSON，读不出「这条经验适不适用」；这里改为
 * 一行摘要 + 展开后的结构化条目列表（kind/scope/正文/质量指标），并复刻其他
 * 本地工具的骨架（quickforge-local-tool-shell > details > summary + mt-3 展开区）。
 *
 * 关键语义：0 条命中是**正常结果**，不是失败——摘要常显「无匹配」，展开区用
 * 中性灰字说明原因，只有 result.isError 才走 error 色与 console 块。
 */

const KIND_TEXT_KEY = {
  fact: 'dreamingKindFact',
  preference: 'dreamingKindPreference',
  experience: 'dreamingKindExperience',
  pitfall: 'dreamingKindPitfall',
  decision: 'dreamingKindDecision',
} as const satisfies Record<RecallExperienceKind, AppTextKey>

function relativeUpdatedAt(updatedAt: number | null) {
  const days = recallRecencyDays(updatedAt)
  if (days === null) return ''
  // 相对时间只到「天」：经验库的更新粒度本来就是天级，精确时间在设置页可查。
  if (days === 0) return t('recallExperienceUpdatedToday')
  return t('recallExperienceUpdatedDays', { count: days })
}

export class RecallExperienceToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const view = buildRecallExperienceViewModel(result)
    const count = view.memories.length
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const details = detailed ? stringifyValue(result?.details) : ''
    const errorText = status === 'error' ? resultText(result) : ''

    // 摘要：有 query 就显示 query，否则说明这是「最强记忆」列表。
    const summaryText = view.available
      ? view.query || t('recallExperienceBest')
      : typeof params?.query === 'string' ? params.query.trim() : ''

    // 计数是收尾信息：命中时只在 hover 露出，0 命中时属于结论，常显。
    const countLabel = count > 0
      ? t('recallExperienceHitCount', { count })
      : t('recallExperienceNoMatch')
    const countClass = count > 0 ? 'quickforge-tool-meta-hover' : 'quickforge-tool-meta-important'

    const emptyText = view.query
      ? t('recallExperienceEmptyMatch', { query: view.query })
      : t('recallExperienceEmptyAll')

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-recall-tool"
            initiallyOpen={false}
            aria-busy={status === 'running' ? 'true' : undefined}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon('recall_experience')}
              <span className="quickforge-tool-title min-w-0">
                <span className={status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>
                  {t('recallExperience')}
                  {summaryText ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {summaryText}</span> : null}
                </span>
                {renderToolChevron()}
                {view.available && status !== 'running'
                  ? <span className={`${countClass} quickforge-recall-count shrink-0`}>{countLabel}</span>
                  : null}
                {status === 'running' ? null : renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 min-w-0 max-w-full space-y-3">
              {count > 0 ? (
                <ul className="quickforge-recall-list">
                  {view.memories.map((memory) => {
                    const recency = relativeUpdatedAt(memory.updatedAt)
                    return (
                      <li className="quickforge-recall-item" key={memory.id}>
                        <div className="quickforge-recall-meta">
                          <span className="quickforge-recall-kind">{t(KIND_TEXT_KEY[memory.kind])}</span>
                          <span aria-hidden="true" className="quickforge-recall-sep">·</span>
                          <span>{t(memory.scope === 'project' ? 'dreamingScopeProject' : 'dreamingScopeGlobal')}</span>
                          {memory.recallCount > 0 ? (
                            <>
                              <span aria-hidden="true" className="quickforge-recall-sep">·</span>
                              <span>×{memory.recallCount}</span>
                            </>
                          ) : null}
                        </div>
                        <div className="quickforge-recall-content">{memory.content}</div>
                        {/* 质量指标不带标签：行内 `0.86 · 4.2 · 2 个会话 · 3 天前` 已够读，
                            完整名词挂在 title 上，避免辅助信息抢正文。 */}
                        <div className="quickforge-recall-metrics">
                          <span title={t('dreamingMemoryConfidence')}>{memory.confidence.toFixed(2)}</span>
                          <span aria-hidden="true" className="quickforge-recall-sep">·</span>
                          <span title={t('dreamingMemoryStrength')}>{memory.strength.toFixed(1)}</span>
                          {memory.sessionCount > 0 ? (
                            <>
                              <span aria-hidden="true" className="quickforge-recall-sep">·</span>
                              <span>{t('recallExperienceSessions', { count: memory.sessionCount })}</span>
                            </>
                          ) : null}
                          {recency ? (
                            <>
                              <span aria-hidden="true" className="quickforge-recall-sep">·</span>
                              <span>{recency}</span>
                            </>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {/* 0 命中：只在成功返回时给出「没查到」的说明；调用失败走下面的 console 块。 */}
              {view.available && count === 0 && status === 'done' ? (
                <div className="quickforge-recall-empty">{emptyText}</div>
              ) : null}
              {errorText ? renderConsoleBlock(errorText, 'error') : null}
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
