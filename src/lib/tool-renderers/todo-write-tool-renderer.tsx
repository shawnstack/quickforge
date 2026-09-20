import { t } from '@/lib/i18n'
import { buildTodoWriteHistoryViewModel } from '@/lib/todo-write-history'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  ToolDetails,
  renderCodeBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  stringifyValue,
  toolDisplayDetailed,
  type ToolResultLike,
} from './shared'

/**
 * todo_write 渲染器（T4 由 原 html`` 模板迁为 React，class 链保持不变）：
 * 历史摘要仅一行（视图模型见 todo-write-history），detailed 模式附原始
 * input/details；默认折叠。
 */
export class TodoWriteToolRenderer {
  render(
    params: Record<string, unknown> | undefined,
    result: ToolResultLike | undefined,
    isStreaming?: boolean,
  ) {
    const viewModel = buildTodoWriteHistoryViewModel({ result, isStreaming })
    const status = viewModel.status
    const timing = extractQuickForgeTiming(result?.details)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const details = detailed ? stringifyValue(result?.details) : ''

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell quickforge-todo-history-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-todo-history-tool"
            initiallyOpen={detailed}
          >
            <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
              {renderToolIcon('todo_write')}
              <span className="quickforge-tool-title min-w-0">
                <span className="quickforge-tool-label">{t(viewModel.summaryKey, viewModel.summaryParams)}</span>
                {renderToolChevron()}
                {renderStatus(status, timing)}
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
