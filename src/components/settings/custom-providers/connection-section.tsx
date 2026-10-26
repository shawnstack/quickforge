import { useState } from 'react'
import { Eye, EyeOff, SlidersHorizontal } from 'lucide-react'
import type { CustomProvider } from '@/storage'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import {
  connectionDraftOf,
  type ConnectionDraft,
  type HeaderRow,
  type ProviderProtocol,
} from './shared'

export type ConnectionTestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string }

export type ConnectionSectionProps = {
  provider: CustomProvider
  isDraft: boolean
  keyConfigured: boolean
  testState: ConnectionTestState
  /** 保存连接层（名称/地址/协议/请求头；草稿态同时带上密钥）。返回是否成功。 */
  onSaveConnection: (draft: ConnectionDraft, apiKey: string) => boolean | Promise<boolean>
  /** 已持久化的提供商单独更换密钥；空值 = 清除。返回是否成功。 */
  onSaveKey: (value: string) => boolean | Promise<boolean>
  onTest: (draft: ConnectionDraft, apiKey: string) => void
}

const sameDraft = (a: ConnectionDraft, b: ConnectionDraft) =>
  a.name === b.name && a.baseUrl === b.baseUrl && a.protocol === b.protocol
  && a.headerRows.length === b.headerRows.length
  && a.headerRows.every((row, index) => row.key === b.headerRows[index].key && row.value === b.headerRows[index].value)

export function ConnectionSection(props: ConnectionSectionProps) {
  const { provider, isDraft, keyConfigured, testState, onSaveConnection, onSaveKey, onTest } = props
  const [baseline, setBaseline] = useState<ConnectionDraft>(() => connectionDraftOf(provider))
  const [draft, setDraft] = useState<ConnectionDraft>(baseline)
  const [keyEditing, setKeyEditing] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [headersOpen, setHeadersOpen] = useState(baseline.headerRows.length > 0 || baseline.protocol === 'anthropic-messages')

  const dirty = !sameDraft(draft, baseline)

  const update = (patch: Partial<ConnectionDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const saveConnection = async () => {
    setSaving(true)
    try {
      const ok = await onSaveConnection(draft, keyValue)
      if (ok) {
        setBaseline(draft)
        setKeyEditing(false)
        setKeyValue('')
      }
    } finally {
      setSaving(false)
    }
  }

  const saveKey = async () => {
    setSaving(true)
    try {
      const ok = await onSaveKey(keyValue)
      if (ok) {
        setKeyEditing(false)
        setKeyValue('')
      }
    } finally {
      setSaving(false)
    }
  }

  const updateHeaderRow = (index: number, field: keyof HeaderRow, value: string) => {
    update({ headerRows: draft.headerRows.map((row, i) => (i === index ? { ...row, [field]: value } : row)) })
  }

  const testLabel = testState.status === 'testing' ? t('testingConnection') : t('testConnection')

  return (
    <section className="quickforge-providers-section" aria-label={t('connectionSection')}>
      <div className="quickforge-providers-section-head">
        <div className="quickforge-providers-section-title">{t('connectionSection')}</div>
        <div className="quickforge-providers-section-actions">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            disabled={testState.status === 'testing'}
            onClick={() => onTest(draft, keyValue)}
          >
            {testLabel}
          </button>
        </div>
      </div>

      <div className="quickforge-providers-connection-grid">
        <label className="quickforge-settings-form-row quickforge-providers-connection-wide">
          <span className="quickforge-settings-form-label">{t('protocolType')}<InfoTip label={t('protocolHelp')} /></span>
          <div className="quickforge-settings-segmented">
            {(['openai-completions', 'anthropic-messages'] as const).map((protocol) => (
              <button
                key={protocol}
                type="button"
                className={`quickforge-settings-segmented-option${draft.protocol === protocol ? ' quickforge-settings-segmented-option-active' : ''}`}
                aria-pressed={draft.protocol === protocol ? 'true' : 'false'}
                onClick={() => update({ protocol: protocol as ProviderProtocol })}
              >
                {protocol === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Compatible'}
              </button>
            ))}
          </div>
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('providerName')}</span>
          <input
            className="quickforge-settings-input"
            value={draft.name}
            placeholder={t('providerNamePlaceholder')}
            onChange={(event) => update({ name: event.currentTarget.value })}
          />
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">Base URL</span>
          <input
            className="quickforge-settings-input quickforge-settings-mono"
            value={draft.baseUrl}
            placeholder={draft.protocol === 'anthropic-messages' ? 'e.g., https://api.anthropic.com' : 'e.g., http://localhost:4000/v1'}
            onChange={(event) => update({ baseUrl: event.currentTarget.value })}
          />
        </label>
      </div>

      <div className="quickforge-providers-key-row">
        <div className="quickforge-providers-key-head">
          <span className="quickforge-providers-key-title">
            {t('apiKey')}
            <span className={`quickforge-settings-badge ${keyConfigured ? 'quickforge-settings-badge-success' : 'quickforge-settings-badge-warning'}`}>
              {keyConfigured ? t('keyConfigured') : t('keyNotConfigured')}
            </span>
          </span>
          {!isDraft
            ? keyEditing
              ? (
                <>
                  <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" disabled={saving} onClick={() => void saveKey()}>
                    {t('saveKey')}
                  </button>
                  <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" onClick={() => { setKeyEditing(false); setKeyValue('') }}>
                    {t('cancel')}
                  </button>
                </>
              )
              : (
                <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" onClick={() => setKeyEditing(true)}>
                  {keyConfigured ? t('replaceKey') : t('addKey')}
                </button>
              )
            : null}
        </div>
        <div className="quickforge-providers-key-hint">
          {isDraft ? t('keySavedWithConnection') : t('keyStorageHint')}
        </div>
        {keyEditing || isDraft
          ? (
            <div className="quickforge-settings-inline-field quickforge-providers-key-edit">
              <input
                className="quickforge-settings-input quickforge-settings-mono"
                value={keyValue}
                type={keyVisible ? 'text' : 'password'}
                name="qf-provider-api-key"
                autoComplete="new-password"
                placeholder={t('apiKeyPlaceholder')}
                onChange={(event) => setKeyValue(event.currentTarget.value)}
              />
              <button
                className="quickforge-settings-inline-field-button"
                type="button"
                title={keyVisible ? t('hideApiKey') : t('showApiKey')}
                aria-label={keyVisible ? t('hideApiKey') : t('showApiKey')}
                aria-pressed={keyVisible ? 'true' : 'false'}
                onClick={() => setKeyVisible(!keyVisible)}
              >
                {keyVisible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
          )
          : null}
      </div>

      <div className="quickforge-providers-headers-row">
        <button
          className="quickforge-settings-details-toggle"
          type="button"
          aria-expanded={headersOpen ? 'true' : 'false'}
          onClick={() => setHeadersOpen(!headersOpen)}
        >
          <span>{headersOpen ? '▾' : '▸'}</span>
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          {t('customHeaders')}
          <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('headersCount', { count: draft.headerRows.length })}</span>
        </button>
      </div>
      {headersOpen
        ? (
          <div className="quickforge-providers-headers-body">
            {draft.headerRows.length === 0
              ? null
              : draft.headerRows.map((row, index) => (
                <div className="quickforge-settings-subrow" key={index}>
                  <input
                    className="quickforge-settings-input"
                    value={row.key}
                    placeholder={t('headerName')}
                    onChange={(event) => updateHeaderRow(index, 'key', event.currentTarget.value)}
                  />
                  <input
                    className="quickforge-settings-input"
                    value={row.value}
                    placeholder={t('headerValue')}
                    onChange={(event) => updateHeaderRow(index, 'value', event.currentTarget.value)}
                  />
                  <button
                    className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                    type="button"
                    title={t('removeHeader')}
                    onClick={() => update({ headerRows: draft.headerRows.filter((_, i) => i !== index) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
              type="button"
              onClick={() => update({ headerRows: [...draft.headerRows, { key: '', value: '' }] })}
            >
              + {t('addHeader')}
            </button>
          </div>
        )
        : null}

      {testState.status !== 'idle' && testState.status !== 'testing'
        ? (
          <div className={testState.status === 'ok' ? 'quickforge-settings-message' : 'quickforge-settings-alert'}>
            {testState.status === 'ok' ? `✓ ${t('connectionOk')}` : `✗ ${testState.error || t('connectionFailed')}`}
          </div>
        )
        : null}

      {dirty
        ? (
          <div className="quickforge-providers-dirtybar">
            <span>{t('connectionDirty')}</span>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
              type="button"
              disabled={saving}
              onClick={() => setDraft(baseline)}
            >
              {t('discard')}
            </button>
            <button
              className="quickforge-settings-button quickforge-settings-button-primary quickforge-settings-button-compact"
              type="button"
              disabled={saving}
              onClick={() => void saveConnection()}
            >
              {t('saveConnection')}
            </button>
          </div>
        )
        : null}
    </section>
  )
}
