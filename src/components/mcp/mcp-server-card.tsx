import { Edit3, Loader2, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { McpServer } from '@/lib/types/mcp'

function statusClass(status?: string) {
  if (status === 'connected') return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
  if (status === 'error') return 'bg-destructive/12 text-destructive'
  if (status === 'disabled') return 'bg-muted text-muted-foreground'
  return 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
}

const VISIBLE_TOOLS = 12

type McpServerCardProps = {
  server: McpServer
  toggling: boolean
  reconnecting: boolean
  onToggle: (server: McpServer) => void
  onEdit: (server: McpServer) => void
  onDelete: (name: string) => void
  onReconnect: (name: string) => void
}

export function McpServerCard({ server, toggling, reconnecting, onToggle, onEdit, onDelete, onReconnect }: McpServerCardProps) {
  const visibleTools = server.tools?.slice(0, VISIBLE_TOOLS) ?? []
  const totalCount = server.toolCount ?? server.tools?.length ?? 0
  const hiddenCount = Math.max(0, totalCount - visibleTools.length)
  const canReconnect = server.enabled && server.status !== 'connected'

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium text-foreground/90">{server.name}</div>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px]', statusClass(server.status))}>{server.status || 'unknown'}</span>
            <span className="text-[11px] text-muted-foreground/60">{t('mcpToolsCount', { count: totalCount })}</span>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground/65">
            {server.transport === 'stdio'
              ? `${server.command} ${(server.args || []).join(' ')}`
              : server.url}
          </div>
          {server.error ? <div className="mt-1 text-xs text-destructive">{server.error}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={server.enabled}
            disabled={toggling}
            className={cn('relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60', server.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')}
            onClick={() => onToggle(server)}
            title={server.enabled ? t('pauseTask') : t('enable')}
          >
            <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', server.enabled ? 'translate-x-5' : 'translate-x-0')} />
          </button>
          {canReconnect ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              onClick={() => onReconnect(server.name)}
              disabled={reconnecting}
              aria-label={t('mcpReconnectServer')}
              title={t('mcpReconnectServer')}
            >
              {reconnecting ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => onEdit(server)} aria-label={t('editTask')} title={t('editTask')}>
            <Edit3 className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => onDelete(server.name)} aria-label={t('delete')} title={t('delete')}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {visibleTools.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {visibleTools.map((tool) => (
            <span key={tool.quickForgeName} className="rounded-md bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground/75" title={tool.quickForgeName}>{tool.name}</span>
          ))}
          {hiddenCount > 0 ? (
            <span className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/55">{t('mcpMoreTools', { count: hiddenCount })}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
