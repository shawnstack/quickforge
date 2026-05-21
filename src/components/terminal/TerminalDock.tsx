import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import { createTerminalSession, deleteTerminalSession, getTerminalCapabilities, listTerminalSessions } from './terminal-api'
import { TerminalPane } from './TerminalPane'
import type { TerminalCapabilities, TerminalSession, TerminalShellProfile } from './terminal-types'

type TerminalDockProps = {
  project?: ProjectInfo
  onCollapse: () => void
}

const MIN_HEIGHT = 180
const MAX_HEIGHT_RATIO = 0.7
const DEFAULT_HEIGHT = 320

function nextTerminalName(sessions: TerminalSession[], profile?: TerminalShellProfile) {
  const baseName = profile && profile.id !== 'auto' ? profile.name : 'Terminal'
  const used = new Set(sessions.map((session) => session.name))
  if (baseName !== 'Terminal' && !used.has(baseName)) return baseName
  let index = 1
  while (used.has(`${baseName} ${index}`)) index += 1
  return `${baseName} ${index}`
}

function profileFromCapabilities(capabilities: TerminalCapabilities | null, profileId?: string) {
  const profiles = capabilities?.terminalShellProfiles || []
  const selectedId = profileId || capabilities?.defaultTerminalShellProfileId || 'auto'
  return profiles.find((profile) => profile.id === selectedId) || profiles.find((profile) => profile.id === 'auto')
}

export function TerminalDock({ project, onCollapse }: TerminalDockProps) {
  const [capabilities, setCapabilities] = useState<TerminalCapabilities | null>(null)
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const [shellMenuOpen, setShellMenuOpen] = useState(false)
  const creatingRef = useRef(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const shellMenuRef = useRef<HTMLDivElement | null>(null)
  const projectId = project?.id

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0],
    [activeSessionId, sessions],
  )

  const refreshSessions = useCallback(async () => {
    const payload = await listTerminalSessions(projectId)
    setSessions(payload.sessions)
    setActiveSessionId((current) => {
      if (current && payload.sessions.some((session) => session.id === current)) return current
      return payload.sessions[0]?.id
    })
    return payload.sessions
  }, [projectId])

  const createSession = useCallback(async (existingSessions: TerminalSession[], shellProfileId?: string) => {
    if (creatingRef.current) return
    const profile = profileFromCapabilities(capabilities, shellProfileId)
    creatingRef.current = true
    setCreating(true)
    setError(undefined)
    try {
      const session = await createTerminalSession({
        projectId,
        name: nextTerminalName(existingSessions, profile),
        cols: 120,
        rows: 30,
        shellProfileId: profile?.id,
        shellProfileName: profile?.name,
      })
      setSessions((current) => [...current, session])
      setActiveSessionId(session.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('terminalCreateFailed'))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [capabilities, projectId])

  useEffect(() => {
    let disposed = false
    const load = async () => {
      setLoading(true)
      setError(undefined)
      try {
        const [nextCapabilities, payload] = await Promise.all([getTerminalCapabilities(), listTerminalSessions(projectId)])
        if (disposed) return
        setCapabilities(nextCapabilities)
        setSessions(payload.sessions)
        setActiveSessionId(payload.sessions[0]?.id)
        if (nextCapabilities.enabled && payload.sessions.length === 0) {
          const defaultProfile = profileFromCapabilities(nextCapabilities)
          void createTerminalSession({
            projectId,
            name: nextTerminalName([], defaultProfile),
            cols: 120,
            rows: 30,
            shellProfileId: defaultProfile?.id,
            shellProfileName: defaultProfile?.name,
          }).then((session) => {
            if (disposed) return
            setSessions([session])
            setActiveSessionId(session.id)
          }).catch((err) => {
            if (!disposed) setError(err instanceof Error ? err.message : t('terminalCreateFailed'))
          })
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : t('terminalUnavailable'))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void load()

    return () => { disposed = true }
  }, [projectId])

  useEffect(() => {
    if (!shellMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!shellMenuRef.current?.contains(event.target as Node)) setShellMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShellMenuOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [shellMenuOpen])

  const closeSession = async (sessionId: string) => {
    setError(undefined)
    const remaining = sessions.filter((session) => session.id !== sessionId)
    setSessions(remaining)
    if (activeSessionId === sessionId) setActiveSessionId(remaining[0]?.id)
    try {
      await deleteTerminalSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('terminalCloseFailed'))
      void refreshSessions().catch(() => {})
    }
  }

  const markExited = useCallback((sessionId: string) => {
    setSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, exited: true } : session
    )))
  }, [])

  const startDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startY: event.clientY, startHeight: height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current
    if (!start) return
    const maxHeight = Math.max(MIN_HEIGHT, Math.floor(window.innerHeight * MAX_HEIGHT_RATIO))
    const nextHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, start.startHeight + start.startY - event.clientY))
    setHeight(nextHeight)
  }

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const shellProfiles = capabilities?.terminalShellProfiles || []
  const defaultProfileId = capabilities?.defaultTerminalShellProfileId || 'auto'
  const defaultProfile = shellProfiles.find((profile) => profile.id === defaultProfileId) || shellProfiles[0]
  const maxSessionsReached = Boolean(capabilities && sessions.length >= capabilities.maxSessions)
  const createDisabled = creating || maxSessionsReached

  return (
    <div className="shrink-0 border-t border-border bg-background" style={{ height }}>
      <div
        className="h-1 cursor-row-resize bg-transparent hover:bg-border"
        onPointerDown={startDragging}
        onPointerMove={drag}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      />
      <div className="flex h-9 items-center gap-1 border-b border-border px-2">
        <SquareTerminal className="size-4 shrink-0 text-muted-foreground/60" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={cn(
                'group flex max-w-44 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/72 hover:bg-muted/20 hover:text-foreground/85',
                activeSession?.id === session.id && 'bg-muted/28 text-foreground/90',
              )}
              onClick={() => setActiveSessionId(session.id)}
              title={`${session.name} — ${session.cwd}`}
            >
              <span className={cn('size-1.5 rounded-full', session.exited ? 'bg-muted-foreground/40' : 'bg-emerald-500/80')} />
              <span className="truncate">{session.name}</span>
              <span
                role="button"
                tabIndex={0}
                className="ml-1 rounded-sm p-0.5 opacity-60 hover:bg-background hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeSession(session.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    void closeSession(session.id)
                  }
                }}
                aria-label={t('terminalCloseSession', { name: session.name })}
              >
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
        <div className="relative shrink-0" ref={shellMenuRef}>
          <div className="flex items-center overflow-hidden rounded-md border border-border bg-background">
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center text-foreground/85 transition-colors hover:bg-muted/20 disabled:pointer-events-none disabled:opacity-50"
              onClick={() => void createSession(sessions)}
              disabled={createDisabled}
              title={defaultProfile ? t('terminalNewWithProfile', { name: defaultProfile.name }) : t('terminalNew')}
              aria-label={t('terminalNew')}
            >
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            </button>
            {shellProfiles.length > 0 ? (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center border-l border-border text-muted-foreground/72 transition-colors hover:bg-muted/20 hover:text-foreground/85 disabled:pointer-events-none disabled:opacity-50"
                onClick={() => setShellMenuOpen((open) => !open)}
                disabled={createDisabled}
                title={t('terminalSelectShell')}
                aria-label={t('terminalSelectShell')}
                aria-expanded={shellMenuOpen}
              >
                <ChevronDown className="size-3.5" />
              </button>
            ) : null}
          </div>
          {shellMenuOpen ? (
            <div className="absolute bottom-9 right-0 z-30 w-64 overflow-hidden rounded-lg border border-border bg-background p-1.5 shadow-[0_16px_38px_-22px_rgb(15_23_42_/_0.65)]">
              <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">{t('terminalNewWith')}</div>
              {shellProfiles.map((profile) => {
                const isDefault = profile.id === defaultProfileId
                return (
                  <button
                    key={profile.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground/80 hover:bg-muted/20 hover:text-foreground/90"
                    onClick={() => {
                      setShellMenuOpen(false)
                      void createSession(sessions, profile.id)
                    }}
                  >
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-muted/20 text-[10px] text-muted-foreground/70">
                      {profile.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{profile.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground/55">{profile.command}</span>
                    </span>
                    {isDefault ? <Check className="size-3.5 shrink-0 text-emerald-500/80" /> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCollapse} title={t('terminalCollapse')} aria-label={t('terminalCollapse')}>
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      {error ? <div className="border-b border-border px-3 py-1.5 text-xs text-destructive">{error}</div> : null}
      <div className="min-h-0 bg-[#0b0f14]" style={{ height: error ? height - 72 : height - 45 }}>
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <Loader2 className="size-4 animate-spin" /> {t('terminalStarting')}
          </div>
        ) : capabilities && !capabilities.enabled ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground/60">
            {capabilities.reason || t('terminalUnavailable')}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
            {t('terminalNoSessions')}
          </div>
        ) : (
          sessions.map((session) => (
            <TerminalPane
              key={session.id}
              session={session}
              active={session.id === activeSession?.id}
              height={height}
              onExited={markExited}
            />
          ))
        )}
      </div>
    </div>
  )
}
