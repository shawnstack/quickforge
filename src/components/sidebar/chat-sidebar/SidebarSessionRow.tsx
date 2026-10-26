import { Archive, Loader2, Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import type { BackgroundTaskStatus, QuickForgeSessionMetadata } from '@/lib/types'
import {
  activeRowClass,
  activeSessionTitleClass,
  actionOverlayClass,
  overlayArchiveButtonClass,
  overlayIconButtonClass,
  sessionButtonClass,
  sessionInactiveRowClass,
  sessionMetaHoverHiddenClass,
  sessionTitleRowClass,
  sidebarRowClass,
  sidebarSessionTitleClass,
  timeClass,
} from './sidebar-classes'
import { SessionTitleMarquee } from './SessionTitleMarquee'

/** 四种会话行的差异全部集中在这个变体判别上：
 *  - pinned：div[role=button]（键盘 Enter/Space）+ unpin 图标 + pinnedAt 时间；
 *  - timeline：与 project/global 一致，运行/未读状态替换时间文本；
 *  - project：行加 gap-1 与 pl-8 缩进；
 *  - global：基准形态。 */
export type SidebarSessionRowVariant = 'pinned' | 'timeline' | 'project' | 'global'

type SidebarSessionRowProps = {
  variant: SidebarSessionRowVariant
  session: QuickForgeSessionMetadata
  selected: boolean
  loading: boolean
  deleting: boolean
  actionsSuppressed: boolean
  confirmingDelete: boolean
  sidebarOpen: boolean
  /** 已格式化的时间文本；运行/未读时由状态指示器替换。 */
  timeText: string
  sessionTaskStatus: (session: QuickForgeSessionMetadata) => BackgroundTaskStatus
  completedSessionIds: Set<string>
  onLoadSession: (sessionId: string) => void
  onTogglePin: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void
  onRequestDelete: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void
  onConfirmDelete: (event: React.MouseEvent<HTMLButtonElement>, sessionId: string) => void
  onHoverTipEnter: (event: React.MouseEvent<HTMLElement>, sessionId: string) => void
  onHoverTipHide: (sessionId: string) => void
  onRowMouseLeave: (sessionId: string, deleting: boolean) => void
}

function sessionTimeSlotContent(
  session: QuickForgeSessionMetadata,
  timeText: string,
  sessionTaskStatus: SidebarSessionRowProps['sessionTaskStatus'],
  completedSessionIds: Set<string>,
) {
  if (sessionTaskStatus(session) === 'running') {
    return <Loader2 className="inline-block size-3 animate-spin" aria-label="运行中" />
  }
  if (completedSessionIds.has(session.id)) {
    return <span className="inline-block size-1.5 rounded-full bg-emerald-500" aria-label="未读" />
  }
  return timeText
}

export function SidebarSessionRow({
  variant,
  session,
  selected,
  loading,
  deleting,
  actionsSuppressed,
  confirmingDelete,
  sidebarOpen,
  timeText,
  sessionTaskStatus,
  completedSessionIds,
  onLoadSession,
  onTogglePin,
  onRequestDelete,
  onConfirmDelete,
  onHoverTipEnter,
  onHoverTipHide,
  onRowMouseLeave,
}: SidebarSessionRowProps) {
  const timeSlotContent = sessionTimeSlotContent(session, timeText, sessionTaskStatus, completedSessionIds)
  const titleMarquee = (
    <SessionTitleMarquee
      className={cn(sidebarSessionTitleClass, selected && activeSessionTitleClass)}
      title={sessionTitle(session.title)}
    />
  )

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity,transform] duration-(--quickforge-dur-exit) ease-(--quickforge-ease-out) motion-reduce:transition-none',
        deleting ? 'grid-rows-[0fr] -translate-x-1 opacity-0' : 'grid-rows-[1fr] translate-x-0 opacity-100',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            sidebarRowClass(sidebarOpen),
            variant === 'project' && 'gap-1',
            variant === 'project' && sidebarOpen && 'pl-8',
            selected ? activeRowClass : sessionInactiveRowClass,
            deleting && 'pointer-events-none scale-[0.98] opacity-0 duration-(--quickforge-dur-exit) ease-(--quickforge-ease-out) motion-reduce:transition-none',
          )}
          onMouseEnter={(event) => onHoverTipEnter(event, session.id)}
          onClickCapture={() => onHoverTipHide(session.id)}
          onMouseLeave={() => onRowMouseLeave(session.id, deleting)}
          onClick={() => onLoadSession(session.id)}
        >
          {variant === 'pinned' ? (
            <div
              role="button"
              tabIndex={0}
              aria-busy={loading}
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onLoadSession(session.id)
              }}
            >
              <div className="min-w-0 flex-1">
                <div className={sessionTitleRowClass}>{titleMarquee}</div>
              </div>
              <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{timeSlotContent}</span>
            </div>
          ) : (
            <button className={sessionButtonClass} type="button" aria-busy={loading}>
              {variant === 'timeline' ? (
                <div className="min-w-0 flex-1">
                  <div className={sessionTitleRowClass}>{titleMarquee}</div>
                </div>
              ) : (
                <div className={sessionTitleRowClass}>{titleMarquee}</div>
              )}
              <span className={cn(timeClass, !actionsSuppressed && sessionMetaHoverHiddenClass)}>{timeSlotContent}</span>
            </button>
          )}
          <div className={cn(actionOverlayClass, actionsSuppressed && 'hidden')}>
            {confirmingDelete ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-6 rounded-full px-2 text-xs"
                onClick={(event) => onConfirmDelete(event, session.id)}
                aria-label={t('confirmArchive')}
                title={t('confirmArchive')}
              >
                {t('confirm')}
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={overlayIconButtonClass}
                  onClick={(event) => onTogglePin(event, session.id)}
                  aria-label={variant === 'pinned' ? t('unpinSession') : t('pinSession')}
                >
                  {variant === 'pinned' ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={overlayArchiveButtonClass}
                  onClick={(event) => onRequestDelete(event, session.id)}
                  aria-label={t('archiveSession')}
                >
                  <Archive className="size-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
