import { memo, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import { useSentinel } from '@/hooks/useSentinel'
import type { ProjectInfo, QuickForgeSessionMetadata, BackgroundTaskStatus } from '@/lib/types'

type ChatSidebarProps = {
  sidebarOpen: boolean
  scheduledTasksActive: boolean
  projectsCollapsed: boolean
  conversationsCollapsed: boolean
  projects: ProjectInfo[]
  expandedProjectIds: Set<string>
  activeProject?: ProjectInfo
  currentSessionId?: string
  globalSessions: QuickForgeSessionMetadata[]
  sessionsForProject: (projectId: string) => QuickForgeSessionMetadata[]
  globalHasMore: boolean
  globalLoading: boolean
  onLoadMoreGlobal: () => void
  projectHasMore: (projectId: string) => boolean
  projectLoading: (projectId: string) => boolean
  projectLoaded: (projectId: string) => boolean
  onLoadMoreProject: (projectId: string) => void
  sessionTaskStatus: (session: QuickForgeSessionMetadata) => BackgroundTaskStatus
  selectingProject: boolean
  onToggleProjectsCollapsed: () => void
  onToggleConversationsCollapsed: () => void
  onToggleProjectExpanded: (projectId: string) => void
  onSelectProjectDirectory: () => void
  onStartNewProjectChat: (project: ProjectInfo) => void
  onDeleteProject: (projectId: string) => void
  onLoadSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, currentTitle: string) => void
  onDeleteSession: (sessionId: string) => void
  onStartNewGlobalChat: () => void
  onOpenScheduledTasks: () => void
  onToggleSidebar: () => void
}

const sessionTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatSessionTime(value: string) {
  return sessionTimeFormatter.format(new Date(value))
}

function LoadMoreSentinel({ onLoadMore, enabled }: { onLoadMore: () => void; enabled: boolean }) {
  const ref = useSentinel(onLoadMore, enabled)
  if (!enabled) return null
  return (
    <div ref={ref} className="flex items-center justify-center py-1">
      <Loader2 className="size-3 animate-spin text-muted-foreground/45" />
    </div>
  )
}

export const ChatSidebar = memo(function ChatSidebar({
  sidebarOpen,
  scheduledTasksActive,
  projectsCollapsed,
  conversationsCollapsed,
  projects,
  expandedProjectIds,
  activeProject,
  currentSessionId,
  globalSessions,
  sessionsForProject,
  globalHasMore,
  globalLoading,
  onLoadMoreGlobal,
  projectHasMore,
  projectLoading,
  projectLoaded,
  onLoadMoreProject,
  sessionTaskStatus,
  selectingProject,
  onToggleProjectsCollapsed,
  onToggleConversationsCollapsed,
  onToggleProjectExpanded,
  onSelectProjectDirectory,
  onStartNewProjectChat,
  onDeleteProject,
  onLoadSession,
  onRenameSession,
  onDeleteSession,
  onStartNewGlobalChat,
  onOpenScheduledTasks,
  onToggleSidebar,
}: ChatSidebarProps) {
  const sectionHeaderClass = 'mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium leading-5 text-muted-foreground/72 transition-colors hover:bg-[color-mix(in_oklab,var(--muted)_52%,transparent)]'
  const sectionToggleClass = 'flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-foreground/80'
  const chevronClass = 'size-4 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none'
  const collapsePanelClass = 'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none'
  const collapsePanelOpenClass = 'grid-rows-[1fr] opacity-100'
  const collapsePanelClosedClass = 'pointer-events-none grid-rows-[0fr] opacity-0'
  const collapseInnerClass = 'min-h-0 overflow-hidden'
  const rowHoverShadowClass = 'hover:shadow-[0_10px_26px_-18px_rgb(15_23_42_/_0.48)]'
  const iconHoverShadowClass = 'hover:shadow-[0_8px_18px_-14px_rgb(15_23_42_/_0.5)]'
  const rowClass = `group relative flex items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left transition-all duration-160 ease-out hover:-translate-y-px active:translate-y-0 ${rowHoverShadowClass}`
  const activeRowClass = 'bg-[color-mix(in_oklab,var(--muted)_70%,transparent)] text-foreground/92 shadow-[0_10px_26px_-20px_rgb(15_23_42_/_0.36)]'
  const projectActiveRowClass = 'text-foreground/84 hover:bg-[color-mix(in_oklab,var(--muted)_52%,transparent)]'
  const inactiveRowClass = 'text-muted-foreground/72 hover:bg-[color-mix(in_oklab,var(--muted)_52%,transparent)] hover:text-foreground/86'
  const sessionInactiveRowClass = 'text-muted-foreground/76 hover:bg-[color-mix(in_oklab,var(--muted)_52%,transparent)] hover:text-foreground/90'
  const iconSlotClass = 'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors group-hover:text-foreground/70'
  const iconButtonClass = `size-7 shrink-0 rounded-full text-muted-foreground/55 transition-all duration-160 ease-out hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--muted)_52%,transparent)] hover:text-foreground/85 active:translate-y-0 ${iconHoverShadowClass}`
  const actionOverlayClass = 'pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 rounded-r-lg bg-gradient-to-l from-background via-background/95 to-transparent pl-8 opacity-0 transition-opacity duration-160 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
  const overlayIconButtonClass = iconButtonClass
  const overlayDangerIconButtonClass = `size-7 shrink-0 rounded-full text-muted-foreground/55 transition-all duration-160 ease-out hover:-translate-y-px hover:bg-destructive/14 hover:text-destructive/90 active:translate-y-0 ${iconHoverShadowClass}`
  const sessionTitleClass = 'truncate text-sm leading-5'
  const activeSessionTitleClass = 'font-medium text-foreground/92'
  const activeProjectTitleClass = 'font-medium text-foreground/84'
  const timeClass = 'mt-0.5 truncate text-[11px] leading-4 text-muted-foreground/55'
  const searchDialogClass = 'fixed inset-0 z-50 flex items-start justify-center bg-background/50 px-4 pt-[12vh] backdrop-blur-sm'
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchableSessions = useMemo(() => {
    const projectSessions = projects.flatMap((project) => sessionsForProject(project.id).map((session) => ({ session, projectName: project.name })))
    const global = globalSessions.map((session) => ({ session, projectName: '' }))
    const seen = new Set<string>()
    return [...projectSessions, ...global].filter(({ session }) => {
      if (seen.has(session.id)) return false
      seen.add(session.id)
      return true
    })
  }, [globalSessions, projects, sessionsForProject])
  const searchResults = searchQuery.trim()
    ? searchableSessions.filter(({ session, projectName }) => `${sessionTitle(session.title)} ${projectName}`.toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 8)
    : []
  const openSearch = () => {
    setSearchOpen(true)
    window.setTimeout(() => searchInputRef.current?.focus(), 0)
  }
  const selectSearchResult = (sessionId: string) => {
    onLoadSession(sessionId)
    setSearchOpen(false)
    setSearchQuery('')
  }

  return (
    <aside
      className={cn(
        'relative z-10 hidden min-h-0 shrink-0 overflow-hidden border-r border-border bg-background transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex md:flex-col',
        sidebarOpen ? 'w-80' : 'w-14',
      )}
    >
      <div className="shrink-0 px-3 pt-3 pb-1">
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={onToggleSidebar}
          aria-label={t('toggleSidebar')}
        >
          <span className={cn(iconSlotClass, 'relative')}>
            <Sparkles className={cn('size-4 transition-opacity duration-160', !sidebarOpen && 'group-hover:opacity-0')} />
            {!sidebarOpen ? <PanelLeftOpen className="absolute size-4 opacity-0 transition-opacity duration-160 group-hover:opacity-100" /> : null}
          </span>
          {sidebarOpen ? (
            <span className="ml-auto inline-flex size-6 items-center justify-center text-muted-foreground/55 transition-colors group-hover:text-foreground/70">
              <PanelLeftClose className="size-4" />
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'mt-4 w-full', scheduledTasksActive ? activeRowClass : inactiveRowClass)}
          onClick={onOpenScheduledTasks}
          aria-label="定时任务"
        >
          <span className={iconSlotClass}>
            <CalendarClock className="size-4" />
          </span>
          {sidebarOpen ? <span className={cn(sessionTitleClass, scheduledTasksActive && activeSessionTitleClass)}>定时任务</span> : null}
        </button>
        <button
          type="button"
          className={cn(rowClass, 'w-full', inactiveRowClass)}
          onClick={openSearch}
          aria-label="搜索"
        >
          <span className={iconSlotClass}>
            <Search className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>搜索</span> : null}
        </button>
      </div>

      {sidebarOpen ? (
        <>
          <div className="shrink-0 px-3 max-h-[55%] flex flex-col min-h-0 overflow-hidden">
            <div className="shrink-0 mb-0.5">
              <div className={sectionHeaderClass}>
                <button type="button" className={sectionToggleClass} onClick={onToggleProjectsCollapsed} aria-expanded={!projectsCollapsed}>
                  <ChevronRight className={cn(chevronClass, !projectsCollapsed && 'rotate-90')} />
                  <span className="flex-1 truncate">{t('projects')}</span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={iconButtonClass}
                  onClick={onSelectProjectDirectory}
                  disabled={selectingProject}
                  aria-label={t('addProject')}
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <div className={cn(collapsePanelClass, 'flex-1 min-h-0', projectsCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
                <div className={collapseInnerClass}>
                  <div className="h-full overflow-y-auto">
                    <div className="space-y-0.5">
                      {projects.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noProjects')}</div>
                      ) : (
                        projects.map((item) => {
                          const projectSessions = sessionsForProject(item.id)
                          const expanded = expandedProjectIds.has(item.id)
                          const active = activeProject?.id === item.id
                          const loaded = projectLoaded(item.id)

                          return (
                            <div key={item.id}>
                              <div className={cn(rowClass, active ? projectActiveRowClass : inactiveRowClass)}>
                                <button
                                  type="button"
                                  className={iconSlotClass}
                                  onClick={() => onToggleProjectExpanded(item.id)}
                                  aria-label={expanded ? t('collapseProject') : t('expandProject')}
                                >
                                  {expanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
                                </button>
                                <button
                                  className="flex min-w-0 flex-1 items-center text-left"
                                  type="button"
                                  title={item.path}
                                  onClick={() => onToggleProjectExpanded(item.id)}
                                >
                                  <span className={cn(sessionTitleClass, active && activeProjectTitleClass)}>{item.name}</span>
                                </button>
                                <div className={actionOverlayClass}>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayIconButtonClass}
                                    onClick={() => onStartNewProjectChat(item)}
                                    aria-label={t('newProjectChat')}
                                  >
                                    <MessageSquarePlus className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={overlayDangerIconButtonClass}
                                    onClick={() => onDeleteProject(item.id)}
                                    aria-label={t('deleteProject')}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              </div>

                              <div className={cn(collapsePanelClass, expanded ? collapsePanelOpenClass : collapsePanelClosedClass)}>
                                <div className={collapseInnerClass}>
                                  <div className="mt-0.5 space-y-0.5 pl-8 max-h-[35vh] overflow-y-auto">
                                    {projectSessions.length === 0 && !loaded ? (
                                      <div className="flex items-center px-2 py-1.5 text-xs text-muted-foreground/55">
                                        <Loader2 className="mr-1.5 size-3 animate-spin" />
                                        {t('loadingChatWorkspace')}
                                      </div>
                                    ) : projectSessions.length === 0 && !projectHasMore(item.id) ? (
                                      <div className="px-2 py-1.5 text-xs text-muted-foreground/55">{t('noConversations')}</div>
                                    ) : (
                                      <>
                                        {projectSessions.map((session) => {
                                          const selected = currentSessionId === session.id
                                          return (
                                            <div key={session.id} className={cn(rowClass, 'gap-1', selected ? activeRowClass : sessionInactiveRowClass)}>
                                              <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                                                <div className="flex items-center gap-1 truncate">
                                                  {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                                  <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title)}</span>
                                                </div>
                                                <div className={timeClass}>{formatSessionTime(session.lastModified)}</div>
                                              </button>
                                              <div className={actionOverlayClass}>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className={overlayIconButtonClass}
                                                  onClick={() => onRenameSession(session.id, session.title)}
                                                  aria-label={t('renameSession')}
                                                >
                                                  <Pencil className="size-3.5" />
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className={overlayDangerIconButtonClass}
                                                  onClick={() => onDeleteSession(session.id)}
                                                  aria-label={t('deleteSession')}
                                                >
                                                  <Trash2 className="size-4" />
                                                </Button>
                                              </div>
                                            </div>
                                          )
                                        })}
                                        <LoadMoreSentinel
                                          onLoadMore={() => onLoadMoreProject(item.id)}
                                          enabled={projectHasMore(item.id) && !projectLoading(item.id)}
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col px-3 pb-3">
            <div className={sectionHeaderClass}>
              <button type="button" className={sectionToggleClass} onClick={onToggleConversationsCollapsed} aria-expanded={!conversationsCollapsed}>
                <ChevronRight className={cn(chevronClass, !conversationsCollapsed && 'rotate-90')} />
                <span className="flex-1 truncate">{t('conversations')}</span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className={iconButtonClass}
                onClick={onStartNewGlobalChat}
                aria-label={t('newChat')}
              >
                <MessageSquarePlus className="size-4" />
              </Button>
            </div>

            <div className={cn(collapsePanelClass, 'flex-1 min-h-0', conversationsCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass)}>
              <div className={collapseInnerClass}>
                <div className="h-full overflow-y-auto">
                  {globalSessions.length === 0 && !globalHasMore ? (
                    <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noSavedConversations')}</div>
                  ) : (
                    <div className="space-y-0.5">
                      {globalSessions.map((session) => {
                        const selected = currentSessionId === session.id
                        return (
                          <div key={session.id} className={cn(rowClass, selected ? activeRowClass : sessionInactiveRowClass)}>
                            <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                              <div className="flex items-center gap-1 truncate">
                                {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title)}</span>
                              </div>
                              <div className={timeClass}>{formatSessionTime(session.lastModified)}</div>
                            </button>
                            <div className={actionOverlayClass}>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={overlayIconButtonClass}
                                onClick={() => onRenameSession(session.id, session.title)}
                                aria-label={t('renameSession')}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={overlayDangerIconButtonClass}
                                onClick={() => onDeleteSession(session.id)}
                                aria-label={t('deleteSession')}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                      <LoadMoreSentinel
                        onLoadMore={onLoadMoreGlobal}
                        enabled={globalHasMore && !globalLoading}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {searchOpen ? (
        <div className={searchDialogClass} role="dialog" aria-modal="true" onMouseDown={() => setSearchOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-3 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3 py-2">
              <Search className="size-4 shrink-0 text-muted-foreground/60" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false)
                }}
                placeholder="搜索对话记录..."
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45"
              />
            </div>
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              {searchQuery.trim() ? (
                searchResults.length > 0 ? (
                  searchResults.map(({ session, projectName }) => (
                    <button
                      key={session.id}
                      type="button"
                      className="block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/60"
                      onClick={() => selectSearchResult(session.id)}
                    >
                      <div className="truncate text-sm text-foreground/90">{sessionTitle(session.title)}</div>
                      <div className="truncate text-[11px] text-muted-foreground/55">{projectName || t('normalChat')} · {formatSessionTime(session.lastModified)}</div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-xs text-muted-foreground/55">没有找到相关对话</div>
                )
              ) : (
                <div className="px-3 py-3 text-xs text-muted-foreground/55">输入关键词搜索已加载的对话记录</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  )
})
