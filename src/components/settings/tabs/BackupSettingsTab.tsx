import { useState } from 'react'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { broadcastProviderKeysChanged, clearProviderKeysCache } from '@/lib/provider-keys-cache'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSwitch } from './shared'

const BACKUP_FILE_PREFIX = 'quickforge-backup'

type BackupExportSection = 'settings' | 'mcp' | 'providerKeys' | 'customProviders' | 'scheduledTasks'
type BackupRestoreSection = BackupExportSection
type BackupRestoreMode = 'replace' | 'merge'
type BackupImportSummary = Record<string, number>

type BackupInspectResponse = {
  ok: boolean
  app?: string | null
  version?: number | null
  exportedAt?: string | null
  scope?: string | null
  includeSecrets?: boolean
  sections?: BackupImportSummary
  invalidSections?: Record<string, string>
  warnings?: string[]
  ignoredConversations?: boolean
  importToken?: string
  error?: string
}

type PendingBackupImport = {
  backup: unknown
  importToken?: string
  inspect: BackupInspectResponse
  selectedSections: Set<BackupRestoreSection>
  mode: BackupRestoreMode
}

type BackupImportResponse = {
  ok: boolean
  safetyBackupPath?: string
  summary?: BackupImportSummary
}

const dataSections: Array<{ id: BackupExportSection; countKey: keyof BackupImportSummary; label: () => string; description: () => string }> = [
  { id: 'settings', countKey: 'settings', label: () => t('restoreSettings'), description: () => t('restoreSettingsDescription') },
  { id: 'mcp', countKey: 'mcp', label: () => t('restoreMcp'), description: () => t('restoreMcpDescription') },
  { id: 'providerKeys', countKey: 'providerKeys', label: () => t('restoreProviderKeys'), description: () => t('restoreProviderKeysDescription') },
  { id: 'customProviders', countKey: 'customProviders', label: () => t('restoreCustomProviders'), description: () => t('restoreCustomProvidersDescription') },
  { id: 'scheduledTasks', countKey: 'scheduledTasks', label: () => t('restoreScheduledTasks'), description: () => t('restoreScheduledTasksDescription') },
]

const restoreSections = dataSections

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function formatSummary(summary?: BackupImportSummary) {
  if (!summary) return ''
  return Object.entries(summary)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
}

function availableRestoreSections(inspect: BackupInspectResponse) {
  return restoreSections.filter((section) => (inspect.sections?.[section.countKey] ?? 0) > 0)
}

function defaultRestoreSections(inspect: BackupInspectResponse) {
  return availableRestoreSections(inspect).map((section) => section.id)
}

function isStringTooLargeError(error: unknown) {
  return error instanceof RangeError || (error instanceof Error && error.message.includes('Invalid string length'))
}

function friendlyBackupError(error: unknown, fallback: string) {
  if (isStringTooLargeError(error)) return t('backupStringTooLarge')
  return error instanceof Error ? error.message : fallback
}

async function inspectBackupFile(file: File) {
  const response = await fetch('/api/backup/inspect-file', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: file,
  })
  const payload = await response.json().catch(() => null) as BackupInspectResponse | null
  if (!response.ok) throw new Error(payload?.error || t('backupInspectFailed'))
  if (!payload) throw new Error(t('backupInspectFailed'))
  return payload
}

export function BackupSettingsTab() {
  const [exportSections, setExportSections] = useState<Set<BackupExportSection>>(() => new Set(dataSections.map((section) => section.id)))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [safetyBackupPath, setSafetyBackupPath] = useState('')
  const [pendingImport, setPendingImport] = useState<PendingBackupImport | null>(null)

  const clearStatus = () => {
    setMessage('')
    setError('')
    setSafetyBackupPath('')
  }

  const toggleExportSection = (section: BackupExportSection, checked: boolean) => {
    setExportSections((current) => {
      const next = new Set(current)
      if (checked) next.add(section)
      else next.delete(section)
      return next
    })
    clearStatus()
  }

  const exportBackup = async () => {
    if (exportSections.size === 0) {
      setError(t('selectAtLeastOneExportSection'))
      return
    }

    setBusy(true)
    clearStatus()

    try {
      const query = new URLSearchParams({
        sections: [...exportSections].join(','),
      })
      const response = await fetch(`/api/backup/export?${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('backupExportFailed'))
      downloadJson(`${BACKUP_FILE_PREFIX}-settings-${timestampForFile()}.json`, payload)
      setMessage(t('backupExported'))
    } catch (err) {
      setError(friendlyBackupError(err, t('backupExportFailed')))
    } finally {
      setBusy(false)
    }
  }

  const importBackupFromFile = async (file: File) => {
    setBusy(true)
    clearStatus()
    setPendingImport(null)

    try {
      const inspect = await inspectBackupFile(file)
      const selectedSections = new Set(defaultRestoreSections(inspect))
      setPendingImport({ backup: null, importToken: inspect.importToken, inspect, selectedSections, mode: 'replace' })
      setMessage(inspect.ignoredConversations
        ? t('backupInspectedWithIgnoredConversations')
        : t('backupInspected'))
    } catch (err) {
      setError(friendlyBackupError(err, t('backupImportFailed')))
    } finally {
      setBusy(false)
    }
  }

  const togglePendingSection = (section: BackupRestoreSection, checked: boolean) => {
    setPendingImport((current) => {
      if (!current) return current
      const selectedSections = new Set(current.selectedSections)
      if (checked) selectedSections.add(section)
      else selectedSections.delete(section)
      return { ...current, selectedSections }
    })
    setMessage('')
    setError('')
  }

  const setRestoreMode = (mode: BackupRestoreMode) => {
    setPendingImport((current) => (current ? { ...current, mode } : current))
    setMessage('')
    setError('')
  }

  const cancelPendingImport = () => {
    setPendingImport(null)
    setMessage('')
    setError('')
  }

  const confirmPendingImport = async () => {
    if (!pendingImport) return
    if (pendingImport.selectedSections.size === 0) {
      setError(t('selectAtLeastOneRestoreSection'))
      return
    }

    const confirmed = await showConfirm({
      description: pendingImport.mode === 'replace'
        ? t('backupImportReplaceConfirm')
        : t('backupImportMergeConfirm'),
      confirmLabel: t('confirmImportSelected'),
      cancelLabel: t('cancel'),
      // Replace mode overwrites current settings: destructive keeps the focus
      // on cancel and blocks confirming via a stray Enter press.
      variant: pendingImport.mode === 'replace' ? 'destructive' : 'default',
    })
    if (!confirmed) return

    setBusy(true)
    clearStatus()

    try {
      const body = pendingImport.importToken
        ? {
            importToken: pendingImport.importToken,
            sections: [...pendingImport.selectedSections],
            mode: pendingImport.mode,
          }
        : {
            backup: pendingImport.backup,
            sections: [...pendingImport.selectedSections],
            mode: pendingImport.mode,
          }
      const response = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null) as BackupImportResponse & { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || t('backupImportFailed'))

      // 备份导入绕过 backend 直写服务端存储：统一失效 provider keys 内存缓存
      // 并广播其他标签（无论所选 sections 是否包含 providerKeys，统一失效成本最低）
      clearProviderKeysCache()
      broadcastProviderKeysChanged()

      const summary = formatSummary(payload?.summary)
      setSafetyBackupPath(payload?.safetyBackupPath || '')
      setPendingImport(null)
      setMessage(summary
        ? `${t('backupImported')} ${summary}`
        : t('backupImported'))
      window.setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      setError(friendlyBackupError(err, t('backupImportFailed')))
    } finally {
      setBusy(false)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (file) void importBackupFromFile(file)
  }

  const renderPendingImport = () => {
    if (!pendingImport) return null
    const { inspect, selectedSections } = pendingImport
    const sections = availableRestoreSections(inspect)

    return (
      <section className="quickforge-settings-section" aria-label={t('backupInspectTitle')}>
        <div className="quickforge-settings-row quickforge-settings-row-top">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('backupInspectTitle')}</div>
            <div className="quickforge-settings-row-description">{t('backupInspectDescription')}</div>
          </div>
        </div>

        <div className="quickforge-settings-nested-list">
          <div className="quickforge-settings-subrow">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">{t('backupInspectExportedAt')}</div>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{inspect.exportedAt || '-'}</div>
          </div>
          <div className="quickforge-settings-subrow">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">{t('backupInspectVersion')}</div>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{inspect.version ?? '-'}</div>
          </div>
          <div className="quickforge-settings-subrow">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">{t('backupInspectScope')}</div>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{inspect.scope || '-'}</div>
          </div>
          <div className="quickforge-settings-subrow">
            <div className="quickforge-settings-row-main">
              <div className="quickforge-settings-row-title">{t('backupInspectSecrets')}</div>
            </div>
            <div className="quickforge-settings-row-control quickforge-settings-readonly-value">{inspect.includeSecrets ? t('yes') : t('no')}</div>
          </div>
        </div>

        {inspect.warnings?.length ? (
          <div className="quickforge-settings-warning quickforge-settings-warning-attached">
            {inspect.warnings.map((warning) => <div key={warning}>⚠ {warning}</div>)}
          </div>
        ) : null}

        {inspect.invalidSections && Object.keys(inspect.invalidSections).length ? (
          <div className="quickforge-settings-warning quickforge-settings-warning-attached">
            <div>{t('backupInvalidSections')}</div>
            {Object.entries(inspect.invalidSections).map(([key, warning]) => <div key={key}>{key}: {warning}</div>)}
          </div>
        ) : null}

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('restoreMode')}</div>
            <div className="quickforge-settings-row-description">{t('restoreModeDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <div className="quickforge-settings-segmented" role="group" aria-label={t('restoreMode')}>
              <button
                type="button"
                className={`quickforge-settings-segmented-option${pendingImport.mode === 'replace' ? ' quickforge-settings-segmented-option-active' : ''}`}
                disabled={busy}
                onClick={() => setRestoreMode('replace')}
              >
                {t('restoreModeReplace')}
              </button>
              <button
                type="button"
                className={`quickforge-settings-segmented-option${pendingImport.mode === 'merge' ? ' quickforge-settings-segmented-option-active' : ''}`}
                disabled={busy}
                onClick={() => setRestoreMode('merge')}
              >
                {t('restoreModeMerge')}
              </button>
            </div>
          </div>
        </div>

        <div className="quickforge-settings-row quickforge-settings-row-top">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('selectRestoreSections')}</div>
            <div className="quickforge-settings-row-description">
              {pendingImport.mode === 'replace' ? t('restoreModeReplaceDescription') : t('restoreModeMergeDescription')}
            </div>
          </div>
        </div>
        <div className="quickforge-settings-nested-list">
          {sections.map((section) => (
            <div className="quickforge-settings-subrow" key={section.id}>
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{section.label()} ({inspect.sections?.[section.countKey] ?? 0})</div>
                <div className="quickforge-settings-row-description">{section.description()}</div>
              </div>
              <div className="quickforge-settings-row-control">
                <SettingsSwitch
                  checked={selectedSections.has(section.id)}
                  onChange={(checked) => togglePendingSection(section.id, checked)}
                  disabled={busy}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('backupImportActions')}</div>
            <div className="quickforge-settings-row-description">{t('backupImportActionsDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              disabled={busy || selectedSections.size === 0}
              onClick={() => void confirmPendingImport()}
            >
              {busy ? t('loading') : t('confirmImportSelected')}
            </button>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={busy}
              onClick={() => cancelPendingImport()}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('exportData')}>
        <div className="quickforge-settings-row quickforge-settings-row-top">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('selectExportSections')}
              <InfoTip label={t('exportDataDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('selectExportSectionsDescription')}</div>
          </div>
        </div>

        <div className="quickforge-settings-nested-list">
          {dataSections.map((section) => (
            <div className="quickforge-settings-subrow" key={section.id}>
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{section.label()}</div>
                <div className="quickforge-settings-row-description">{section.description()}</div>
              </div>
              <div className="quickforge-settings-row-control">
                <SettingsSwitch
                  checked={exportSections.has(section.id)}
                  onChange={(checked) => toggleExportSection(section.id, checked)}
                  disabled={busy}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('exportBackup')}</div>
            <div className="quickforge-settings-row-description">{t('exportBackupDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              disabled={busy || exportSections.size === 0}
              onClick={() => void exportBackup()}
            >
              {busy ? t('loading') : t('exportBackup')}
            </button>
          </div>
        </div>
      </section>

      <section className="quickforge-settings-section" aria-label={t('importData')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('importBackup')}
              <InfoTip label={t('importDataDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('importDataDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <label className={`quickforge-settings-button quickforge-settings-button-secondary${busy ? ' pointer-events-none opacity-60' : ''}`}>
              <input
                className="hidden"
                type="file"
                accept="application/json,.json"
                disabled={busy}
                onChange={handleFileChange}
              />
              {t('importBackup')}
            </label>
          </div>
        </div>
      </section>

      {renderPendingImport()}
      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {safetyBackupPath ? (
        <div className="quickforge-settings-note">{t('backupSafetyBackupPath')}: <code>{safetyBackupPath}</code></div>
      ) : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}
