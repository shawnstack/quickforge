import { Search } from 'lucide-react'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import type { QuickForgeSessionMetadata } from '@/lib/types'
import { searchDialogClass } from './sidebar-classes'
import { formatSessionTime } from './sidebar-utils'

export type SidebarSearchResult = {
  session: QuickForgeSessionMetadata
  projectName: string
}

/** 侧栏会话搜索对话框：输入即过滤（最多 8 条），点击结果加载会话，Escape/遮罩关闭。 */
export function SidebarSearchDialog({
  query,
  results,
  loadingSessionId,
  inputRef,
  onQueryChange,
  onClose,
  onSelectResult,
}: {
  query: string
  results: SidebarSearchResult[]
  loadingSessionId?: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  onClose: () => void
  onSelectResult: (sessionId: string) => void
}) {
  return (
    <div className={searchDialogClass} role="dialog" aria-modal="true" onMouseDown={() => onClose()}>
      <div className="w-full max-w-xl rounded-2xl border border-border bg-popover p-3 shadow-quickforge" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
          <Search className="size-4 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
            }}
            placeholder={t('searchDialog')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="mt-2 max-h-[50vh] overflow-y-auto">
          {query.trim() ? (
            results.length > 0 ? (
              results.map(({ session, projectName }) => (
                <button
                  key={session.id}
                  type="button"
                  aria-busy={loadingSessionId === session.id}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors"
                  onClick={() => onSelectResult(session.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{sessionTitle(session.title)}</span>
                    <span className="block truncate text-[11px]">{projectName || t('normalChat')} · {formatSessionTime(session.lastModified)}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-xs">{t('noSearchResults')}</div>
            )
          ) : (
            <div className="px-3 py-3 text-xs">{t('searchHint')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
