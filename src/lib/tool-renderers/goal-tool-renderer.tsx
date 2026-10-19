import { t } from '@/lib/i18n'
import { buildGoalToolHistoryViewModel } from '@/lib/goal-tool-history'
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

function goalToolIcon() {
  return <svg className="quickforge-tool-type-icon shrink-0 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="14" r="8" /><circle cx="10" cy="14" r="4" /><path d="M21 3 10 14" /><path d="M10 10v4h4" /></svg>
}

function compact(value: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

/**
 * get_goal / create_goal / update_goal 的只读历史卡片。
 * 与 goal_report 共用无边框 summary 行，默认收起，不提供任何 goal 操作。
 */
export class GoalToolRenderer {
  private toolName: string

  constructor(toolName: string) {
    this.toolName = toolName
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const view = buildGoalToolHistoryViewModel(this.toolName, params, result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const details = detailed ? stringifyValue(result?.details) : ''
    const output = detailed ? stringifyValue(result?.content) : ''
    const summary = compact(view.objective)
    const actionLabel = view.action ? t(view.actionKey) : ''
    const phaseLabel = view.phaseKey ? t(view.phaseKey) : ''
    const detail = [actionLabel, phaseLabel, summary].filter(Boolean).join(' · ')
    const rounds = view.roundsStarted !== null && view.maxGoalRounds !== null
      ? `${view.roundsStarted}/${view.maxGoalRounds}`
      : ''
    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-goal-tool"
            initiallyOpen={false}
            aria-busy={view.status === 'running' ? 'true' : undefined}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {goalToolIcon()}
              <span className="quickforge-tool-title min-w-0">
                <span className={view.status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>{t(view.summaryKey)}{detail ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {detail}</span> : null}</span>
                {renderToolChevron()}
                {view.status === 'running' ? null : renderStatus(view.status, timing)}
              </span>
            </summary>
            <div className="quickforge-goal-report-tool-body mt-3 space-y-3 min-w-0 [overflow-wrap:anywhere]">
              {view.objective ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalToolObjectiveLabel')}</div><div className="whitespace-pre-wrap">{view.objective}</div></div> : null}
              {phaseLabel ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalToolPhaseLabel')}</div><div>{phaseLabel}{view.activation ? ` · ${t(view.activation === 'armed' ? 'goalToolArmed' : 'goalToolDisarmed')}` : ''}</div></div> : null}
              {rounds ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalToolRoundsLabel')}</div><div>{rounds}</div></div> : null}
              {view.blockedReason ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('goalBlockerLabel')}</div><div className="quickforge-goal-report-blocker whitespace-pre-wrap">{view.blockedReason}</div></div> : null}
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
