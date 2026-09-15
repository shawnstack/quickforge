import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PendingTerminalCommand } from '@/components/terminal/terminal-api'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'

type ExecuteMarkdownCommandEvent = CustomEvent<{
  command?: unknown
  confirm?: unknown
  dangerous?: unknown
}>

export function useAppTerminalState() {
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<PendingTerminalCommand | null>(null)
  const [terminalDockOpen, setTerminalDockOpen] = useState(false)
  const terminalCommandIdRef = useRef(0)
  return { pendingTerminalCommand, setPendingTerminalCommand, terminalDockOpen, setTerminalDockOpen, terminalCommandIdRef }
}

type TerminalOptions = ReturnType<typeof useAppTerminalState> & {
  remoteClient: boolean
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
}

// Called at the original late command-listener position in MainApp.
export function useAppTerminal({ remoteClient, setArtifactPreviewOpen, setTerminalDockOpen, setPendingTerminalCommand, terminalCommandIdRef }: TerminalOptions) {
  useEffect(() => {
    const handleExecuteMarkdownCommand = (event: Event) => {
      if (remoteClient) {
        void showAlert('远程客户端不能使用服务端终端')
        return
      }
      const detail = (event as ExecuteMarkdownCommandEvent).detail
      const command = typeof detail?.command === 'string' ? detail.command.trim() : ''
      if (!command) return

      const run = async () => {
        const requiresConfirm = Boolean(detail?.confirm || detail?.dangerous)
        if (requiresConfirm) {
          const confirmed = await showConfirm({
            title: t('confirmExecuteCommandTitle'),
            description: detail?.dangerous ? t('confirmExecuteDangerousCommand') : t('confirmExecuteMultipleCommands'),
            confirmLabel: t('executeInTerminal'),
            cancelLabel: t('cancel'),
            variant: detail?.dangerous ? 'destructive' : 'default',
          })
          if (!confirmed) return
        }

        setArtifactPreviewOpen(false)
        setTerminalDockOpen(true)
        setPendingTerminalCommand({
          id: ++terminalCommandIdRef.current,
          command,
          execute: true,
        })
      }

      void run().catch((error) => {
        logger.error('Failed to execute markdown command:', error)
        void showAlert(error instanceof Error ? error.message : t('terminalCommandExecuteFailed'))
      })
    }

    window.addEventListener('quickforge:execute-markdown-command', handleExecuteMarkdownCommand)
    return () => window.removeEventListener('quickforge:execute-markdown-command', handleExecuteMarkdownCommand)
  }, [remoteClient, setArtifactPreviewOpen, setPendingTerminalCommand, setTerminalDockOpen, terminalCommandIdRef])

  const handlePendingTerminalCommandHandled = useCallback((id: number) => {
    setPendingTerminalCommand((current) => current?.id === id ? null : current)
  }, [setPendingTerminalCommand])
  return { handlePendingTerminalCommandHandled }
}
