import { Loader2 } from 'lucide-react'
import { useSentinel } from '@/hooks/useSentinel'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  sidebarRowClass,
  sidebarSessionTitleClass,
} from './sidebar-classes'

export function LoadMoreSentinel({ onLoadMore, enabled }: { onLoadMore: () => void; enabled: boolean }) {
  const ref = useSentinel(onLoadMore, enabled)
  if (!enabled) return null
  return (
    <div ref={ref} className="flex items-center justify-center py-1">
      <Loader2 className="size-3 animate-spin" />
    </div>
  )
}

export function SessionDisplayControls({
  visibleCount,
  loadedCount,
  hasMore,
  loading,
  onShowMore,
  sidebarOpen = true,
  indent = false,
}: {
  visibleCount: number
  loadedCount: number
  hasMore: boolean
  loading: boolean
  onShowMore: () => void
  /** 与会话行一致：收起态居中、展开态 px-2。 */
  sidebarOpen?: boolean
  /** 项目分区的会话行有 pl-8 缩进，按钮需跟随，否则左边缘比会话标题更靠左。 */
  indent?: boolean
}) {
  const canShowMore = visibleCount < loadedCount || hasMore
  if (!canShowMore) return null

  return (
    <button
      type="button"
      className={cn(
        sidebarRowClass(sidebarOpen),
        'w-full text-muted-foreground/50 hover:bg-[var(--quickforge-sidebar-hover-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45',
        indent && sidebarOpen && 'pl-8',
      )}
      onClick={onShowMore}
      disabled={loading}
      aria-label={t('sidebarShowMore')}
    >
      <span className={sidebarSessionTitleClass}>
        {loading ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : t('sidebarShowMore')}
      </span>
    </button>
  )
}
