import { t } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import {
  currentSubagentToolSummariesWithMemory,
  buildSubagentRunPayload,
  canOpenSubagentRunPayload,
  resolveSubagentRunPayloadForOpen,
  shouldPublishSubagentRunPayload,
  subagentRunStore,
  OPEN_SUBAGENT_RUN_EVENT,
  SubagentToolSummaryMemory,
  type SubagentRunPayload,
} from '@/lib/subagent-run-detail'
import { renderStatus, renderToolIcon, renderToolMarquee, type ToolResultLike } from './shared'

/** 跑马灯「上一个工具」记忆：工具间隙回放最近非空摘要，运行卡不闪空（模块级，与渲染同生命周期）。 */
const subagentToolSummaryMemory = new SubagentToolSummaryMemory()

/**
 * 聊天流中的 run_subagent 摘要卡（T4 由 原 html`` 模板迁为 React）。
 *
 * 当前工具跑马灯：运行期间持续展示——pending 间隙（上一个工具已结束、下一个
 * 尚未开始）回放最近一次非空摘要，避免工作过程显示闪空消失；放在标签与状态之间，
 * 只占用剩余弹性空间（见 .quickforge-subagent-marquee），不遮挡标签与耗时。
 * 点击派发 OPEN_SUBAGENT_RUN_EVENT，Workspace Inspector 打开运行详情 Tab。
 */
export function renderSubagentRunSummary(payload: SubagentRunPayload) {
  const canOpen = canOpenSubagentRunPayload(payload)
  const title = canOpen ? t('viewSubagentRunDetails') : payload.statusLabel
  const currentTools = currentSubagentToolSummariesWithMemory(payload, subagentToolSummaryMemory)
  return (
    <div className="quickforge-subagent-tool">
      <button
        type="button"
        className="quickforge-tool-summary flex w-full cursor-pointer list-none items-center gap-2 text-left text-sm text-muted-foreground select-none disabled:cursor-not-allowed disabled:opacity-70"
        title={title}
        aria-label={`${payload.statusLabel} · ${title}`}
        aria-disabled={!canOpen ? 'true' : 'false'}
        disabled={!canOpen}
        onClick={() => {
          if (!canOpen) return
          // canonical 运行可取 SSE store 的最新同 ID 快照；历史 fallback 必须使用当前消息载荷。
          const payloadForOpen = resolveSubagentRunPayloadForOpen(payload, subagentRunStore.get(payload.runId))
          window.dispatchEvent(new CustomEvent(OPEN_SUBAGENT_RUN_EVENT, { detail: { runId: payloadForOpen.runId, payload: payloadForOpen } }))
        }}
      >
        {renderToolIcon('run_subagent')}
        <span className="quickforge-subagent-title min-w-0">
          <span className="quickforge-subagent-label">{payload.statusLabel}</span>
          {currentTools.length > 0 ? renderToolMarquee(currentTools.join(' · '), t('subagentRunningTools'), 'quickforge-subagent-marquee') : null}
          {/* 运行中隐藏状态区（icon+耗时），与 local-workspace 渲染器一致；运行态由 statusLabel 文案 + 跑马灯表达。 */}
          {payload.status === 'running' ? null : renderStatus(payload.status, payload.timing)}
        </span>
      </button>
    </div>
  )
}

export class SubagentToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const toolDisplaySettings = getCachedToolDisplaySettings()
    const payload = buildSubagentRunPayload(params, result, isStreaming, toolDisplaySettings.toolDisplayMode, t, result?.toolCallId)
    // renderer 仅发布 canonical 安全快照：首次可回填；若 SSE 快照仍是非终态，恢复出的
    // done/error 可修正它；其余已有快照不覆盖，保持 SSE 实时路径权威。
    const existing = subagentRunStore.get(payload.runId)
    if (shouldPublishSubagentRunPayload(payload, existing)) subagentRunStore.publish(payload)

    // 扁平轻量行契约：同 mcp-tool-renderer——旧版靠卡框重置压平，React 迁移后渲染器
    // 以 isCustom 输出，.qf-tool-message 根不带卡框类，summary 行样式自成一体。
    return {
      isCustom: true,
      content: renderSubagentRunSummary(payload),
    }
  }
}
