import {
  Activity,
  Archive,
  ChevronDown,
  Ellipsis,
  Folder,
  GitBranch,
  Menu,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Share2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'

type GitBranchMenuCallbacks = React.ComponentProps<typeof GitBranchMenu>

/** 主区顶栏：移动端菜单按钮、会话标题（含小屏项目/分支副行）、项目 chip、Git 分支
 *  菜单、「对话 / 轨迹」视图切换与会话「⋯」菜单（置顶 / 重命名 / 分享 / 归档）。 */
export function ConversationHeader({
  headerRef,
  onOpenMobileSidebar,
  title,
  projectName,
  projectId,
  gitRepository,
  gitBranch,
  gitDirtyCount,
  branchMenuOpen,
  onBranchMenuToggle,
  onCheckout,
  onBranchCreated,
  onOpenGraph,
  onOpenChanges,
  showViewSwitch,
  conversationView,
  onSetConversationView,
  conversationMenuOpen,
  onConversationMenuToggle,
  conversationMenuDisabled,
  currentSessionPinned,
  onTogglePinned,
  onRename,
  onShare,
  onArchive,
  backgroundTaskCount = 0,
  onOpenBackgroundTasks,
  mobileShell,
}: {
  headerRef: React.RefObject<HTMLElement | null>
  onOpenMobileSidebar: () => void
  title: string
  projectName?: string
  projectId?: string
  gitRepository: boolean
  gitBranch?: string
  gitDirtyCount: number
  branchMenuOpen: boolean
  onBranchMenuToggle: () => void
  onCheckout: GitBranchMenuCallbacks['onCheckout']
  onBranchCreated: GitBranchMenuCallbacks['onCreated']
  onOpenGraph: () => void
  onOpenChanges: () => void
  showViewSwitch: boolean
  conversationView: 'chat' | 'trace'
  onSetConversationView: (view: 'chat' | 'trace') => void
  conversationMenuOpen: boolean
  onConversationMenuToggle: () => void
  conversationMenuDisabled: boolean
  currentSessionPinned: boolean
  onTogglePinned: () => void
  onRename: () => void
  onShare: () => void
  onArchive: () => void
  backgroundTaskCount?: number
  onOpenBackgroundTasks?: () => void
  mobileShell: boolean
}) {
  return (
    <header ref={headerRef} className="flex h-14 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3 pr-20">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileSidebar} aria-label={t('toggleSidebar')}>
        <Menu className="size-[18px]" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex max-w-full min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div className="min-w-0 truncate text-sm font-semibold">{sessionTitle(title)}</div>
            {projectName || (gitRepository && gitBranch) ? (
              <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs leading-none text-muted-foreground sm:hidden">
                {projectName ? (
                  <div className="flex min-w-0 flex-1 basis-0 items-center gap-1" title={projectName}>
                    <Folder className="size-3 shrink-0" />
                    <span className="min-w-0 truncate">{projectName}</span>
                  </div>
                ) : null}
                {gitRepository && gitBranch ? (
                  <div className="flex min-w-0 flex-1 basis-0 items-center gap-1" title={gitBranch}>
                    <GitBranch className="size-3 shrink-0" />
                    <span className="min-w-0 truncate">{gitBranch}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          {!mobileShell && projectName ? (
            <div className="hidden h-9 max-w-[220px] shrink-0 items-center gap-2 rounded-full px-3 text-sm md:inline-flex" title={projectName}>
              <Folder className="size-4 text-muted-foreground" />
              <span className="min-w-0 truncate">{projectName}</span>
            </div>
          ) : null}
          {!mobileShell && projectId && gitRepository && gitBranch ? (
            <div className="relative hidden shrink-0 md:block" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-full px-3 text-sm transition-colors hover:bg-muted"
                onClick={onBranchMenuToggle}
                aria-label={t('gitBranchMenu')}
                aria-expanded={branchMenuOpen}
              >
                <GitBranch className="size-4 text-muted-foreground" />
                <span className="min-w-0 truncate">{gitBranch}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </button>
              {branchMenuOpen ? (
                <GitBranchMenu
                  projectId={projectId}
                  currentBranch={gitBranch}
                  dirtyCount={gitDirtyCount}
                  onCheckout={onCheckout}
                  onCreated={onBranchCreated}
                  onOpenGraph={onOpenGraph}
                  onOpenChanges={onOpenChanges}
                />
              ) : null}
            </div>
          ) : null}
          {showViewSwitch ? (
            <div className="quickforge-chat-view-switch hidden md:inline-flex" role="tablist" aria-label={t('trace.title')}>
              <button
                type="button"
                role="tab"
                aria-selected={conversationView === 'chat'}
                onClick={() => onSetConversationView('chat')}
              >
                <MessageSquare className="size-[14px]" />
                <span>{t('trace.viewChat')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={conversationView === 'trace'}
                onClick={() => onSetConversationView('trace')}
              >
                <Activity className="size-[14px]" />
                <span>{t('trace.viewTrace')}</span>
              </button>
            </div>
          ) : null}
          {onOpenBackgroundTasks ? (
            <Button
              variant="ghost"
              size="icon"
              className="relative shrink-0 rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40"
              onClick={onOpenBackgroundTasks}
              aria-label={
                backgroundTaskCount > 0
                  ? t('backgroundTaskRunningAria', { count: backgroundTaskCount })
                  : t('backgroundTaskOpenPanelAria')
              }
              title={t('backgroundTaskOpenPanelAria')}
            >
              <Activity className="size-[18px] stroke-[1.85]" />
              {backgroundTaskCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -top-0.5 inline-flex min-w-[14px] items-center justify-center rounded-full bg-[var(--destructive)] px-[3px] py-[1px] text-[10px] leading-none font-medium text-[var(--background)]"
                >
                  {backgroundTaskCount > 9 ? '9+' : backgroundTaskCount}
                </span>
              ) : null}
            </Button>
          ) : null}
          <div className="relative shrink-0" onClick={(event) => event.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(conversationMenuOpen && '')}
              onClick={onConversationMenuToggle}
              disabled={conversationMenuDisabled}
              aria-label={t('moreOptions')}
              aria-haspopup="menu"
              aria-expanded={conversationMenuOpen}
            >
              <Ellipsis className="size-[18px]" />
            </Button>
            {conversationMenuOpen ? (
              <div
                className={cn(
                  'fixed inset-x-2 top-14 z-40 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-quickforge md:absolute md:inset-x-auto md:left-0 md:top-full md:z-30 md:mt-1 md:min-w-44 md:max-h-none md:overflow-visible',
                  mobileShell && 'md:fixed md:inset-x-2 md:left-auto md:top-14 md:z-40 md:mt-0 md:max-h-[calc(100dvh-4rem)] md:min-w-0 md:overflow-y-auto lg:inset-x-2 lg:left-auto lg:top-14',
                )}
                role="menu"
                aria-label={t('moreOptions')}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={onTogglePinned}
                >
                  {currentSessionPinned ? <PinOff className="size-[18px]" /> : <Pin className="size-[18px]" />}
                  <span>{currentSessionPinned ? t('unpinSession') : t('pinSession')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={onRename}
                >
                  <Pencil className="size-[18px]" />
                  <span>{t('renameSession')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={onShare}
                >
                  <Share2 className="size-[18px]" />
                  <span>{t('shareSession')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-10 w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                  onClick={onArchive}
                >
                  <Archive className="size-[18px]" />
                  <span>{t('archiveSession')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

    </header>
  )
}
