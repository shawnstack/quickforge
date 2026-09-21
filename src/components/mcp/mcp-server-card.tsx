import { Edit3, Loader2, RotateCw, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { McpServer } from '@/lib/types/mcp'

function statusBadgeClass(status?: string) {
  if (status === 'connected') return 'quickforge-settings-badge-success'
  if (status === 'error') return 'quickforge-settings-badge-danger'
  return 'quickforge-settings-badge-muted'
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
    <div className="quickforge-settings-list-item">
      <div className="quickforge-settings-list-item-main">
        <div className="quickforge-settings-row-title">{server.name}</div>
        <div className="quickforge-settings-row-description quickforge-settings-mono break-all">
          {server.transport === 'stdio'
            ? `${server.command} ${(server.args || []).join(' ')}`
            : server.url}
        </div>
        <div className="quickforge-settings-meta">
          {server.builtin ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('mcpBuiltIn')}</span> : null}
          <span className={`quickforge-settings-badge ${statusBadgeClass(server.status)}`}>{server.status || 'unknown'}</span>
          <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('mcpToolsCount', { count: totalCount })}</span>
        </div>
        {server.error ? <div className="quickforge-settings-alert mt-3">{server.error}</div> : null}
        {visibleTools.length > 0 ? (
          <div className="quickforge-settings-meta">
            {visibleTools.map((tool) => (
              <code key={tool.quickForgeName} className="quickforge-settings-command-name" title={tool.quickForgeName}>{tool.name}</code>
            ))}
            {hiddenCount > 0 ? (
              <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('mcpMoreTools', { count: hiddenCount })}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="quickforge-settings-list-item-actions quickforge-settings-icon-actions">
        <label
          className="quickforge-settings-switch"
          aria-disabled={toggling ? 'true' : 'false'}
          title={server.enabled ? t('pauseTask') : t('enable')}
        >
          <input
            type="checkbox"
            checked={server.enabled}
            aria-label={t('mcpEnabledSwitchLabel', { name: server.name })}
            disabled={toggling}
            onChange={() => onToggle(server)}
          />
          <span aria-hidden="true" />
        </label>
        {canReconnect ? (
          <button
            className="quickforge-settings-icon-action"
            type="button"
            onClick={() => onReconnect(server.name)}
            disabled={reconnecting}
            aria-label={t('mcpReconnectServer')}
            title={t('mcpReconnectServer')}
          >
            {reconnecting ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
          </button>
        ) : null}
        <button
          className="quickforge-settings-icon-action"
          type="button"
          onClick={() => onEdit(server)}
          aria-label={t('editTask')}
          title={t('editTask')}
        >
          <Edit3 className="size-4" />
        </button>
        {/* builtin 也渲染删除按钮（disabled 灰色），保证所有卡片操作区按钮数量一致、图标列对齐；服务端另有 409 删除保护 */}
        <button
          className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
          type="button"
          onClick={() => onDelete(server.name)}
          disabled={server.builtin}
          aria-label={server.builtin ? t('mcpBuiltinNoDelete') : t('delete')}
          title={server.builtin ? t('mcpBuiltinNoDelete') : t('delete')}
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  )
}
