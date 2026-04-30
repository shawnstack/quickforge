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
  return (
    <aside
      className={cn(
        'hidden min-h-0 shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col',
        sidebarOpen ? 'w-80' : 'w-0 overflow-hidden border-r-0',
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-5">
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-1 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={onToggleProjectsCollapsed}
          >
            {projectsCollapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
            <span className="flex-1 text-left">{t('projects')}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={(e) => { e.stopPropagation(); onSelectProjectDirectory() }}
              disabled={selectingProject}
              aria-label={t('addProject')}
            >
              <Plus className="size-4" />
            </Button>
          </button>

          {!projectsCollapsed && (<div className="space-y-1">
            {projects.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">{t('noProjects')}</div>
            ) : (
              projects.map((item) => {
                const projectSessions = sessionsForProject(item.id)
                const expanded = expandedProjectIds.has(item.id)
                const active = activeProject?.id === item.id

                return (
                  <div key={item.id}>
                    <div
                      className={cn(
                        'group flex items-center gap-1 rounded-md px-1 py-1.5',
                        active ? 'bg-secondary' : 'hover:bg-secondary/70',
                      )}
                    >
                      <button
                        type="button"
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
                        onClick={() => onToggleProjectExpanded(item.id)}
                        aria-label={expanded ? t('collapseProject') : t('expandProject')}
                      >
                        {expanded ? (
                          <FolderOpen className="size-4 text-muted-foreground" />
                        ) : (
                          <Folder className="size-4 text-muted-foreground" />
                        )}
                      </button>
                      <button
                        className="flex min-w-0 flex-1 items-center text-left"
                        type="button"
                        title={item.path}
                        onClick={() => onToggleProjectExpanded(item.id)}
                      >
                        <span className="truncate text-sm font-medium">{item.name}</span>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                        onClick={() => onStartNewProjectChat(item)}
                        aria-label={t('newProjectChat')}
                      >
                        <MessageSquarePlus className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 opacity-0 group-hover:opacity-100"
                        onClick={() => onDeleteProject(item.id)}
                        aria-label={t('deleteProject')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>

                    {expanded ? (
                      <div className="ml-4 mt-1 border-l-2 border-border pl-4 space-y-0.5">
                        {projectSessions.length === 0 ? (
                          <div className="py-1.5 text-sm text-muted-foreground/70">{t('noConversations')}</div>
                        ) : (
                          projectSessions.map((session) => (
                            <div
                              key={session.id}
                              className={cn(
                                'group flex items-start gap-1 rounded-md px-2 py-1.5',
                                currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary/70',
                              )}
                            >
                              <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                                <div className="flex items-center gap-1 truncate text-sm">
                                  {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                                  <span className="truncate">{sessionTitle(session.title)}</span>
                                </div>
                                <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatSessionTime(session.lastModified)}</div>
                              </button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                                onClick={() => onRenameSession(session.id, session.title)}
                                aria-label={t('renameSession')}
                              >
                                <Pencil className="size-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 shrink-0 opacity-0 group-hover:opacity-100"
                                onClick={() => onDeleteSession(session.id)}
                                aria-label={t('deleteSession')}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ))
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
          <button
            type="button"
            className="mb-2 flex w-full items-center gap-1 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={onToggleConversationsCollapsed}
          >
            {conversationsCollapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
            <span className="flex-1 text-left">{t('conversations')}</span>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={(e) => { e.stopPropagation(); onStartNewGlobalChat() }} aria-label={t('newChat')}>
              <MessageSquarePlus className="size-4" />
            </Button>
          </button>

          {!conversationsCollapsed && (
            globalSessions.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">{t('noSavedConversations')}</div>
          ) : (
            <div className="space-y-1">
              {globalSessions.map((session) => (
                <div
                  key={session.id}
                  className={cn(
                    'group flex items-start gap-2 rounded-md px-2 py-2 text-left',
                    currentSessionId === session.id ? 'bg-secondary' : 'hover:bg-secondary/70',
                  )}
                >
                  <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onLoadSession(session.id)}>
                    <div className="flex items-center gap-1 truncate text-sm font-medium">
                      {sessionTaskStatus(session) === 'running' ? <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" /> : null}
                      <span className="truncate">{sessionTitle(session.title)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{formatSessionTime(session.lastModified)}</div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100"
                    onClick={() => onRenameSession(session.id, session.title)}
                    aria-label={t('renameSession')}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 opacity-0 group-hover:opacity-100"
                    onClick={() => onDeleteSession(session.id)}
                    aria-label={t('deleteSession')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )
          )}
        </div>
      </div>
    </aside>
  )
}
