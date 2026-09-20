import { useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { InfoTip } from '@/components/ui/info-tip'

const ACTION_HEADER = { 'x-quickforge-action': 'channel-action' }

type ChannelAction = {
  id: string
  label: string
  destructive?: boolean
}

type ChannelStatus = {
  id: string
  name: string
  description: string
  supportsWorkspaceSelection?: boolean
  launchWorkspace?: WorkspaceOption | null
  status: 'stopped' | 'starting' | 'waiting_scan' | 'running' | 'stopping' | 'error'
  error?: string | null
  qrCodeUrl?: string | null
  qrCodeText?: string
  actions?: ChannelAction[]
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
  qrCodeUrl?: string | null
  qrCodeText?: string
}

function statusTone(status: ChannelStatus['status']) {
  switch (status) {
    case 'running':
      return 'quickforge-settings-badge-success'
    case 'waiting_scan':
    case 'starting':
    case 'stopping':
      return 'quickforge-settings-badge-warning'
    case 'error':
      return 'quickforge-settings-badge-danger'
    default:
      return 'quickforge-settings-badge-muted'
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
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

export function ChannelsSettingsTab({ active }: { active?: boolean } = {}) {
  const [loading, setLoading] = useState(true)
  const [channels, setChannels] = useState<ChannelStatus[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [selectedWorkspaceIdByChannel, setSelectedWorkspaceIdByChannel] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busyChannelId, setBusyChannelId] = useState('')
  const [openingLogsChannelId, setOpeningLogsChannelId] = useState('')

  // SSE 回调读取已提交的 channels/workspaces/selections。
  const channelsRef = useRef(channels)
  const workspacesRef = useRef(workspaces)
  const selectionsRef = useRef(selectedWorkspaceIdByChannel)
  useEffect(() => {
    channelsRef.current = channels
    workspacesRef.current = workspaces
    selectionsRef.current = selectedWorkspaceIdByChannel
  }, [channels, workspaces, selectedWorkspaceIdByChannel])
  const eventSourceRef = useRef<EventSource | undefined>(undefined)

  const ensureWorkspaceSelections = (nextChannels: ChannelStatus[], nextWorkspaces: WorkspaceOption[]) => {
    const availableIds = new Set(nextWorkspaces.map((workspace) => workspace.id))
    const nextSelections = { ...selectionsRef.current }
    for (const channel of nextChannels) {
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
    selectionsRef.current = nextSelections
    setSelectedWorkspaceIdByChannel(nextSelections)
  }

  const loadChannels = async () => {
    setLoading(true)
    setError('')
    try {
      const payload = await requestJson<ChannelsPayload>('/api/channels')
      const nextChannels = Array.isArray(payload.channels) ? payload.channels : []
      channelsRef.current = nextChannels
      setChannels(nextChannels)
      ensureWorkspaceSelections(nextChannels, workspacesRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  const loadWorkspaces = async () => {
    try {
      const payload = await requestJson<ProjectPayload>('/api/project')
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
      const nextWorkspaces = [...defaultWorkspace, ...projects]
      workspacesRef.current = nextWorkspaces
      setWorkspaces(nextWorkspaces)
      ensureWorkspaceSelections(channelsRef.current, nextWorkspaces)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const upsertChannel = (channel: ChannelStatus) => {
    const current = channelsRef.current
    const index = current.findIndex((item) => item.id === channel.id)
    const next = index >= 0
      ? [...current.slice(0, index), channel, ...current.slice(index + 1)]
      : [...current, channel]
    channelsRef.current = next
    setChannels(next)
    ensureWorkspaceSelections(next, workspacesRef.current)
  }

  const applyChannelEvent = (event: ChannelEvent) => {
    if (Array.isArray(event.channels)) {
      const next = event.channels
      channelsRef.current = next
      setChannels(next)
      ensureWorkspaceSelections(next, workspacesRef.current)
      return
    }

    if (event.snapshot) {
      upsertChannel(event.snapshot)
      return
    }
  }

  const connectEvents = () => {
    eventSourceRef.current?.close()
    const source = new EventSource('/api/channels/events')
    eventSourceRef.current = source

    const handleEvent = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as ChannelEvent
        applyChannelEvent(payload)
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

  useEffect(() => {
    // 旧版元素切走即 detach（断开 SSE），重新激活时重新加载并重建事件流；
    // 草稿状态（selectedWorkspaceIdByChannel 等）由常驻组件保留。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    void (async () => {
      await Promise.all([loadChannels(), loadWorkspaces()])
      connectEvents()
    })()
    return () => {
      eventSourceRef.current?.close()
      eventSourceRef.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const selectedWorkspaceId = (channel: ChannelStatus) => {
    return selectedWorkspaceIdByChannel[channel.id] || channel.launchWorkspace?.id || 'default'
  }

  const handleWorkspaceChange = (channel: ChannelStatus, event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value || 'default'
    const next = { ...selectionsRef.current, [channel.id]: value }
    selectionsRef.current = next
    setSelectedWorkspaceIdByChannel(next)
  }

  const startOptions = (channel: ChannelStatus) => {
    return channel.supportsWorkspaceSelection
      ? { projectId: selectedWorkspaceId(channel) }
      : undefined
  }

  const invoke = async (channel: ChannelStatus, operation: 'start' | 'stop' | 'restart') => {
    if (busyChannelId) return
    if (operation === 'restart') {
      const confirmed = await showConfirm({
        description: t('channelRestartConfirm', { name: channel.name }),
        confirmLabel: t('restart'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }

    setBusyChannelId(channel.id)
    setError('')
    setMessage('')
    try {
      const body = operation === 'start' || operation === 'restart' ? startOptions(channel) : undefined
      const snapshot = await requestJson<ChannelStatus>(`/api/channels/${encodeURIComponent(channel.id)}/${operation}`, {
        method: 'POST',
        headers: body ? { ...ACTION_HEADER, 'content-type': 'application/json' } : ACTION_HEADER,
        body: body ? JSON.stringify(body) : undefined,
      })
      upsertChannel(snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setBusyChannelId('')
    }
  }

  const invokeAction = async (channel: ChannelStatus, action: ChannelAction) => {
    if (busyChannelId) return
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

    setBusyChannelId(channel.id)
    setError('')
    setMessage('')
    try {
      const body = action.id === 'relogin' ? startOptions(channel) : undefined
      const snapshot = await requestJson<ChannelStatus>(`/api/channels/${encodeURIComponent(channel.id)}/actions/${encodeURIComponent(action.id)}`, {
        method: 'POST',
        headers: body ? { ...ACTION_HEADER, 'content-type': 'application/json' } : ACTION_HEADER,
        body: body ? JSON.stringify(body) : undefined,
      })
      upsertChannel(snapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setBusyChannelId('')
    }
  }

  const openLogs = async (channel: ChannelStatus) => {
    if (openingLogsChannelId) return
    setOpeningLogsChannelId(channel.id)
    setError('')
    setMessage('')
    try {
      await requestJson<{ ok: true }>(`/api/channels/${encodeURIComponent(channel.id)}/open-logs`, {
        method: 'POST',
        headers: ACTION_HEADER,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('channelOpenLogsFailed'))
    } finally {
      setOpeningLogsChannelId('')
    }
  }

  const workspaceSection = (channel: ChannelStatus, disabled: boolean) => {
    if (!channel.supportsWorkspaceSelection) return null
    const selectedId = selectedWorkspaceId(channel)
    return (
      <div className="quickforge-settings-row quickforge-settings-row-align-start">
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">
            {t('channelWorkspace')}
            <InfoTip label={t('channelWorkspaceDescription')} />
          </div>
          <div className="quickforge-settings-row-description">{t('channelWorkspaceDescription')}</div>
        </div>
        <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
          <select
            className="quickforge-settings-select"
            disabled={disabled}
            value={selectedId}
            onChange={(event) => handleWorkspaceChange(channel, event)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.kind === 'default' ? t('channelDefaultWorkspace') : workspace.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  const qrSection = (channel: ChannelStatus) => {
    if (!channel.qrCodeText) return null
    return (
      <div className="quickforge-settings-row quickforge-settings-row-align-start">
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">
            {t('channelQrTitle')}
            <InfoTip label={t('channelQrDescription')} />
          </div>
          <div className="quickforge-settings-row-description">{t('channelQrDescription')}</div>
        </div>
        <pre className="quickforge-channel-qr-text">{channel.qrCodeText}</pre>
      </div>
    )
  }

  const channelCard = (channel: ChannelStatus) => {
    const busy = busyChannelId === channel.id || Boolean(channel.activeAction)
    const openingLogs = openingLogsChannelId === channel.id
    const isRunning = channel.status === 'running' || channel.status === 'waiting_scan' || channel.status === 'starting'
    const isStopping = channel.status === 'stopping'
    const noWorkspace = Boolean(channel.supportsWorkspaceSelection && workspaces.length === 0)
    return (
      <section className="quickforge-settings-section" aria-label={channel.name} key={channel.id}>
        <div className="quickforge-settings-row quickforge-settings-row-top">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {channel.name}
              <span className={`quickforge-settings-badge ${statusTone(channel.status)}`}>{statusLabel(channel.status)}</span>
            </div>
            <div className="quickforge-settings-row-description">{channel.description}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              disabled={busy || isRunning || isStopping || noWorkspace}
              onClick={() => void invoke(channel, 'start')}
            >{t('start')}</button>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={busy || !isRunning || isStopping}
              onClick={() => void invoke(channel, 'stop')}
            >{t('stop')}</button>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={busy || isStopping || noWorkspace}
              onClick={() => void invoke(channel, 'restart')}
            >{t('restart')}</button>
            {channel.actions?.map((action) => (
              <button
                key={action.id}
                className={`quickforge-settings-button ${action.destructive ? 'quickforge-settings-button-danger' : 'quickforge-settings-button-secondary'}`}
                type="button"
                disabled={busy}
                onClick={() => void invokeAction(channel, action)}
              >{action.label}</button>
            ))}
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={Boolean(openingLogsChannelId)}
              onClick={() => void openLogs(channel)}
            >{openingLogs ? t('channelOpeningLogs') : t('channelOpenLogs')}</button>
          </div>
        </div>

        {workspaceSection(channel, busy || isRunning || isStopping)}
        {noWorkspace ? (
          <div className="quickforge-settings-alert quickforge-settings-warning-attached">{t('channelNoWorkspaces')}</div>
        ) : null}
        {channel.error ? (
          <div className="quickforge-settings-alert quickforge-settings-warning-attached">{channel.error}</div>
        ) : null}
        {qrSection(channel)}
      </section>
    )
  }

  if (loading) return <div className="quickforge-settings-note">{t('loading')}</div>

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-note">
        {t('channelsSecurityWarning')}
      </div>

      {channels.length
        ? channels.map((channel) => channelCard(channel))
        : <div className="quickforge-settings-note">{t('channelsEmpty')}</div>}

      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}
