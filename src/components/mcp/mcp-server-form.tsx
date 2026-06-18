import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n'
import type { McpTransport } from '@/lib/types/mcp'
import {
  argsToText,
  envToText,
  textToArgs,
  textToEnv,
  type McpServerFormData,
} from '@/lib/mcp-helpers'

const labelClass = 'mb-1 block text-xs text-muted-foreground/72'
const textareaClass =
  'min-h-20 w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:border-ring'
const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-ring'

type McpServerFormProps = {
  value: McpServerFormData
  onChange: (data: McpServerFormData) => void
  isEdit: boolean
  disabled?: boolean
}

export function McpServerForm({ value, onChange, isEdit, disabled }: McpServerFormProps) {
  const showStdio = value.transport === 'stdio'
  const patch = (partial: Partial<McpServerFormData>) => onChange({ ...value, ...partial })

  return (
    <div className="space-y-3 p-3">
      <div className="text-xs text-muted-foreground/60">
        {isEdit ? t('mcpEditServer') : t('mcpAddServer')}
      </div>
      <div>
        <label className={labelClass} htmlFor="mcp-server-name">{t('mcpServerName')}</label>
        <Input id="mcp-server-name" value={value.name} onChange={(event) => patch({ name: event.target.value })} placeholder={t('mcpNamePlaceholder')} disabled={isEdit || disabled} />
      </div>
      <div>
        <label className={labelClass} htmlFor="mcp-server-transport">{t('mcpTransport')}</label>
        <select id="mcp-server-transport" className={selectClass} value={value.transport} onChange={(event) => patch({ transport: event.target.value as McpTransport })} disabled={disabled}>
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </div>
      {showStdio ? (
        <>
          <div>
            <label className={labelClass} htmlFor="mcp-server-command">{t('mcpCommand')}</label>
            <Input id="mcp-server-command" value={value.command} onChange={(event) => patch({ command: event.target.value })} placeholder={t('mcpCommandPlaceholder')} disabled={disabled} />
          </div>
          <div>
            <label className={labelClass} htmlFor="mcp-server-args">{t('mcpArgs')}</label>
            <textarea id="mcp-server-args" className={textareaClass} value={argsToText(value.args)} onChange={(event) => patch({ args: textToArgs(event.target.value) })} spellCheck={false} disabled={disabled} />
          </div>
          <div>
            <label className={labelClass} htmlFor="mcp-server-cwd">{t('mcpCwd')}</label>
            <Input id="mcp-server-cwd" value={value.cwd} onChange={(event) => patch({ cwd: event.target.value })} disabled={disabled} />
          </div>
          <div>
            <label className={labelClass} htmlFor="mcp-server-env">{t('mcpEnv')}</label>
            <textarea id="mcp-server-env" className={textareaClass} value={envToText(value.env)} onChange={(event) => patch({ env: textToEnv(event.target.value) })} spellCheck={false} disabled={disabled} />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className={labelClass} htmlFor="mcp-server-url">{t('mcpUrl')}</label>
            <Input id="mcp-server-url" value={value.url} onChange={(event) => patch({ url: event.target.value })} placeholder={t('mcpUrlPlaceholder')} disabled={disabled} />
          </div>
          <div>
            <label className={labelClass} htmlFor="mcp-server-headers">{t('mcpHeaders')}</label>
            <textarea id="mcp-server-headers" className={textareaClass} value={envToText(value.env)} onChange={(event) => patch({ env: textToEnv(event.target.value) })} spellCheck={false} disabled={disabled} />
          </div>
        </>
      )}
    </div>
  )
}
