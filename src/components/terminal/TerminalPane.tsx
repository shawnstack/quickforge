import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { IDisposable } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { getWebSocketBaseUrl } from '@/lib/backend-url'
import { t } from '@/lib/i18n'
import type { TerminalMessage, TerminalSession } from './terminal-types'

type TerminalPaneProps = {
  session: TerminalSession
  active: boolean
  height: number
  onReady: (sessionId: string) => void
  onExited: (sessionId: string) => void
  onConnectionError: (sessionId: string, message?: string) => void
}

export function TerminalPane({ session, active, height, onReady, onExited, onConnectionError }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const dataDisposableRef = useRef<IDisposable | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let opened = false
    let exited = false
    let connectionErrorReported = false

    const reportConnectionError = (message: string) => {
      if (disposed || exited || connectionErrorReported) return
      connectionErrorReported = true
      onConnectionError(session.id, message)
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        selectionBackground: '#dbeafe',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminal.writeln(`\x1b[2mConnected to ${session.cwd}\x1b[0m`)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const fitAndResize = () => {
      if (!host.isConnected) return
      try {
        fitAddon.fit()
        const { cols, rows } = terminal
        const ws = wsRef.current
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      } catch {
        // xterm fit can throw while the pane is hidden or detached.
      }
    }

    const ws = new WebSocket(`${getWebSocketBaseUrl()}/api/terminal/sessions/${encodeURIComponent(session.id)}/ws`)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      opened = true
      connectionErrorReported = false
      onConnectionError(session.id, undefined)
      dataDisposableRef.current = terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
      })
      window.setTimeout(fitAndResize, 0)
    })

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as TerminalMessage
        if (message.type === 'ready') {
          onReady(session.id)
        } else if (message.type === 'output') {
          terminal.write(message.data)
        } else if (message.type === 'exit') {
          exited = true
          terminal.writeln('')
          terminal.writeln(`\x1b[33m[process exited with code ${message.exitCode ?? 'unknown'}]\x1b[0m`)
          onExited(session.id)
        } else if (message.type === 'error') {
          terminal.writeln(`\x1b[31m${message.message}\x1b[0m`)
        }
      } catch {
        // Ignore malformed terminal messages.
      }
    })

    ws.addEventListener('error', () => {
      reportConnectionError(opened ? t('terminalConnectionClosedUnexpectedly') : t('terminalConnectionFailed'))
    })

    ws.addEventListener('close', (event) => {
      dataDisposableRef.current?.dispose()
      dataDisposableRef.current = null
      if (disposed || exited) return

      if (!event.wasClean || event.code !== 1000) {
        reportConnectionError(opened ? t('terminalConnectionClosedUnexpectedly') : t('terminalConnectionFailed'))
      }
    })

    const resizeObserver = new ResizeObserver(() => fitAndResize())
    resizeObserver.observe(host)
    resizeObserverRef.current = resizeObserver
    window.setTimeout(fitAndResize, 50)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      resizeObserverRef.current = null
      dataDisposableRef.current?.dispose()
      dataDisposableRef.current = null
      ws.close()
      wsRef.current = null
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [onConnectionError, onExited, onReady, session.cwd, session.id])

  useEffect(() => {
    if (!active) return
    const fitAddon = fitAddonRef.current
    const terminal = terminalRef.current
    window.setTimeout(() => {
      try {
        fitAddon?.fit()
        terminal?.focus()
      } catch {
        // ignore hidden pane fit races
      }
    }, 0)
  }, [active, height])

  return (
    <div
      ref={hostRef}
      className={active ? 'h-full min-h-0 w-full' : 'hidden'}
      aria-hidden={!active}
    />
  )
}
