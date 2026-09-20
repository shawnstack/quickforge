import { useEffect, useMemo, useState } from 'react'
import { getAppStorage } from '@/storage'
import { getDateLocale, t } from '@/lib/i18n'
import { sessionTitle, type ProjectInfo, type QuickForgeSessionData, type QuickForgeSessionMetadata } from '@/lib/types'
import { showConfirm } from '@/components/ui/confirm-dialog'

type ArchivedSessionsResponse = {
  values?: QuickForgeSessionMetadata[]
  total?: number
  error?: string
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(getDateLocale())
}

function withClearedArchivedAt<T extends { archivedAt?: string }>(value: T): T {
  return { ...value, archivedAt: null } as T
}

function notifySessionsChanged() {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel('quickforge-sync')
    channel.postMessage({
      type: 'sessions-changed',
      sourceTabId: 'archived-conversations-settings-tab',
      timestamp: Date.now(),
    })
    channel.close()
  } catch {
    // Cross-tab sync is best-effort only.
  }
}

export function ArchivedConversationsSettingsTab({ active }: { active?: boolean } = {}) {
  const [sessions, setSessions] = useState<QuickForgeSessionMetadata[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busySessionId, setBusySessionId] = useState('')
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    // 旧版元素常驻、切走仅 detach：重新激活时重新加载归档列表（query/projectFilter 等中间态保留）。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const [sessionsResponse, projectsResponse] = await Promise.all([
          fetch('/api/storage/sessions-metadata/index/lastModified?direction=desc&limit=1000&offset=0&archived=only', { cache: 'no-store' }),
          fetch('/api/project', { cache: 'no-store' }).catch(() => null),
        ])

        const sessionsPayload = await sessionsResponse.json().catch(() => null) as ArchivedSessionsResponse | null
        if (!sessionsResponse.ok) throw new Error(sessionsPayload?.error || t('requestFailed'))
        if (cancelled) return
        setSessions(Array.isArray(sessionsPayload?.values) ? sessionsPayload.values : [])

        if (projectsResponse?.ok) {
          const projectsPayload = await projectsResponse.json().catch(() => null) as { projects?: ProjectInfo[] } | null
          if (!cancelled) setProjects(Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : [])
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])

  const filteredSessions = () => {
    const normalizedQuery = query.trim().toLowerCase()
    return sessions.filter((session) => {
      if (projectFilter !== 'all') {
        if (projectFilter === 'global' && session.scope === 'project') return false
        if (projectFilter !== 'global' && session.projectId !== projectFilter) return false
      }
      if (!normalizedQuery) return true
      const projectName = session.projectId ? projectNameById.get(session.projectId) || '' : ''
      return `${sessionTitle(session.title, session.channelName)} ${projectName}`.toLowerCase().includes(normalizedQuery)
    })
  }

  const groupedSessions = () => {
    const groups = new Map<string, QuickForgeSessionMetadata[]>()
    for (const session of filteredSessions()) {
      const key = session.scope === 'project' && session.projectId ? session.projectId : 'global'
      groups.set(key, [...(groups.get(key) ?? []), session])
    }
    return [...groups.entries()]
  }

  const projectLabel = (projectId: string) => {
    if (projectId === 'global') return t('normalChat')
    return projectNameById.get(projectId) || t('unknownProject')
  }

  const restoreSession = async (sessionId: string) => {
    if (busySessionId) return
    setBusySessionId(sessionId)
    setMessage('')
    setError('')

    try {
      const storage = getAppStorage()
      const session = await storage.sessions.get(sessionId) as QuickForgeSessionData | null
      const metadata = await storage.sessions.getMetadata(sessionId) as QuickForgeSessionMetadata | null
      if (!session || !metadata) throw new Error(t('sessionNotFound'))
      await storage.sessions.save(withClearedArchivedAt(session), withClearedArchivedAt(metadata))
      setSessions((current) => current.filter((item) => item.id !== sessionId))
      setMessage(t('sessionRestored'))
      notifySessionsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('restoreSessionFailed'))
    } finally {
      setBusySessionId('')
    }
  }

  const deleteSession = async (session: QuickForgeSessionMetadata) => {
    if (busySessionId) return
    const confirmed = await showConfirm({
      description: t('deleteArchivedSessionConfirm', { title: sessionTitle(session.title) }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setBusySessionId(session.id)
    setMessage('')
    setError('')

    try {
      const storage = getAppStorage()
      await storage.sessions.delete(session.id)
      setSessions((current) => current.filter((item) => item.id !== session.id))
      setMessage(t('archivedSessionDeleted'))
      notifySessionsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteSessionFailed'))
    } finally {
      setBusySessionId('')
    }
  }

  const deleteAllArchivedSessions = async () => {
    if (busySessionId || sessions.length === 0) return
    const confirmed = await showConfirm({
      description: t('deleteAllArchivedSessionsConfirm'),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    setBusySessionId('__all__')
    setMessage('')
    setError('')

    try {
      const storage = getAppStorage()
      await Promise.all(sessions.map((session) => storage.sessions.delete(session.id)))
      setSessions([])
      setMessage(t('archivedSessionsDeleted'))
      notifySessionsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteSessionFailed'))
    } finally {
      setBusySessionId('')
    }
  }

  const renderSession = (session: QuickForgeSessionMetadata) => {
    const busy = busySessionId === session.id || busySessionId === '__all__'
    return (
      <div className="border-t border-border px-4 py-3 first:border-t-0" key={session.id}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{sessionTitle(session.title, session.channelName)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('lastModified')}: {formatDate(session.lastModified)} · {t('archivedAt')}: {formatDate(session.archivedAt)}
            </div>
          </div>
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
            <button
              className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60"
              type="button"
              disabled={busy}
              onClick={() => void restoreSession(session.id)}
            >
              {t('restoreSession')}
            </button>
            <button
              className="rounded-md px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
              type="button"
              disabled={busy}
              onClick={() => void deleteSession(session)}
            >
              {t('deletePermanently')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const groups = groupedSessions()
  const busy = Boolean(busySessionId)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
          type="button"
          disabled={busy || sessions.length === 0}
          onClick={() => void deleteAllArchivedSessions()}
        >
          {t('deleteAll')}
        </button>
      </div>

      <section className="rounded-lg border border-border">
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <input
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            type="search"
            value={query}
            placeholder={t('searchArchivedConversations')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.currentTarget.value)}
          >
            <option value="all">{t('allProjects')}</option>
            <option value="global">{t('normalChat')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('loading')}</div>
        ) : groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t('noArchivedConversations')}</div>
        ) : (
          <div>
            {groups.map(([projectId, projectSessions]) => (
              <div className="border-b border-border last:border-b-0" key={projectId}>
                <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-2 text-sm text-muted-foreground">
                  <div className="truncate">{projectLabel(projectId)}</div>
                  <div className="shrink-0">{t('conversationCount', { count: projectSessions.length })}</div>
                </div>
                {projectSessions.map((session) => renderSession(session))}
              </div>
            ))}
          </div>
        )}
      </section>

      {message ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}
    </div>
  )
}
