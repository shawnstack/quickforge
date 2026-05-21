import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { IDisposable } from '@xterm/xterm'
import { getWebSocketBaseUrl } from '@/lib/backend-url'
import type { TerminalMessage, TerminalSession } from './terminal-types'

type TerminalPaneProps = {
  session: TerminalSession
  active: boolean
  height: number
  onExited: (sessionId: string) => void
}

export function TerminalPane({ session, active, height, onExited }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const dataDisposableRef = useRef<IDisposable | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#0b0f14',
        foreground: '#d6deeb',
        cursor: '#d6deeb',
        selectionBackground: '#334155',
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
      dataDisposableRef.current = terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }))
      })
      window.setTimeout(fitAndResize, 0)
    })

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as TerminalMessage
        if (message.type === 'output') {
          terminal.write(message.data)
        } else if (message.type === 'exit') {
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

    ws.addEventListener('close', () => {
      dataDisposableRef.current?.dispose()
      dataDisposableRef.current = null
    })

    const resizeObserver = new ResizeObserver(() => fitAndResize())
    resizeObserver.observe(host)
    resizeObserverRef.current = resizeObserver
    window.setTimeout(fitAndResize, 50)

    return () => {
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
  }, [onExited, session.cwd, session.id])

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
