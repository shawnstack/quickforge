import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Plus, SquareTerminal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import { createTerminalSession, deleteTerminalSession, getTerminalCapabilities, listTerminalSessions } from './terminal-api'
import { TerminalPane } from './TerminalPane'
import type { TerminalCapabilities, TerminalSession } from './terminal-types'

type TerminalDockProps = {
  project?: ProjectInfo
  onCollapse: () => void
}

const MIN_HEIGHT = 180
const MAX_HEIGHT_RATIO = 0.7
const DEFAULT_HEIGHT = 320

function nextTerminalName(sessions: TerminalSession[]) {
  const used = new Set(sessions.map((session) => session.name))
  let index = 1
  while (used.has(`Terminal ${index}`)) index += 1
  return `Terminal ${index}`
}

export function TerminalDock({ project, onCollapse }: TerminalDockProps) {
  const [capabilities, setCapabilities] = useState<TerminalCapabilities | null>(null)
  const [sessions, setSessions] = useState<TerminalSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>()
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const creatingRef = useRef(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
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

  const createSession = useCallback(async (existingSessions: TerminalSession[]) => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setError(undefined)
    try {
      const session = await createTerminalSession({
        projectId,
        name: nextTerminalName(existingSessions),
        cols: 120,
        rows: 30,
      })
      setSessions((current) => [...current, session])
      setActiveSessionId(session.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create terminal')
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }, [projectId])

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
          void createSession([])
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : 'Terminal unavailable')
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void load()

    return () => { disposed = true }
  }, [createSession, projectId])

  const closeSession = async (sessionId: string) => {
    setError(undefined)
    const remaining = sessions.filter((session) => session.id !== sessionId)
    setSessions(remaining)
    if (activeSessionId === sessionId) setActiveSessionId(remaining[0]?.id)
    try {
      await deleteTerminalSession(sessionId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close terminal')
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
                aria-label={`关闭 ${session.name}`}
              >
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => void createSession(sessions)}
          disabled={creating || Boolean(capabilities && sessions.length >= capabilities.maxSessions)}
          title="新建终端"
          aria-label="新建终端"
        >
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCollapse} title="收起终端" aria-label="收起终端">
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      {error ? <div className="border-b border-border px-3 py-1.5 text-xs text-destructive">{error}</div> : null}
      <div className="min-h-0 bg-[#0b0f14]" style={{ height: error ? height - 72 : height - 45 }}>
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground/60">
            <Loader2 className="size-4 animate-spin" /> 正在启动终端...
          </div>
        ) : capabilities && !capabilities.enabled ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground/60">
            {capabilities.reason || '终端不可用'}
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
            没有终端会话
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
