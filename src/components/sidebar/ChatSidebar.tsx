import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MessageSquarePlus,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { sessionTitle } from '@/lib/types'
import type { ProjectInfo, QuickForgeSessionMetadata, BackgroundTaskStatus } from '@/lib/types'

type ChatSidebarProps = {
  sidebarOpen: boolean
  projectsCollapsed: boolean
  conversationsCollapsed: boolean
  projects: ProjectInfo[]
  expandedProjectIds: Set<string>
  activeProject?: ProjectInfo
  currentSessionId?: string
  globalSessions: QuickForgeSessionMetadata[]
  sessionsForProject: (projectId: string) => QuickForgeSessionMetadata[]
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
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function ChatSidebar({
  sidebarOpen,
  projectsCollapsed,
  conversationsCollapsed,
  projects,
  expandedProjectIds,
  activeProject,
  currentSessionId,
  globalSessions,
  sessionsForProject,
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
}: ChatSidebarProps) {
  const sectionHeaderClass = 'mb-1.5 flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60'
  const sectionToggleClass = 'flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-foreground/80'
  const rowHoverShadowClass = 'hover:shadow-[0_10px_26px_-18px_rgb(15_23_42_/_0.48)]'
  const iconHoverShadowClass = 'hover:shadow-[0_8px_18px_-14px_rgb(15_23_42_/_0.5)]'
  const rowClass = `group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all duration-160 ease-out hover:-translate-y-px active:translate-y-0 ${rowHoverShadowClass}`
  const activeRowClass = 'bg-muted/30 text-foreground/90 shadow-[0_10px_26px_-20px_rgb(15_23_42_/_0.42)]'
  const inactiveRowClass = 'text-muted-foreground/72 hover:bg-muted/32 hover:text-foreground/85'
  const iconSlotClass = 'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors group-hover:text-foreground/70'
  const iconButtonClass = `size-7 shrink-0 rounded-full text-muted-foreground/55 transition-all duration-160 ease-out hover:-translate-y-px hover:bg-muted/32 hover:text-foreground/85 active:translate-y-0 ${iconHoverShadowClass}`
  const hiddenIconButtonClass = `${iconButtonClass} opacity-0 group-hover:opacity-100`
  const dangerIconButtonClass = `size-7 shrink-0 rounded-full text-muted-foreground/55 opacity-0 transition-all duration-160 ease-out hover:-translate-y-px hover:bg-destructive/14 hover:text-destructive/90 active:translate-y-0 group-hover:opacity-100 ${iconHoverShadowClass}`
  const sessionTitleClass = 'truncate text-sm leading-5'
  const activeSessionTitleClass = 'font-medium text-foreground/90'
  const timeClass = 'mt-0.5 truncate text-[11px] leading-4 text-muted-foreground/55'

  return (
    <aside
      className={cn(
        'relative z-10 hidden min-h-0 shrink-0 border-r border-border bg-background md:flex md:flex-col',
        sidebarOpen ? 'w-80' : 'w-0 overflow-hidden border-r-0',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-4 px-2 py-2">
          <div className="text-sm font-medium leading-none text-foreground/85">速构 QuickForge</div>
          <div className="mt-1 text-xs text-muted-foreground/55">AI Workspace</div>
        </div>

        <div className="mb-5">
          <div className={sectionHeaderClass}>
            <button type="button" className={sectionToggleClass} onClick={onToggleProjectsCollapsed}>
              {projectsCollapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
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

          {!projectsCollapsed && (
            <div className="space-y-0.5">
              {projects.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noProjects')}</div>
              ) : (
                projects.map((item) => {
                  const projectSessions = sessionsForProject(item.id)
                  const expanded = expandedProjectIds.has(item.id)
                  const active = activeProject?.id === item.id

                  return (
                    <div key={item.id}>
                      <div className={cn(rowClass, active ? activeRowClass : inactiveRowClass)}>
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
                          <span className={cn(sessionTitleClass, active && activeSessionTitleClass)}>{item.name}</span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={hiddenIconButtonClass}
                          onClick={() => onStartNewProjectChat(item)}
                          aria-label={t('newProjectChat')}
                        >
                          <MessageSquarePlus className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={dangerIconButtonClass}
                          onClick={() => onDeleteProject(item.id)}
                          aria-label={t('deleteProject')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      {expanded ? (
                        <div className="mt-0.5 space-y-0.5 pl-8">
                          {projectSessions.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground/55">{t('noConversations')}</div>
                          ) : (
                            projectSessions.map((session) => {
                              const selected = currentSessionId === session.id
                              return (
                                <div key={session.id} className={cn(rowClass, 'gap-1', selected ? activeRowClass : inactiveRowClass)}>
                                  <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                                    <div className="flex items-center gap-1 truncate">
                                      {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                      <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title)}</span>
                                    </div>
                                    <div className={timeClass}>{formatSessionTime(session.lastModified)}</div>
                                  </button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={hiddenIconButtonClass}
                                    onClick={() => onRenameSession(session.id, session.title)}
                                    aria-label={t('renameSession')}
                                  >
                                    <Pencil className="size-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className={dangerIconButtonClass}
                                    onClick={() => onDeleteSession(session.id)}
                                    aria-label={t('deleteSession')}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              )
                            })
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        <div>
          <div className={sectionHeaderClass}>
            <button type="button" className={sectionToggleClass} onClick={onToggleConversationsCollapsed}>
              {conversationsCollapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
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

          {!conversationsCollapsed && (
            globalSessions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted-foreground/55">{t('noSavedConversations')}</div>
            ) : (
              <div className="space-y-0.5">
                {globalSessions.map((session) => {
                  const selected = currentSessionId === session.id
                  return (
                    <div key={session.id} className={cn(rowClass, selected ? activeRowClass : inactiveRowClass)}>
                      <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                        <div className="flex items-center gap-1 truncate">
                          {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                          <span className={cn(sessionTitleClass, selected && activeSessionTitleClass)}>{sessionTitle(session.title)}</span>
                        </div>
                        <div className={timeClass}>{formatSessionTime(session.lastModified)}</div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={hiddenIconButtonClass}
                        onClick={() => onRenameSession(session.id, session.title)}
                        aria-label={t('renameSession')}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={dangerIconButtonClass}
                        onClick={() => onDeleteSession(session.id)}
                        aria-label={t('deleteSession')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>
    </aside>
  )
}
