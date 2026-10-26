import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { CustomProvider } from '@/storage'
import { t } from '@/lib/i18n'
import { PROVIDER_PRESETS, protocolShortLabel, type PresetKey } from './shared'

export type ProviderTestStatus = 'ok' | 'fail' | undefined

export type ProviderListPaneProps = {
  providers: CustomProvider[]
  draftProvider: CustomProvider | null
  selectedId: string | null
  keyConfigured: Record<string, boolean>
  testStatus: Record<string, ProviderTestStatus>
  loading: boolean
  onSelect: (id: string) => void
  onAddPreset: (preset: PresetKey) => void
  onDelete: (provider: CustomProvider) => void
}

const PRESET_KEYS: Exclude<PresetKey, 'custom'>[] = ['openai', 'deepseek', 'glm', 'ollama', 'litellm']

const presetLabel = (key: Exclude<PresetKey, 'custom'>) => {
  const labels = { openai: 'presetOpenai', deepseek: 'presetDeepseek', glm: 'presetGlm', ollama: 'presetOllama', litellm: 'presetLitellm' } as const
  return t(labels[key])
}

function providerDisplayName(provider: CustomProvider) {
  return provider.name.trim() || t('newProviderFallback')
}

function providerInitial(provider: CustomProvider) {
  return providerDisplayName(provider).charAt(0).toUpperCase() || 'M'
}

function statusBadge(status: ProviderTestStatus) {
  if (status === 'ok') {
    return <span className="quickforge-settings-badge quickforge-settings-badge-success">{t('connectionOk')}</span>
  }
  if (status === 'fail') {
    return <span className="quickforge-settings-badge quickforge-settings-badge-warning">{t('connectionFailed')}</span>
  }
  return null
}

function ProviderRow(props: {
  provider: CustomProvider
  isDraft: boolean
  selected: boolean
  keyConfigured: boolean
  testStatus: ProviderTestStatus
  onSelect: () => void
  onDelete: () => void
}) {
  const { provider, isDraft, selected, keyConfigured, testStatus, onSelect, onDelete } = props
  const models = provider.models ?? []
  return (
    <div className={`quickforge-providers-row${selected ? ' quickforge-providers-row-active' : ''}`}>
      <button type="button" className="quickforge-providers-row-main" onClick={onSelect} aria-current={selected ? 'true' : undefined}>
        <span className="quickforge-settings-avatar" aria-hidden="true">{providerInitial(provider)}</span>
        <span className="quickforge-providers-row-copy">
          <span className="quickforge-providers-row-name">
            {providerDisplayName(provider)}
            {isDraft ? <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('providerDraftBadge')}</span> : null}
          </span>
          <span className="quickforge-providers-row-url">{provider.baseUrl}</span>
          <span className="quickforge-settings-meta quickforge-providers-row-meta">
            <span className="quickforge-settings-badge quickforge-settings-badge-muted">{protocolShortLabel(provider)}</span>
            {statusBadge(testStatus)}
            {keyConfigured ? null : <span className="quickforge-settings-badge quickforge-settings-badge-warning">{t('keyNotConfigured')}</span>}
            <span className="quickforge-providers-row-count">{t('modelsCount', { count: models.length })}</span>
          </span>
        </span>
      </button>
      <button
        className="quickforge-providers-row-delete"
        type="button"
        title={t('delete')}
        aria-label={t('confirmDeleteProvider', { name: providerDisplayName(provider) })}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

export function ProviderListPane(props: ProviderListPaneProps) {
  const { providers, draftProvider, selectedId, keyConfigured, testStatus, loading, onSelect, onAddPreset, onDelete } = props
  const [addOpen, setAddOpen] = useState(false)
  const addAnchorRef = useRef<HTMLDivElement>(null)

  // 点击弹层外任意处关闭（对齐 skills 页下拉的交互语义）；无 DOM 环境（单测）跳过。
  useEffect(() => {
    if (!addOpen || typeof document === 'undefined') return
    const onDocClick = (event: MouseEvent) => {
      if (!addAnchorRef.current?.contains(event.target as Node)) {
        setAddOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [addOpen])

  const pickPreset = (key: PresetKey) => {
    setAddOpen(false)
    onAddPreset(key)
  }

  const rows = [
    ...(draftProvider
      ? [{ provider: draftProvider, isDraft: true, id: 'draft' }]
      : []),
    ...providers.map((provider) => ({ provider, isDraft: false, id: provider.id })),
  ]

  return (
    <div className="quickforge-providers-list" aria-label={t('customModelsTitle')}>
      <div className="quickforge-providers-list-head">
        <div className="quickforge-providers-list-title">
          {t('providersListTitle')}
          <span className="quickforge-providers-list-count">{t('providersCount', { count: rows.length })}</span>
        </div>
        <div className="quickforge-providers-add-anchor" ref={addAnchorRef}>
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            aria-haspopup="menu"
            aria-expanded={addOpen ? 'true' : 'false'}
            onClick={() => setAddOpen(!addOpen)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('addProvider')}
          </button>
          {addOpen
            ? (
              <div className="quickforge-providers-popover" role="menu" aria-label={t('addProvider')}>
                <div className="quickforge-providers-popover-label">{t('presetGroupQuick')}</div>
                {PRESET_KEYS.map((key) => (
                  <button key={key} type="button" role="menuitem" className="quickforge-providers-popover-item" onClick={() => pickPreset(key)}>
                    <span className="quickforge-providers-popover-item-title">{presetLabel(key)}</span>
                    <span className="quickforge-providers-popover-item-sub">{PROVIDER_PRESETS[key].baseUrl}</span>
                  </button>
                ))}
                <div className="quickforge-providers-popover-label">{t('presetGroupCustom')}</div>
                <button type="button" role="menuitem" className="quickforge-providers-popover-item" onClick={() => pickPreset('custom')}>
                  <span className="quickforge-providers-popover-item-title">{t('presetManual')}</span>
                  <span className="quickforge-providers-popover-item-sub">{t('presetManualSub')}</span>
                </button>
              </div>
            )
            : null}
        </div>
      </div>
      <div className="quickforge-providers-rows">
        {loading
          ? <div className="quickforge-settings-empty-row">{t('loading')}</div>
          : rows.length === 0
            ? <div className="quickforge-settings-empty-row">{t('noProviders')}</div>
            : rows.map((row) => (
              <ProviderRow
                key={row.id}
                provider={row.provider}
                isDraft={row.isDraft}
                selected={selectedId === row.id}
                keyConfigured={row.isDraft ? false : keyConfigured[row.id] === true}
                testStatus={testStatus[row.id]}
                onSelect={() => onSelect(row.id)}
                onDelete={() => onDelete(row.provider)}
              />
            ))}
      </div>
    </div>
  )
}
