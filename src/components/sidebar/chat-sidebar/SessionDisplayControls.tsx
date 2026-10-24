import { Loader2 } from 'lucide-react'
import { useSentinel } from '@/hooks/useSentinel'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  sidebarSessionRowBaseClass,
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
}: {
  visibleCount: number
  loadedCount: number
  hasMore: boolean
  loading: boolean
  onShowMore: () => void
}) {
  const canShowMore = visibleCount < loadedCount || hasMore
  if (!canShowMore) return null

  return (
    <button
      type="button"
      className={cn(
        sidebarSessionRowBaseClass,
        'w-full px-2 text-muted-foreground/50 hover:bg-[var(--quickforge-sidebar-hover-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45',
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
