import { t, type AppTextKey } from '@/lib/i18n'
import { summarizeParams } from '@/lib/tool-param-summary'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  detailsWithoutDiffText,
  getDiffDetails,
  isRecord,
  ToolDetails,
  renderCodeBlock,
  renderConsoleBlock,
  renderDiff,
  renderInlineDiffStats,
  renderPreviewButton,
  renderStatus,
  renderTerminateCommandButton,
  renderToolChevron,
  renderToolFileSummary,
  renderToolIcon,
  stringifyValue,
  toolDisplayDetailed,
  toolOutputText,
  toolStatus,
  type ToolResultLike,
} from './shared'

/**
 * 本地工作区工具（manage_global_memory / read_file / grep_files / write_file /
 * edit_file / run_command / present_files / activate_skill /
 * read_skill_resource）的通用渲染器，T4 由 原 html`` 模板迁为 React。
 *
 * class 链与 DOM 结构逐字复刻原模板：quickforge-local-tool-shell > details >
 * summary（图标 + 标题 + 折叠箭头 + diff 统计 + 状态）+ 展开区（input/output/
 * diff/details），外加 quickforge-tool-actions（预览 / 终止命令按钮）。
 */
export class LocalWorkspaceToolRenderer {
  private toolName: string
  private labelKey: AppTextKey

  constructor(toolName: string, labelKey: AppTextKey) {
    this.toolName = toolName
    this.labelKey = labelKey
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    // write_file / edit_file / read_file 摘要区渲染 FileIcon + basename 的整体元素（见
    // renderToolFileSummary）；其余工具保持 summarizeParams 纯文本摘要。
    const summary = (this.toolName === 'write_file' || this.toolName === 'edit_file' || this.toolName === 'read_file')
      ? renderToolFileSummary(this.toolName, params)
      : summarizeParams(this.toolName, params, result)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const output = toolOutputText(this.toolName, params, result, isStreaming)
    const diff = getDiffDetails(result?.details)
    const isNewFile = isRecord(result?.details) && result?.details?.created === true
    const details = detailed ? stringifyValue(diff ? detailsWithoutDiffText(result?.details) : result?.details) : ''
    const variant = result?.isError ? 'error' as const : 'default' as const

    return {
      // QuickForge process rows are intentionally borderless. Rendering as
      // custom content keeps the chat surface from adding its default tool card
      // before the DOM decoration pass moves the tool into the Process group.
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool"
            initiallyOpen={false}
            aria-busy={status === 'running' ? 'true' : undefined}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon(this.toolName)}
              <span className="quickforge-tool-title min-w-0">
                <span className={status === 'running' ? 'quickforge-tool-label quickforge-tool-running-sweep' : 'quickforge-tool-label'}>{t(this.labelKey)}{summary ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {summary}</span> : null}</span>
                {renderToolChevron()}
                {(this.toolName === 'write_file' || this.toolName === 'edit_file') ? renderInlineDiffStats(diff) : null}
                {status === 'running' ? null : renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {output ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>{this.toolName === 'run_command' ? renderConsoleBlock(output, variant) : renderCodeBlock(output, 'text')}</div> : null}
              {typeof diff?.text === 'string' ? renderDiff(diff, isNewFile) : null}
              {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
            </div>
          </ToolDetails>
          <span className="quickforge-tool-actions inline-flex shrink-0 items-center gap-1">
            {renderPreviewButton(this.toolName, params)}
            {renderTerminateCommandButton(this.toolName, status, result?.details)}
          </span>
        </div>
      ),
    }
  }
}
