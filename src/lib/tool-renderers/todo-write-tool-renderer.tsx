import { t } from '@/lib/i18n'
import { TODO_STATUS_LABEL_KEY } from '@/lib/todo-status'
import { TodoStatusIcon } from '@/lib/todo-status-icon'
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
 * todo_write 渲染器（T4 由原 html`` 模板迁为 React，class 链保持不变）：
 * 历史摘要仅一行（视图模型见 todo-write-history），展开体为结构化任务列表
 * （compact 模式即有内容，修复展开为空）；detailed 模式列表在上、原始
 * input/details JSON 在下；默认折叠。
 *
 * 状态图标与文案统一来自 `src/lib/todo-status.tsx`（与 Composer 胶囊、置顶摘要
 * 共用），此处不再维护第三套图标与 label 映射。
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
    // snapshot 缺失/为空（null 或清空后的 []）时不渲染列表，回退现状。
    const todos = viewModel.snapshot && viewModel.snapshot.length > 0 ? viewModel.snapshot : null

    return {
      isCustom: true,
      content: (
        <div className="quickforge-local-tool-shell quickforge-todo-history-tool-shell">
          <ToolDetails
            className="group/tool quickforge-local-tool quickforge-todo-history-tool"
            initiallyOpen={false}
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
              {todos ? (
                <ul className={todos.length > 5 ? 'quickforge-todo-history-list quickforge-todo-history-list--scrollable text-xs' : 'quickforge-todo-history-list text-xs'}>
                  {todos.map((todo, index) => (
                    <li key={`${index}:${todo.content}`} className={`quickforge-todo-history-item quickforge-todo-history-item--${todo.status}`}>
                      <span className="quickforge-todo-history-status-icon" aria-hidden="true">
                        <TodoStatusIcon status={todo.status} />
                      </span>
                      <span className="sr-only">{t(TODO_STATUS_LABEL_KEY[todo.status])}</span>
                      <span className="quickforge-todo-history-content">{todo.content}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
              {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
            </div>
          </ToolDetails>
        </div>
      ),
    }
  }
}
