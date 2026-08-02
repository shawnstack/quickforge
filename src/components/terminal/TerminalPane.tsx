import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { IDisposable } from '@xterm/xterm'
import { getWebSocketBaseUrl } from '@/lib/backend-url'
import { t } from '@/lib/i18n'
import { FONT_SIZE_SETTINGS_CHANGED_EVENT, getTerminalFontMetrics } from '@/lib/font-size-settings'
import { useAppTheme } from '@/hooks/useAppTheme'
import {
  MAX_AUTO_RECONNECT_ATTEMPTS,
  TERMINAL_CONNECT_TIMEOUT_MS,
  isTerminalSessionUnavailable,
  terminalReconnectDelay,
} from './terminal-connection'
import type { TerminalConnectionState } from './terminal-connection'
import type { TerminalMessage, TerminalSession } from './terminal-types'

type TerminalPaneProps = {
  session: TerminalSession
  active: boolean
  height: number
  retryKey: number
  onReady: (sessionId: string) => void
  onExited: (sessionId: string) => void
  onConnectionError: (sessionId: string, message?: string) => void
  onConnectionState: (sessionId: string, state: TerminalConnectionState) => void
}

const TERMINAL_THEMES = {
  light: {
    background: '#ffffff',
    foreground: '#1f2937',
    cursor: '#1f2937',
    selectionBackground: '#dbeafe',
  },
  dark: {
    background: '#171717',
    foreground: '#e5e7eb',
    cursor: '#e5e7eb',
    selectionBackground: '#3f3f46',
  },
}

export function TerminalPane({
  session,
  active,
  height,
  retryKey,
  onReady,
  onExited,
  onConnectionError,
  onConnectionState,
}: TerminalPaneProps) {
  const appTheme = useAppTheme()
  const terminalTheme = TERMINAL_THEMES[appTheme]
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const dataDisposableRef = useRef<IDisposable | null>(null)
  const fitAndResizeRef = useRef<() => void>(() => {})
  const connectedOnceRef = useRef(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminalMetrics = getTerminalFontMetrics()
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
        `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`,
      fontSize: terminalMetrics.fontSize,
      lineHeight: terminalMetrics.lineHeight,
      scrollback: 5000,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const fitAndResize = () => {
      if (!host.isConnected) return
      try {
        fitAddon.fit()
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        }
      } catch {
        // xterm fit can throw while the pane is hidden or detached.
      }
    }
    fitAndResizeRef.current = fitAndResize

    const resizeObserver = new ResizeObserver(() => fitAndResize())
    resizeObserver.observe(host)
    const handleFontSizeSettingsChanged = () => {
      const nextMetrics = getTerminalFontMetrics()
      terminal.options.fontSize = nextMetrics.fontSize
      terminal.options.lineHeight = nextMetrics.lineHeight
      window.setTimeout(fitAndResize, 0)
    }
    window.addEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, handleFontSizeSettingsChanged)
    window.setTimeout(fitAndResize, 50)

    return () => {
      window.removeEventListener(FONT_SIZE_SETTINGS_CHANGED_EVENT, handleFontSizeSettingsChanged)
      resizeObserver.disconnect()
      fitAndResizeRef.current = () => {}
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [session.id])

  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) terminal.options.theme = terminalTheme
  }, [terminalTheme])

  useEffect(() => {
    let disposed = false
    let exited = false
    let sessionUnavailable = false
    let retriesUsed = 0
    let reconnectTimer: number | undefined
    let connectionSequence = 0

    const setConnectionState = (state: TerminalConnectionState) => {
      if (!disposed) onConnectionState(session.id, state)
    }

    const connect = () => {
      if (disposed || exited || sessionUnavailable) return
      const sequence = ++connectionSequence
      let failureHandled = false
      let ready = false
      const ws = new WebSocket(`${getWebSocketBaseUrl()}/api/terminal/sessions/${encodeURIComponent(session.id)}/ws`)
      wsRef.current = ws
      setConnectionState(retriesUsed === 0 ? { status: 'connecting' } : {
        status: 'reconnecting',
        reconnectAttempt: retriesUsed,
      })

      const connectionTimeout = window.setTimeout(() => {
        if (disposed || exited || sessionUnavailable || ready || sequence !== connectionSequence) return
        handleFailure(t('terminalConnectionTimedOut'))
        try { ws.close() } catch { /* ignore */ }
      }, TERMINAL_CONNECT_TIMEOUT_MS)

      const handleFailure = (message: string) => {
        if (disposed || exited || sessionUnavailable || failureHandled || sequence !== connectionSequence) return
        failureHandled = true
        window.clearTimeout(connectionTimeout)
        dataDisposableRef.current?.dispose()
        dataDisposableRef.current = null

        const reconnectDelay = terminalReconnectDelay(retriesUsed)
        if (retriesUsed < MAX_AUTO_RECONNECT_ATTEMPTS && reconnectDelay !== undefined) {
          retriesUsed += 1
          setConnectionState({ status: 'reconnecting', reconnectAttempt: retriesUsed })
          reconnectTimer = window.setTimeout(connect, reconnectDelay)
          return
        }

        setConnectionState({ status: 'disconnected' })
        onConnectionError(session.id, message)
      }

      ws.addEventListener('open', () => {
        if (disposed || exited || failureHandled || sequence !== connectionSequence) {
          try { ws.close() } catch { /* ignore */ }
          return
        }
        dataDisposableRef.current?.dispose()
        dataDisposableRef.current = terminalRef.current?.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
        }) ?? null
        window.setTimeout(fitAndResizeRef.current, 0)
      })

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as TerminalMessage
          if (message.type === 'ready') {
            ready = true
            retriesUsed = 0
            window.clearTimeout(connectionTimeout)
            onConnectionError(session.id, undefined)
            setConnectionState({ status: 'connected' })
            if (!connectedOnceRef.current) {
              connectedOnceRef.current = true
              terminalRef.current?.writeln(`\x1b[2mConnected to ${session.cwd}\x1b[0m`)
            }
            onReady(session.id)
          } else if (message.type === 'output') {
            terminalRef.current?.write(message.data)
          } else if (message.type === 'exit') {
            exited = true
            window.clearTimeout(connectionTimeout)
            if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
            terminalRef.current?.writeln('')
            terminalRef.current?.writeln(`\x1b[33m[process exited with code ${message.exitCode ?? 'unknown'}]\x1b[0m`)
            setConnectionState({ status: 'exited' })
            onExited(session.id)
          } else if (message.type === 'error') {
            if (isTerminalSessionUnavailable(message)) {
              sessionUnavailable = true
              failureHandled = true
              window.clearTimeout(connectionTimeout)
              if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
              dataDisposableRef.current?.dispose()
              dataDisposableRef.current = null
              setConnectionState({ status: 'unavailable' })
              onConnectionError(session.id, t('terminalSessionUnavailable'))
              try { ws.close() } catch { /* ignore */ }
            } else {
              handleFailure(message.message || t('terminalConnectionFailed'))
            }
          }
        } catch {
          // Ignore malformed terminal messages.
        }
      })

      ws.addEventListener('error', () => {
        handleFailure(ready ? t('terminalConnectionClosedUnexpectedly') : t('terminalConnectionFailed'))
      })

      ws.addEventListener('close', () => {
        window.clearTimeout(connectionTimeout)
        dataDisposableRef.current?.dispose()
        dataDisposableRef.current = null
        if (disposed || exited || sessionUnavailable || failureHandled || sequence !== connectionSequence) return
        handleFailure(ready ? t('terminalConnectionClosedUnexpectedly') : t('terminalConnectionFailed'))
      })
    }

    onConnectionError(session.id, undefined)
    connect()

    return () => {
      disposed = true
      connectionSequence += 1
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer)
      dataDisposableRef.current?.dispose()
      dataDisposableRef.current = null
      const ws = wsRef.current
      wsRef.current = null
      try { ws?.close() } catch { /* ignore */ }
    }
  }, [onConnectionError, onConnectionState, onExited, onReady, retryKey, session.cwd, session.id])

  useEffect(() => {
    if (!active) return
    window.setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        terminalRef.current?.focus()
      } catch {
        // ignore hidden pane fit races
      }
    }, 0)
  }, [active, height])

  return (
    <div className={active ? 'h-full min-h-0 w-full pl-2 md:pl-3' : 'hidden'} aria-hidden={!active}>
      <div ref={hostRef} className="h-full min-h-0 w-full" />
    </div>
  )
}
