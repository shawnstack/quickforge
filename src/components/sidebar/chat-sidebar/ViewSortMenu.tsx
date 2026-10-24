import { createPortal } from 'react-dom'
import { CalendarPlus, Check, Clock, Folder } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SidebarSessionSortMode, SidebarSessionViewMode } from '@/lib/types'
import { viewSortMenuClass, viewSortMenuItemClass, viewSortMenuSectionLabelClass } from './sidebar-classes'
import { viewSortMenuWidth } from './sidebar-utils'

/** 「视图 / 排序」菜单（Projects 区头 SlidersHorizontal 按钮弹出），fixed 定位由调用方计算。 */
export function ViewSortMenu({
  position,
  sessionViewMode,
  sessionSortMode,
  onSelectViewMode,
  onSelectSortMode,
}: {
  position: { x: number; y: number }
  sessionViewMode: SidebarSessionViewMode
  sessionSortMode: SidebarSessionSortMode
  onSelectViewMode: (mode: SidebarSessionViewMode) => void
  onSelectSortMode: (mode: SidebarSessionSortMode) => void
}) {
  return createPortal(
    <div
      className={viewSortMenuClass}
      style={{ left: position.x, top: position.y, width: viewSortMenuWidth }}
      role="menu"
      aria-label={t('filterSort')}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={viewSortMenuSectionLabelClass}>{t('sidebarView')}</div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={sessionViewMode === 'project'}
        className={viewSortMenuItemClass}
        onClick={() => onSelectViewMode('project')}
      >
        <Folder className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('sidebarViewByProject')}</span>
        {sessionViewMode === 'project' ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
      </button>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={sessionViewMode === 'timeline'}
        className={viewSortMenuItemClass}
        onClick={() => onSelectViewMode('timeline')}
      >
        <Clock className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('sidebarViewTimeline')}</span>
        {sessionViewMode === 'timeline' ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
      </button>
      <div className="my-1 border-t" style={{ borderColor: 'color-mix(in oklab, var(--muted-foreground) 50%, transparent)' }} />
      <div className={viewSortMenuSectionLabelClass}>{t('sortBy')}</div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={sessionSortMode === 'updatedAt'}
        className={viewSortMenuItemClass}
        onClick={() => onSelectSortMode('updatedAt')}
      >
        <Clock className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('sortByUpdatedAt')}</span>
        {sessionSortMode === 'updatedAt' ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
      </button>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={sessionSortMode === 'createdAt'}
        className={viewSortMenuItemClass}
        onClick={() => onSelectSortMode('createdAt')}
      >
        <CalendarPlus className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t('sortByCreatedAt')}</span>
        {sessionSortMode === 'createdAt' ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
      </button>
    </div>,
    document.body,
  )
}
