import { t } from '@/lib/i18n'
import type { McpTransport } from '@/lib/types/mcp'
import {
  argsToText,
  envToText,
  textToArgs,
  textToEnv,
  type McpServerFormData,
} from '@/lib/mcp-helpers'

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
    <div className="quickforge-settings-form-grid">
      <label className="quickforge-settings-form-row">
        <span className="quickforge-settings-form-label">{t('mcpServerName')}</span>
        <input
          className="quickforge-settings-input"
          value={value.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder={t('mcpNamePlaceholder')}
          disabled={isEdit || disabled}
        />
      </label>
      <label className="quickforge-settings-form-row">
        <span className="quickforge-settings-form-label">{t('mcpTransport')}</span>
        <select
          className="quickforge-settings-select"
          value={value.transport}
          onChange={(event) => patch({ transport: event.target.value as McpTransport })}
          disabled={disabled}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </label>
      {showStdio ? (
        <>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpCommand')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.command}
              onChange={(event) => patch({ command: event.target.value })}
              placeholder={t('mcpCommandPlaceholder')}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpArgs')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={argsToText(value.args)}
              onChange={(event) => patch({ args: textToArgs(event.target.value) })}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpCwd')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.cwd}
              onChange={(event) => patch({ cwd: event.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpEnv')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={envToText(value.env)}
              onChange={(event) => patch({ env: textToEnv(event.target.value) })}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
        </>
      ) : (
        <>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpUrl')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.url}
              onChange={(event) => patch({ url: event.target.value })}
              placeholder={t('mcpUrlPlaceholder')}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpHeaders')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={envToText(value.env)}
              onChange={(event) => patch({ env: textToEnv(event.target.value) })}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
        </>
      )}
    </div>
  )
}
