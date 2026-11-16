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

// 归档列表曾经写死 limit=1000：本机实测 archived=only 的 total 是 1790，剩下 790 条
// 既看不到也搜不到、恢复不了，界面还一声不吭。现在按 offset 翻页取满 total，
// 页大小与安全上限只决定「一次能翻多远」，到顶必须由界面明说，不能静默丢。
const ARCHIVED_PAGE_SIZE = 500
const ARCHIVED_MAX_PAGES = 20

async function fetchArchivedSessionsPage(offset: number): Promise<{ values: QuickForgeSessionMetadata[]; total: number | null }> {
  const params = new URLSearchParams({
    direction: 'desc',
    limit: String(ARCHIVED_PAGE_SIZE),
    offset: String(offset),
    archived: 'only',
  })
  const response = await fetch(`/api/storage/sessions-metadata/index/lastModified?${params.toString()}`, { cache: 'no-store' })
  const payload = await response.json().catch(() => null) as ArchivedSessionsResponse | null
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return {
    values: Array.isArray(payload?.values) ? payload.values : [],
    total: typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : null,
  }
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
  // 服务端 total 与「是否真取全」分开记：只要列出的条目少于 total，界面就必须说出来。
  const [total, setTotal] = useState<number | null>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    // 旧版元素常驻、切走仅 detach：重新激活时重新加载归档列表（query/projectFilter 等中间态保留）。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError('')
      setTruncated(false)
      const projectsRequest = fetch('/api/project', { cache: 'no-store' }).catch(() => null)
      const collected: QuickForgeSessionMetadata[] = []
      let orderedTotal: number | null = null
      let incomplete = false

      try {
        for (let page = 0; page < ARCHIVED_MAX_PAGES; page += 1) {
          const result = await fetchArchivedSessionsPage(page * ARCHIVED_PAGE_SIZE)
          if (cancelled) return
          if (result.total !== null) orderedTotal = result.total
          collected.push(...result.values)
          // 不满一页 = 已经到底；凑满 total = 已经取全。两种都不算截断。
          if (result.values.length < ARCHIVED_PAGE_SIZE) break
          if (orderedTotal !== null && collected.length >= orderedTotal) break
          // 安全上限到顶：还有没取到的，标记截断让界面明说，绝不静默。
          if (page === ARCHIVED_MAX_PAGES - 1) incomplete = orderedTotal === null || collected.length < orderedTotal
        }
      } catch (err) {
        if (cancelled) return
        if (collected.length === 0) {
          setError(err instanceof Error ? err.message : t('requestFailed'))
          setLoading(false)
          return
        }
        // 已经取到的页照样展示，但没取到的部分必须说出来。
        incomplete = true
        setError(err instanceof Error ? err.message : t('requestFailed'))
      }
      if (cancelled) return
      setSessions(collected)
      setTotal(orderedTotal)
      setTruncated(incomplete)

      const projectsResponse = await projectsRequest
      if (cancelled) return
      if (projectsResponse?.ok) {
        const projectsPayload = await projectsResponse.json().catch(() => null) as { projects?: ProjectInfo[] } | null
        if (!cancelled) setProjects(Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : [])
      }
      if (!cancelled) setLoading(false)
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
      return `${sessionTitle(session.title)} ${projectName}`.toLowerCase().includes(normalizedQuery)
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
      // 恢复走不通「多出来的那条还在归档里」，total 跟着减，免得提示开始说谎。
      setTotal((current) => (current === null ? null : Math.max(0, current - 1)))
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
      setTotal((current) => (current === null ? null : Math.max(0, current - 1)))
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
    // 「全部删除」删的是已列出的这些，而界面常常只露出其中一部分（筛选或安全上限截断）。
    // 确认框是用户唯一会停下来读的地方，所以范围必须按当前状态说实话。
    const listedCount = sessions.length
    const visibleCount = filteredSessions().length
    const filtered = query.trim().length > 0 || projectFilter !== 'all'
    const unlistedCount = total === null ? null : Math.max(0, total - listedCount)
    const partial = unlistedCount === null ? truncated : unlistedCount > 0
    const description = partial
      ? (unlistedCount === null
          ? t('deleteAllArchivedSessionsConfirmPartialUnknown', { listed: listedCount })
          : t('deleteAllArchivedSessionsConfirmPartial', { listed: listedCount, total: unlistedCount + listedCount }))
      : filtered
        ? t('deleteAllArchivedSessionsConfirmFiltered', { listed: listedCount, visible: visibleCount })
        : t('deleteAllArchivedSessionsConfirm')
    const confirmed = await showConfirm({
      description,
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
      const deletedCount = sessions.length
      await Promise.all(sessions.map((session) => storage.sessions.delete(session.id)))
      setSessions([])
      // 「全部删除」只删得到已列出的这些；未列出的仍留在归档里，提示要继续说实话。
      setTotal((current) => (current === null ? null : Math.max(0, current - deletedCount)))
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
            <div className="truncate text-sm font-medium text-foreground">{sessionTitle(session.title)}</div>
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
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            type="search"
            value={query}
            placeholder={t('searchArchivedConversations')}
            aria-label={t('searchArchivedConversations')}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={projectFilter}
            aria-label={t('archivedProjectFilter')}
            onChange={(event) => setProjectFilter(event.currentTarget.value)}
          >
            <option value="all">{t('allProjects')}</option>
            <option value="global">{t('normalChat')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </div>

        {truncated ? (
          <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            {total === null
              ? t('archivedSessionsTruncatedUnknown', { loaded: sessions.length })
              : t('archivedSessionsTruncated', { loaded: sessions.length, total })}
          </div>
        ) : null}

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
