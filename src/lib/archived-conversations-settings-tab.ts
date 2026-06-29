import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
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

function withoutArchivedAt<T extends { archivedAt?: string }>(value: T): T {
  const next = { ...value }
  delete next.archivedAt
  return next
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

class ArchivedConversationsSettingsTab extends SettingsTab {
  private sessions: QuickForgeSessionMetadata[] = []
  private projects: ProjectInfo[] = []
  private loading = true
  private busySessionId = ''
  private query = ''
  private projectFilter = 'all'
  private message = ''
  private error = ''

  override getTabName(): string {
    return t('archivedConversations')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadData()
  }

  private get projectNameById() {
    return new Map(this.projects.map((project) => [project.id, project.name]))
  }

  private async loadData() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const [sessionsResponse, projectsResponse] = await Promise.all([
        fetch('/api/storage/sessions-metadata/index/lastModified?direction=desc&limit=1000&offset=0&archived=only', { cache: 'no-store' }),
        fetch('/api/project', { cache: 'no-store' }).catch(() => null),
      ])

      const sessionsPayload = await sessionsResponse.json().catch(() => null) as ArchivedSessionsResponse | null
      if (!sessionsResponse.ok) throw new Error(sessionsPayload?.error || t('requestFailed'))
      this.sessions = Array.isArray(sessionsPayload?.values) ? sessionsPayload.values : []

      if (projectsResponse?.ok) {
        const projectsPayload = await projectsResponse.json().catch(() => null) as { projects?: ProjectInfo[] } | null
        this.projects = Array.isArray(projectsPayload?.projects) ? projectsPayload.projects : []
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private filteredSessions() {
    const normalizedQuery = this.query.trim().toLowerCase()
    return this.sessions.filter((session) => {
      if (this.projectFilter !== 'all') {
        if (this.projectFilter === 'global' && session.scope === 'project') return false
        if (this.projectFilter !== 'global' && session.projectId !== this.projectFilter) return false
      }
      if (!normalizedQuery) return true
      const projectName = session.projectId ? this.projectNameById.get(session.projectId) || '' : ''
      return `${sessionTitle(session.title)} ${projectName}`.toLowerCase().includes(normalizedQuery)
    })
  }

  private groupedSessions() {
    const groups = new Map<string, QuickForgeSessionMetadata[]>()
    for (const session of this.filteredSessions()) {
      const key = session.scope === 'project' && session.projectId ? session.projectId : 'global'
      groups.set(key, [...(groups.get(key) ?? []), session])
    }
    return [...groups.entries()]
  }

  private projectLabel(projectId: string) {
    if (projectId === 'global') return t('normalChat')
    return this.projectNameById.get(projectId) || t('unknownProject')
  }

  private async restoreSession(sessionId: string) {
    if (this.busySessionId) return
    this.busySessionId = sessionId
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      const session = await storage.sessions.get(sessionId) as QuickForgeSessionData | null
      const metadata = await storage.sessions.getMetadata(sessionId) as QuickForgeSessionMetadata | null
      if (!session || !metadata) throw new Error(t('sessionNotFound'))
      await storage.sessions.save(withoutArchivedAt(session), withoutArchivedAt(metadata))
      this.sessions = this.sessions.filter((item) => item.id !== sessionId)
      this.message = t('sessionRestored')
      notifySessionsChanged()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('restoreSessionFailed')
    } finally {
      this.busySessionId = ''
      this.requestUpdate()
    }
  }

  private async deleteSession(session: QuickForgeSessionMetadata) {
    if (this.busySessionId) return
    const confirmed = await showConfirm({
      description: t('deleteArchivedSessionConfirm', { title: sessionTitle(session.title) }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    this.busySessionId = session.id
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      await storage.sessions.delete(session.id)
      this.sessions = this.sessions.filter((item) => item.id !== session.id)
      this.message = t('archivedSessionDeleted')
      notifySessionsChanged()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('deleteSessionFailed')
    } finally {
      this.busySessionId = ''
      this.requestUpdate()
    }
  }

  private async deleteAllArchivedSessions() {
    if (this.busySessionId || this.sessions.length === 0) return
    const confirmed = await showConfirm({
      description: t('deleteAllArchivedSessionsConfirm'),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    this.busySessionId = '__all__'
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      await Promise.all(this.sessions.map((session) => storage.sessions.delete(session.id)))
      this.sessions = []
      this.message = t('archivedSessionsDeleted')
      notifySessionsChanged()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('deleteSessionFailed')
    } finally {
      this.busySessionId = ''
      this.requestUpdate()
    }
  }

  private renderSession(session: QuickForgeSessionMetadata) {
    const busy = this.busySessionId === session.id || this.busySessionId === '__all__'
    return html`
      <div class="border-t border-border px-4 py-3 first:border-t-0">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-foreground">${sessionTitle(session.title)}</div>
            <div class="mt-1 text-xs text-muted-foreground">
              ${t('lastModified')}: ${formatDate(session.lastModified)} · ${t('archivedAt')}: ${formatDate(session.archivedAt)}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button
              class="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-muted/60 disabled:opacity-60"
              type="button"
              ?disabled=${busy}
              @click=${() => this.restoreSession(session.id)}
            >
              ${t('restoreSession')}
            </button>
            <button
              class="rounded-md px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
              type="button"
              ?disabled=${busy}
              @click=${() => this.deleteSession(session)}
            >
              ${t('deletePermanently')}
            </button>
          </div>
        </div>
      </div>
    `
  }

  override render(): TemplateResult {
    const groups = this.groupedSessions()
    const busy = Boolean(this.busySessionId)

    return html`
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-semibold text-foreground">${t('archivedConversations')}</h3>
            <p class="mt-1 text-xs text-muted-foreground">${t('archivedConversationsDescription')}</p>
          </div>
          <button
            class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/15 disabled:opacity-60"
            type="button"
            ?disabled=${busy || this.sessions.length === 0}
            @click=${() => this.deleteAllArchivedSessions()}
          >
            ${t('deleteAll')}
          </button>
        </div>

        <section class="rounded-lg border border-border">
          <div class="grid gap-2 border-b border-border p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              type="search"
              .value=${this.query}
              placeholder=${t('searchArchivedConversations')}
              @input=${(event: Event) => {
                this.query = (event.target as HTMLInputElement).value
                this.requestUpdate()
              }}
            />
            <select
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.projectFilter}
              @change=${(event: Event) => {
                this.projectFilter = (event.target as HTMLSelectElement).value
                this.requestUpdate()
              }}
            >
              <option value="all">${t('allProjects')}</option>
              <option value="global">${t('normalChat')}</option>
              ${this.projects.map((project) => html`<option value=${project.id}>${project.name}</option>`)}
            </select>
          </div>

          ${this.loading ? html`
            <div class="px-4 py-8 text-center text-sm text-muted-foreground">${t('loading')}</div>
          ` : groups.length === 0 ? html`
            <div class="px-4 py-8 text-center text-sm text-muted-foreground">${t('noArchivedConversations')}</div>
          ` : html`
            <div>
              ${groups.map(([projectId, sessions]) => html`
                <div class="border-b border-border last:border-b-0">
                  <div class="flex items-center justify-between gap-3 bg-muted/20 px-4 py-2 text-sm text-muted-foreground">
                    <div class="truncate">${this.projectLabel(projectId)}</div>
                    <div class="shrink-0">${t('conversationCount', { count: sessions.length })}</div>
                  </div>
                  ${sessions.map((session) => this.renderSession(session))}
                </div>
              `)}
            </div>
          `}
        </section>

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-archived-conversations-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, ArchivedConversationsSettingsTab)
}

export function createArchivedConversationsSettingsTab() {
  return document.createElement(tagName) as ArchivedConversationsSettingsTab
}
