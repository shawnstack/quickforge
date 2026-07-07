import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import './info-tip'

const BACKUP_FILE_PREFIX = 'quickforge-backup'

type BackupScope = 'all' | 'config' | 'sessions'
type BackupRestoreSection = 'settings' | 'mcp' | 'providerKeys' | 'customProviders' | 'projects' | 'scheduledTasks' | 'conversations'
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
  warnings?: string[]
  error?: string
}

type PendingBackupImport = {
  backup: unknown
  inspect: BackupInspectResponse
  selectedSections: Set<BackupRestoreSection>
  mode: BackupRestoreMode
}

type BackupImportResponse = {
  ok: boolean
  safetyBackupPath?: string
  summary?: BackupImportSummary
}

const restoreSections: Array<{ id: BackupRestoreSection; countKey: keyof BackupImportSummary; label: () => string; description: () => string }> = [
  { id: 'settings', countKey: 'settings', label: () => t('restoreSettings'), description: () => t('restoreSettingsDescription') },
  { id: 'mcp', countKey: 'mcp', label: () => t('restoreMcp'), description: () => t('restoreMcpDescription') },
  { id: 'providerKeys', countKey: 'providerKeys', label: () => t('restoreProviderKeys'), description: () => t('restoreProviderKeysDescription') },
  { id: 'customProviders', countKey: 'customProviders', label: () => t('restoreCustomProviders'), description: () => t('restoreCustomProvidersDescription') },
  { id: 'projects', countKey: 'projects', label: () => t('restoreProjects'), description: () => t('restoreProjectsDescription') },
  { id: 'scheduledTasks', countKey: 'scheduledTasks', label: () => t('restoreScheduledTasks'), description: () => t('restoreScheduledTasksDescription') },
  { id: 'conversations', countKey: 'sessions', label: () => t('restoreConversations'), description: () => t('restoreConversationsDescription') },
]

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

class BackupSettingsTab extends SettingsTab {
  private exportScope: BackupScope = 'all'
  private includeSecrets = false
  private busy = false
  private message = ''
  private error = ''
  private safetyBackupPath = ''
  private pendingImport: PendingBackupImport | null = null

  override getTabName(): string {
    return t('backupRestore')
  }

  private setScope(value: string) {
    this.exportScope = value === 'config' || value === 'sessions' ? value : 'all'
    if (this.exportScope === 'sessions') this.includeSecrets = false
    this.clearStatus()
    this.requestUpdate()
  }

  private clearStatus() {
    this.message = ''
    this.error = ''
    this.safetyBackupPath = ''
  }

  private setIncludeSecrets(checked: boolean) {
    this.includeSecrets = checked && this.exportScope !== 'sessions'
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private async exportBackup() {
    if (this.includeSecrets) {
      const confirmed = await showConfirm({
        description: t('backupExportSecretsConfirm'),
        confirmLabel: t('exportBackup'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }

    this.busy = true
    this.clearStatus()
    this.requestUpdate()

    try {
      const query = new URLSearchParams({
        scope: this.exportScope,
        includeSecrets: this.includeSecrets ? '1' : '0',
      })
      const response = await fetch(`/api/backup/export?${query.toString()}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('backupExportFailed'))
      const suffix = this.includeSecrets ? 'with-secrets' : 'no-secrets'
      downloadJson(`${BACKUP_FILE_PREFIX}-${this.exportScope}-${suffix}-${timestampForFile()}.json`, payload)
      this.message = t('backupExported')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('backupExportFailed')
    } finally {
      this.busy = false
      this.requestUpdate()
    }
  }

  private async inspectBackup(backup: unknown) {
    const response = await fetch('/api/backup/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(backup),
    })
    const payload = await response.json().catch(() => null) as BackupInspectResponse | null
    if (!response.ok) throw new Error(payload?.error || t('backupInspectFailed'))
    if (!payload) throw new Error(t('backupInspectFailed'))
    return payload
  }

  private async importBackupFromFile(file: File) {
    this.busy = true
    this.clearStatus()
    this.pendingImport = null
    this.requestUpdate()

    try {
      const text = await file.text()
      const backup = JSON.parse(text) as unknown
      const inspect = await this.inspectBackup(backup)
      const selectedSections = new Set(availableRestoreSections(inspect).map((section) => section.id))
      this.pendingImport = { backup, inspect, selectedSections, mode: 'replace' }
      this.message = t('backupInspected')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('backupImportFailed')
    } finally {
      this.busy = false
      this.requestUpdate()
    }
  }

  private togglePendingSection(section: BackupRestoreSection, checked: boolean) {
    if (!this.pendingImport) return
    if (checked) this.pendingImport.selectedSections.add(section)
    else this.pendingImport.selectedSections.delete(section)
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private setRestoreMode(mode: BackupRestoreMode) {
    if (!this.pendingImport) return
    this.pendingImport.mode = mode
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private cancelPendingImport() {
    this.pendingImport = null
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private async confirmPendingImport() {
    if (!this.pendingImport) return
    if (this.pendingImport.selectedSections.size === 0) {
      this.error = t('selectAtLeastOneRestoreSection')
      this.requestUpdate()
      return
    }

    this.busy = true
    this.clearStatus()
    this.requestUpdate()

    try {
      const response = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          backup: this.pendingImport.backup,
          sections: [...this.pendingImport.selectedSections],
          mode: this.pendingImport.mode,
        }),
      })
      const payload = await response.json().catch(() => null) as BackupImportResponse & { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || t('backupImportFailed'))

      const summary = formatSummary(payload?.summary)
      this.safetyBackupPath = payload?.safetyBackupPath || ''
      this.pendingImport = null
      this.message = summary
        ? `${t('backupImported')} ${summary}`
        : t('backupImported')
      window.setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('backupImportFailed')
    } finally {
      this.busy = false
      this.requestUpdate()
    }
  }

  private handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file) void this.importBackupFromFile(file)
  }

  private renderSwitch(checked: boolean, onChange: (checked: boolean) => void, disabled = false) {
    return html`
      <label class="quickforge-settings-switch" aria-disabled=${disabled ? 'true' : 'false'}>
        <input
          type="checkbox"
          .checked=${checked}
          ?disabled=${disabled}
          @change=${(event: Event) => onChange((event.target as HTMLInputElement).checked)}
        />
        <span aria-hidden="true"></span>
      </label>
    `
  }

  private renderPendingImport() {
    if (!this.pendingImport) return null
    const { inspect, selectedSections } = this.pendingImport
    const sections = availableRestoreSections(inspect)

    return html`
      <section class="quickforge-settings-section" aria-label=${t('backupInspectTitle')}>
        <div class="quickforge-settings-row quickforge-settings-row-top">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">${t('backupInspectTitle')}</div>
            <div class="quickforge-settings-row-description">${t('backupInspectDescription')}</div>
          </div>
        </div>

        <div class="quickforge-settings-nested-list">
          <div class="quickforge-settings-subrow">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('backupInspectExportedAt')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${inspect.exportedAt || '-'}</div>
          </div>
          <div class="quickforge-settings-subrow">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('backupInspectVersion')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${inspect.version ?? '-'}</div>
          </div>
          <div class="quickforge-settings-subrow">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('backupInspectScope')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${inspect.scope || '-'}</div>
          </div>
          <div class="quickforge-settings-subrow">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('backupInspectSecrets')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${inspect.includeSecrets ? t('yes') : t('no')}</div>
          </div>
        </div>

        ${inspect.warnings?.length ? html`
          <div class="quickforge-settings-warning quickforge-settings-warning-attached">
            ${inspect.warnings.map((warning) => html`<div>⚠ ${warning}</div>`)}
          </div>
        ` : null}

        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">${t('restoreMode')}</div>
            <div class="quickforge-settings-row-description">${t('restoreModeDescription')}</div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <div class="quickforge-settings-segmented" role="group" aria-label=${t('restoreMode')}>
              <button
                type="button"
                class="quickforge-settings-segmented-option ${this.pendingImport.mode === 'replace' ? 'quickforge-settings-segmented-option-active' : ''}"
                ?disabled=${this.busy}
                @click=${() => this.setRestoreMode('replace')}
              >
                ${t('restoreModeReplace')}
              </button>
              <button
                type="button"
                class="quickforge-settings-segmented-option ${this.pendingImport.mode === 'merge' ? 'quickforge-settings-segmented-option-active' : ''}"
                ?disabled=${this.busy}
                @click=${() => this.setRestoreMode('merge')}
              >
                ${t('restoreModeMerge')}
              </button>
            </div>
          </div>
        </div>

        <div class="quickforge-settings-row quickforge-settings-row-top">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">${t('selectRestoreSections')}</div>
            <div class="quickforge-settings-row-description">
              ${this.pendingImport.mode === 'replace' ? t('restoreModeReplaceDescription') : t('restoreModeMergeDescription')}
            </div>
          </div>
        </div>
        <div class="quickforge-settings-nested-list">
          ${sections.map((section) => html`
            <div class="quickforge-settings-subrow">
              <div class="quickforge-settings-row-main">
                <div class="quickforge-settings-row-title">${section.label()} (${inspect.sections?.[section.countKey] ?? 0})</div>
                <div class="quickforge-settings-row-description">${section.description()}</div>
              </div>
              <div class="quickforge-settings-row-control">
                ${this.renderSwitch(
                  selectedSections.has(section.id),
                  (checked) => this.togglePendingSection(section.id, checked),
                  this.busy,
                )}
              </div>
            </div>
          `)}
        </div>

        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">${t('backupImportActions')}</div>
            <div class="quickforge-settings-row-description">${t('backupImportActionsDescription')}</div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              class="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              ?disabled=${this.busy || selectedSections.size === 0}
              @click=${() => this.confirmPendingImport()}
            >
              ${this.busy ? t('loading') : t('confirmImportSelected')}
            </button>
            <button
              class="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              ?disabled=${this.busy}
              @click=${() => this.cancelPendingImport()}
            >
              ${t('cancel')}
            </button>
          </div>
        </div>
      </section>
    `
  }

  override render(): TemplateResult {
    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('exportData')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('exportScope')}
                <quickforge-info-tip .label=${t('exportDataDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('exportScopeDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <select
                class="quickforge-settings-select"
                .value=${this.exportScope}
                ?disabled=${this.busy}
                @change=${(event: Event) => this.setScope((event.target as HTMLSelectElement).value)}
              >
                <option value="all">${t('exportScopeAll')}</option>
                <option value="config">${t('exportScopeConfig')}</option>
                <option value="sessions">${t('exportScopeSessions')}</option>
              </select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main ${this.exportScope === 'sessions' ? 'opacity-60' : ''}">
              <div class="quickforge-settings-row-title">${t('includeApiKeys')}</div>
              <div class="quickforge-settings-row-description">${t('includeApiKeysDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.includeSecrets, (checked) => this.setIncludeSecrets(checked), this.busy || this.exportScope === 'sessions')}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('exportBackup')}</div>
              <div class="quickforge-settings-row-description">${t('exportBackupDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <button
                class="quickforge-settings-button quickforge-settings-button-primary"
                type="button"
                ?disabled=${this.busy}
                @click=${() => this.exportBackup()}
              >
                ${this.busy ? t('loading') : t('exportBackup')}
              </button>
            </div>
          </div>
        </section>

        <section class="quickforge-settings-section" aria-label=${t('importData')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('importBackup')}
                <quickforge-info-tip .label=${t('importDataDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('importDataDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <label class="quickforge-settings-button quickforge-settings-button-secondary ${this.busy ? 'pointer-events-none opacity-60' : ''}">
                <input
                  class="hidden"
                  type="file"
                  accept="application/json,.json"
                  ?disabled=${this.busy}
                  @change=${(event: Event) => this.handleFileChange(event)}
                />
                ${t('importBackup')}
              </label>
            </div>
          </div>
        </section>

        ${this.renderPendingImport()}
        ${this.message ? html`<div class="quickforge-settings-message">${this.message}</div>` : null}
        ${this.safetyBackupPath ? html`<div class="quickforge-settings-note">${t('backupSafetyBackupPath')}: <code>${this.safetyBackupPath}</code></div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-backup-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, BackupSettingsTab)
}

export function createBackupSettingsTab() {
  return document.createElement(tagName) as BackupSettingsTab
}
