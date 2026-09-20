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

type TodoHistoryItemStatus = 'pending' | 'in_progress' | 'completed'

function todoHistoryStatusLabel(status: TodoHistoryItemStatus) {
  if (status === 'completed') return t('todoWriteStatusCompleted')
  if (status === 'in_progress') return t('todoWriteStatusInProgress')
  return t('todoWriteStatusPending')
}

/* 状态图标与设计稿（design-mockups/todo-tool-card-structured.html）一致：
   pending 空心圆、in_progress 半填充圆、completed 实心勾（填充圆 + mask 镂空勾，
   不依赖卡片底色，任意表面下视觉一致；mask id 递增避免多实例引用串扰）。 */
let todoHistoryCheckMaskSeq = 0

function todoHistoryStatusIcon(status: TodoHistoryItemStatus) {
  if (status === 'completed') {
    const maskId = `quickforge-todo-history-check-${todoHistoryCheckMaskSeq++}`
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <mask id={maskId}>
          <rect width="24" height="24" fill="#fff" />
          <path d="m8.5 12.2 2.3 2.3 4.7-5" fill="none" stroke="#000" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
        <circle cx="12" cy="12" r="9" fill="currentColor" mask={`url(#${maskId})`} />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/**
 * todo_write 渲染器（T4 由 原 html`` 模板迁为 React，class 链保持不变）：
 * 历史摘要仅一行（视图模型见 todo-write-history），展开体为结构化任务列表
 * （compact 模式即有内容，修复展开为空）；detailed 模式列表在上、原始
 * input/details JSON 在下；默认折叠。
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
              {todos ? (
                <ul className={todos.length > 5 ? 'quickforge-todo-history-list quickforge-todo-history-list--scrollable text-xs' : 'quickforge-todo-history-list text-xs'}>
                  {todos.map((todo, index) => (
                    <li key={`${index}:${todo.content}`} className={`quickforge-todo-history-item quickforge-todo-history-item--${todo.status}`}>
                      <span className="quickforge-todo-history-status-icon" aria-hidden="true">{todoHistoryStatusIcon(todo.status)}</span>
                      <span className="sr-only">{todoHistoryStatusLabel(todo.status)}</span>
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
