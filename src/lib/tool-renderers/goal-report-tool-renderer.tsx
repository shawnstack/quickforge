import { t } from '@/lib/i18n'
import { buildGoalReportHistoryViewModel } from '@/lib/goal-report-history'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  ToolDetails,
  renderCodeBlock,
  renderStatus,
  renderToolChevron,
  stringifyValue,
  toolDisplayDetailed,
  type ToolResultLike,
} from './shared'

/**
 * goal_report 渲染器（T4 由 原 html`` 模板迁为 React，class 链保持不变）：
 * 摘要/判定/范围/阻塞原因的结构化回放 + detailed 模式的原始 input/details/output。
 */
function goalReportIcon() {
  return <svg className="quickforge-tool-type-icon shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="14" r="8" /><circle cx="10" cy="14" r="4" /><path d="M21 3 10 14" /><path d="M10 10v4h4" /></svg>
}

function criterionStatusIcon(status: string) {
  const cls = 'quickforge-goal-report-criterion-icon shrink-0'
  if (status === 'passed') return <svg className={cls} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 12 2.5 2.5L16 9" /></svg>
  if (status === 'failed') return <svg className={cls} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 9l-6 6" /><path d="M9 9l6 6" /></svg>
  if (status === 'needs_review') return <svg className={cls} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
  return <svg className={cls} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /></svg>
}

export class GoalReportToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const view = buildGoalReportHistoryViewModel(params, result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const details = detailed ? stringifyValue(result?.details) : ''
    const output = detailed ? stringifyValue(result?.content) : ''
    const criteriaItems: Array<{ description: string; status: string }> = view.criteriaDetails.length
      ? view.criteriaDetails
      : view.criteria.map((description) => ({ description, status: 'pending' }))
    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-goal-report-tool"
            initiallyOpen={false}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {goalReportIcon()}
              <span className="quickforge-tool-title min-w-0">
                <span className="quickforge-tool-label">{t(view.summaryKey)}<span className="quickforge-tool-summary-detail text-muted-foreground"> · {t(view.actionKey)}{view.actionKey === 'goalReportAction' && view.action ? ` · ${view.action}` : ''}</span></span>
                {renderToolChevron()}
                {renderStatus(view.status, timing)}
              </span>
            </summary>
            <div className="quickforge-goal-report-tool-body mt-3 space-y-3 min-w-0 [overflow-wrap:anywhere]">
              <div className="text-xs text-muted-foreground">{t(view.resultKey)}</div>
              {view.summary ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalSummaryLabel')}</div><div className="whitespace-pre-wrap">{view.summary}</div></div> : null}
              {criteriaItems.length ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalCriteriaLabel')}</div><div className="quickforge-goal-report-criteria">{criteriaItems.map((item, index) => (
                <div className="quickforge-goal-report-criterion" data-status={item.status} key={index}>{criterionStatusIcon(item.status)}<span className="whitespace-pre-wrap">{item.description}</span></div>
              ))}</div></div> : null}
              {view.scope.length ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalScopeLabel')}</div><div className="quickforge-goal-report-scope">{view.scope.map((item, index) => <span className="quickforge-goal-report-scope-chip" key={index}>{item}</span>)}</div></div> : null}
              {view.blocker ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalBlockerLabel')}</div><div className="quickforge-goal-report-blocker whitespace-pre-wrap">{view.blocker}</div></div> : null}
              {!detailed && view.outputText ? <div className="whitespace-pre-wrap">{view.outputText}</div> : null}
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
              {output ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>{renderCodeBlock(output, 'json')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
