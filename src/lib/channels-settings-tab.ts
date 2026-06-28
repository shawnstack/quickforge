import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import './info-tip'

const ACTION_HEADER = { 'x-quickforge-action': 'channel-action' }

type ChannelLog = {
  id: string
  time: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

type ChannelAction = {
  id: string
  label: string
  destructive?: boolean
}

type ChannelStatus = {
  id: string
  name: string
  description: string
  provider?: string
  commandLabel?: string
  supportsWorkspaceSelection?: boolean
  launchWorkspace?: WorkspaceOption | null
  status: 'stopped' | 'starting' | 'waiting_scan' | 'running' | 'stopping' | 'error'
  pid?: number | null
  startedAt?: string | null
  stoppedAt?: string | null
  error?: string | null
  logs: ChannelLog[]
  qrCodeUrl?: string | null
  qrCodeText?: string
  actions?: ChannelAction[]
  requirements?: string[]
  activeAction?: string | null
}

type WorkspaceOption = {
  id: string
  name: string
  path: string
  kind?: 'default' | 'project'
}

type ProjectPayload = {
  project?: WorkspaceOption | null
  projects?: WorkspaceOption[]
  defaultWorkspaceRoot?: string
}

type ChannelsPayload = {
  channels: ChannelStatus[]
}

type ChannelEvent = {
  type: string
  channelId?: string
  channels?: ChannelStatus[]
  snapshot?: ChannelStatus
  log?: ChannelLog
  qrCodeUrl?: string | null
  qrCodeText?: string
}

function statusTone(status: ChannelStatus['status']) {
  switch (status) {
    case 'running':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'waiting_scan':
    case 'starting':
    case 'stopping':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive'
    default:
      return 'border-border bg-muted/15 text-muted-foreground'
  }
}

function statusLabel(status: ChannelStatus['status']) {
  switch (status) {
    case 'starting': return t('channelStatusStarting')
    case 'waiting_scan': return t('channelStatusWaitingScan')
    case 'running': return t('channelStatusRunning')
    case 'stopping': return t('channelStatusStopping')
    case 'error': return t('channelStatusError')
    default: return t('channelStatusStopped')
  }
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

class ChannelsSettingsTab extends SettingsTab {
  private loading = true
  private channels: ChannelStatus[] = []
  private workspaces: WorkspaceOption[] = []
  private selectedWorkspaceIdByChannel: Record<string, string> = {}
  private error = ''
  private message = ''
  private eventSource?: EventSource
  private busyChannelId = ''

  override getTabName(): string {
    return t('channels')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await Promise.all([this.loadChannels(), this.loadWorkspaces()])
    this.connectEvents()
  }

  override disconnectedCallback() {
    this.eventSource?.close()
    this.eventSource = undefined
    super.disconnectedCallback()
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.headers || {}),
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
    return payload as T
  }

  private async loadChannels() {
    this.loading = true
    this.error = ''
    this.requestUpdate()
    try {
      const payload = await this.request<ChannelsPayload>('/api/channels')
      this.channels = Array.isArray(payload.channels) ? payload.channels : []
      this.ensureWorkspaceSelections()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private async loadWorkspaces() {
    try {
      const payload = await this.request<ProjectPayload>('/api/project')
      const defaultRoot = payload.defaultWorkspaceRoot || ''
      const defaultWorkspace: WorkspaceOption[] = defaultRoot
        ? [{ id: 'default', name: t('channelDefaultWorkspace'), path: defaultRoot, kind: 'default' }]
        : []
      const projects = (Array.isArray(payload.projects) ? payload.projects : []).map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        kind: 'project' as const,
      }))
      this.workspaces = [...defaultWorkspace, ...projects]
      this.ensureWorkspaceSelections()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.requestUpdate()
    }
  }

  private ensureWorkspaceSelections() {
    const availableIds = new Set(this.workspaces.map((workspace) => workspace.id))
    const nextSelections = { ...this.selectedWorkspaceIdByChannel }
    for (const channel of this.channels) {
      if (!channel.supportsWorkspaceSelection) continue
      const current = nextSelections[channel.id]
      const launchId = channel.launchWorkspace?.id
      const isActive = channel.status !== 'stopped' && channel.status !== 'error'
      if (launchId && availableIds.has(launchId) && isActive) {
        nextSelections[channel.id] = launchId
        continue
      }
      if (current && availableIds.has(current)) continue
      nextSelections[channel.id] = launchId && availableIds.has(launchId) ? launchId : 'default'
    }
    this.selectedWorkspaceIdByChannel = nextSelections
  }

  private connectEvents() {
    this.eventSource?.close()
    const source = new EventSource('/api/channels/events')
    this.eventSource = source

    const handleEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as ChannelEvent
        this.applyChannelEvent(payload)
      } catch {
        // Ignore malformed SSE payloads.
      }
    }

    source.addEventListener('snapshot', handleEvent)
    source.addEventListener('status', handleEvent)
    source.addEventListener('log', handleEvent)
    source.addEventListener('qrcode', handleEvent)
    source.addEventListener('error', () => {
      // EventSource auto-reconnects; keep current state visible.
    })
  }

  private applyChannelEvent(event: ChannelEvent) {
    if (Array.isArray(event.channels)) {
      this.channels = event.channels
      this.ensureWorkspaceSelections()
      this.requestUpdate()
      return
    }

    if (event.snapshot) {
      this.upsertChannel(event.snapshot)
      return
    }

    if (event.channelId && event.log) {
      const channel = this.channels.find((item) => item.id === event.channelId)
      if (channel) {
        channel.logs = [...(channel.logs || []), event.log].slice(-300)
        this.requestUpdate()
      }
    }
  }

  private upsertChannel(channel: ChannelStatus) {
    const index = this.channels.findIndex((item) => item.id === channel.id)
    if (index >= 0) {
      this.channels = [
        ...this.channels.slice(0, index),
        channel,
        ...this.channels.slice(index + 1),
      ]
    } else {
      this.channels = [...this.channels, channel]
    }
    this.ensureWorkspaceSelections()
    this.requestUpdate()
  }

  private selectedWorkspaceId(channel: ChannelStatus) {
    return this.selectedWorkspaceIdByChannel[channel.id] || channel.launchWorkspace?.id || 'default'
  }

  private handleWorkspaceChange(channel: ChannelStatus, event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null
    if (!target) return
    this.selectedWorkspaceIdByChannel = {
      ...this.selectedWorkspaceIdByChannel,
      [channel.id]: target.value || 'default',
    }
    this.requestUpdate()
  }

  private startOptions(channel: ChannelStatus) {
    return channel.supportsWorkspaceSelection
      ? { projectId: this.selectedWorkspaceId(channel) }
      : undefined
  }

  private async invoke(channel: ChannelStatus, operation: 'start' | 'stop' | 'restart') {
    if (this.busyChannelId) return
    if (operation === 'restart') {
      const confirmed = await showConfirm({
        description: t('channelRestartConfirm', { name: channel.name }),
        confirmLabel: t('restart'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }

    this.busyChannelId = channel.id
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const body = operation === 'start' || operation === 'restart' ? this.startOptions(channel) : undefined
      const snapshot = await this.request<ChannelStatus>(`/api/channels/${encodeURIComponent(channel.id)}/${operation}`, {
        method: 'POST',
        headers: body ? { ...ACTION_HEADER, 'content-type': 'application/json' } : ACTION_HEADER,
        body: body ? JSON.stringify(body) : undefined,
      })
      this.upsertChannel(snapshot)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.busyChannelId = ''
      this.requestUpdate()
    }
  }

  private async invokeAction(channel: ChannelStatus, action: ChannelAction) {
    if (this.busyChannelId) return
    if (action.destructive || action.id === 'relogin') {
      const confirmed = await showConfirm({
        description: action.id === 'relogin'
          ? t('channelReloginConfirm', { name: channel.name })
          : t('channelLogoutConfirm', { name: channel.name }),
        confirmLabel: action.label,
        cancelLabel: t('cancel'),
        variant: action.destructive ? 'destructive' : undefined,
      })
      if (!confirmed) return
    }

    this.busyChannelId = channel.id
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const body = action.id === 'relogin' ? this.startOptions(channel) : undefined
      const snapshot = await this.request<ChannelStatus>(`/api/channels/${encodeURIComponent(channel.id)}/actions/${encodeURIComponent(action.id)}`, {
        method: 'POST',
        headers: body ? { ...ACTION_HEADER, 'content-type': 'application/json' } : ACTION_HEADER,
        body: body ? JSON.stringify(body) : undefined,
      })
      this.upsertChannel(snapshot)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.busyChannelId = ''
      this.requestUpdate()
    }
  }

  private workspaceSection(channel: ChannelStatus, disabled: boolean) {
    if (!channel.supportsWorkspaceSelection) return null
    const selectedId = this.selectedWorkspaceId(channel)
    const currentWorkspace = channel.launchWorkspace
    return html`
      <div class="mt-4 rounded-lg border border-border bg-muted/10 p-3">
        <label class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground" for=${`channel-workspace-${channel.id}`}>
          ${t('channelWorkspace')}
          <quickforge-info-tip .label=${t('channelWorkspaceDescription')}></quickforge-info-tip>
        </label>
        <select
          id=${`channel-workspace-${channel.id}`}
          class="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60"
          ?disabled=${disabled}
          .value=${selectedId}
          @change=${(event: Event) => this.handleWorkspaceChange(channel, event)}
        >
          ${this.workspaces.map((workspace) => html`
            <option value=${workspace.id}>${workspace.kind === 'default' ? t('channelDefaultWorkspace') : workspace.name} — ${workspace.path}</option>
          `)}
        </select>
        ${currentWorkspace
          ? html`<div class="mt-2 text-xs text-muted-foreground">${t('channelCurrentWorkspace')}: <span class="font-mono">${currentWorkspace.path}</span></div>`
          : null}
      </div>
    `
  }

  private channelMeta(channel: ChannelStatus) {
    const rows = [
      [t('channelProvider'), channel.provider || '-'],
      [t('channelCommand'), channel.commandLabel || '-'],
      [t('channelPid'), channel.pid ? String(channel.pid) : '-'],
      [t('channelStartedAt'), formatDate(channel.startedAt)],
    ]
    return html`
      <dl class="grid gap-2 text-sm">
        ${rows.map(([label, value]) => html`
          <div class="grid gap-1 sm:grid-cols-[112px_1fr] sm:gap-3">
            <dt class="text-muted-foreground">${label}</dt>
            <dd class="min-w-0 break-all ${label === t('channelCommand') ? 'font-mono text-xs' : 'text-foreground'}">${value}</dd>
          </div>
        `)}
      </dl>
    `
  }

  private qrSection(channel: ChannelStatus) {
    if (!channel.qrCodeText && !channel.qrCodeUrl && channel.status !== 'waiting_scan') return null
    return html`
      <div class="mt-4 rounded-lg border border-border bg-muted/10 p-3">
        <div class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          ${t('channelQrTitle')}
          <quickforge-info-tip .label=${t('channelQrDescription')}></quickforge-info-tip>
        </div>
        ${channel.qrCodeText
          ? html`<pre class="mt-3 max-h-96 overflow-auto whitespace-pre font-mono text-[10px] leading-none text-foreground">${channel.qrCodeText}</pre>`
          : null}
        ${channel.qrCodeUrl
          ? html`
            <div class="mt-3 text-xs text-muted-foreground">${t('channelQrLink')}</div>
            <a class="mt-1 block break-all font-mono text-xs text-primary hover:underline" href=${channel.qrCodeUrl} target="_blank" rel="noreferrer">${channel.qrCodeUrl}</a>
          `
          : null}
      </div>
    `
  }

  private logsSection(channel: ChannelStatus) {
    const logs = channel.logs || []
    return html`
      <details class="mt-4 rounded-lg border border-border bg-muted/10" open>
        <summary class="quickforge-channel-logs-summary cursor-pointer px-3 py-2 text-sm font-medium text-foreground">${t('channelRecentLogs')}</summary>
        <div class="max-h-72 overflow-auto p-3 font-mono text-xs leading-5">
          ${logs.length
            ? logs.slice(-80).map((log) => html`
              <div class="grid gap-1 py-0.5 sm:grid-cols-[72px_56px_1fr]">
                <span class="text-muted-foreground/55">${new Date(log.time).toLocaleTimeString()}</span>
                <span class=${log.stream === 'stderr' ? 'text-destructive/80' : 'text-muted-foreground/70'}>${log.stream}</span>
                <span class="min-w-0 whitespace-pre-wrap break-words text-foreground/85">${log.text}</span>
              </div>
            `)
            : html`<div class="text-muted-foreground">${t('channelNoLogs')}</div>`}
        </div>
      </details>
    `
  }

  private channelCard(channel: ChannelStatus) {
    const busy = this.busyChannelId === channel.id || Boolean(channel.activeAction)
    const isRunning = channel.status === 'running' || channel.status === 'waiting_scan' || channel.status === 'starting'
    const isStopping = channel.status === 'stopping'
    const noWorkspace = Boolean(channel.supportsWorkspaceSelection && this.workspaces.length === 0)
    return html`
      <section class="rounded-lg border border-border p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="text-sm font-semibold text-foreground">${channel.name}</h4>
              <span class="inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(channel.status)}">${statusLabel(channel.status)}</span>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">${channel.description}</p>
            ${channel.requirements?.length
              ? html`<div class="mt-2 text-xs text-muted-foreground/70">${t('channelRequirements')}: ${channel.requirements.join(' · ')}</div>`
              : null}
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            <button class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60" type="button" ?disabled=${busy || isRunning || isStopping || noWorkspace} @click=${() => this.invoke(channel, 'start')}>${t('start')}</button>
            <button class="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/20 disabled:opacity-60" type="button" ?disabled=${busy || !isRunning || isStopping} @click=${() => this.invoke(channel, 'stop')}>${t('stop')}</button>
            <button class="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/20 disabled:opacity-60" type="button" ?disabled=${busy || isStopping || noWorkspace} @click=${() => this.invoke(channel, 'restart')}>${t('restart')}</button>
            ${channel.actions?.map((action) => html`
              <button class=${action.destructive ? 'rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60' : 'rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/20 disabled:opacity-60'} type="button" ?disabled=${busy} @click=${() => this.invokeAction(channel, action)}>${action.label}</button>
            `)}
          </div>
        </div>

        ${this.workspaceSection(channel, busy || isRunning || isStopping)}
        ${noWorkspace ? html`<div class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${t('channelNoWorkspaces')}</div>` : null}
        <div class="mt-4">${this.channelMeta(channel)}</div>
        ${channel.error ? html`<div class="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${channel.error}</div>` : null}
        ${this.qrSection(channel)}
        ${this.logsSection(channel)}
      </section>
    `
  }

  override render(): TemplateResult {
    if (this.loading) return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            ${t('channels')}
            <quickforge-info-tip .label=${t('channelsDescription')}></quickforge-info-tip>
          </h3>
        </div>

        <section class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          ${t('channelsSecurityWarning')}
        </section>

        ${this.channels.length
          ? html`<div class="grid gap-4">${this.channels.map((channel) => this.channelCard(channel))}</div>`
          : html`<div class="rounded-lg border border-border p-4 text-sm text-muted-foreground">${t('channelsEmpty')}</div>`}

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-channels-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, ChannelsSettingsTab)
}

export function createChannelsSettingsTab() {
  return document.createElement(tagName) as ChannelsSettingsTab
}
