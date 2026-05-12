import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'

const BACKUP_FILE_PREFIX = 'quickforge-backup'

type BackupScope = 'all' | 'config' | 'sessions'
type BackupRestoreSection = 'settings' | 'providerKeys' | 'customProviders' | 'projects' | 'scheduledTasks' | 'conversations'
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
}

type BackupImportResponse = {
  ok: boolean
  safetyBackupPath?: string
  summary?: BackupImportSummary
}

const restoreSections: Array<{ id: BackupRestoreSection; countKey: keyof BackupImportSummary; label: () => string; description: () => string }> = [
  { id: 'settings', countKey: 'settings', label: () => t('restoreSettings'), description: () => t('restoreSettingsDescription') },
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
    if (this.includeSecrets && !window.confirm(t('backupExportSecretsConfirm'))) return

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
      this.pendingImport = { backup, inspect, selectedSections }
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

  private renderPendingImport() {
    if (!this.pendingImport) return null
    const { inspect, selectedSections } = this.pendingImport
    const sections = availableRestoreSections(inspect)

    return html`
      <section class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <h4 class="text-sm font-semibold text-foreground">${t('backupInspectTitle')}</h4>
        <dl class="mt-3 grid gap-1 text-sm text-muted-foreground">
          <div><span class="text-foreground">${t('backupInspectExportedAt')}:</span> ${inspect.exportedAt || '-'}</div>
          <div><span class="text-foreground">${t('backupInspectVersion')}:</span> ${inspect.version ?? '-'}</div>
          <div><span class="text-foreground">${t('backupInspectScope')}:</span> ${inspect.scope || '-'}</div>
          <div><span class="text-foreground">${t('backupInspectSecrets')}:</span> ${inspect.includeSecrets ? t('yes') : t('no')}</div>
        </dl>

        ${inspect.warnings?.length ? html`
          <div class="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            ${inspect.warnings.map((warning) => html`<div>⚠ ${warning}</div>`)}
          </div>
        ` : null}

        <div class="mt-4">
          <div class="text-sm font-medium text-foreground">${t('selectRestoreSections')}</div>
          <div class="mt-2 grid gap-2">
            ${sections.map((section) => html`
              <label class="flex items-start gap-2 rounded-md border border-border bg-background/60 p-3 text-sm">
                <input
                  class="mt-1"
                  type="checkbox"
                  .checked=${selectedSections.has(section.id)}
                  ?disabled=${this.busy}
                  @change=${(event: Event) => this.togglePendingSection(section.id, (event.target as HTMLInputElement).checked)}
                />
                <span>
                  <span class="block text-foreground">${section.label()} (${inspect.sections?.[section.countKey] ?? 0})</span>
                  <span class="block text-xs text-muted-foreground">${section.description()}</span>
                </span>
              </label>
            `)}
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
            type="button"
            ?disabled=${this.busy || selectedSections.size === 0}
            @click=${() => this.confirmPendingImport()}
          >
            ${this.busy ? t('loading') : t('confirmImportSelected')}
          </button>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/60 disabled:opacity-60"
            type="button"
            ?disabled=${this.busy}
            @click=${() => this.cancelPendingImport()}
          >
            ${t('cancel')}
          </button>
        </div>
      </section>
    `
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('backupRestore')}</h3>
          <p class="text-sm text-muted-foreground">${t('backupRestoreDescription')}</p>
        </div>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('exportData')}</h4>
          <p class="mt-1 text-sm text-muted-foreground">${t('exportDataDescription')}</p>

          <label class="mt-4 grid max-w-sm gap-1.5 text-sm">
            <span class="text-foreground">${t('exportScope')}</span>
            <select
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.exportScope}
              ?disabled=${this.busy}
              @change=${(event: Event) => this.setScope((event.target as HTMLSelectElement).value)}
            >
              <option value="all">${t('exportScopeAll')}</option>
              <option value="config">${t('exportScopeConfig')}</option>
              <option value="sessions">${t('exportScopeSessions')}</option>
            </select>
          </label>

          <label class="mt-4 flex max-w-sm items-start gap-2 text-sm text-foreground ${this.exportScope === 'sessions' ? 'opacity-60' : ''}">
            <input
              class="mt-1"
              type="checkbox"
              .checked=${this.includeSecrets}
              ?disabled=${this.busy || this.exportScope === 'sessions'}
              @change=${(event: Event) => this.setIncludeSecrets((event.target as HTMLInputElement).checked)}
            />
            <span>
              <span class="block">${t('includeApiKeys')}</span>
              <span class="block text-xs text-muted-foreground">${t('includeApiKeysDescription')}</span>
            </span>
          </label>

          <button
            class="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
            type="button"
            ?disabled=${this.busy}
            @click=${() => this.exportBackup()}
          >
            ${this.busy ? t('loading') : t('exportBackup')}
          </button>
        </section>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('importData')}</h4>
          <p class="mt-1 text-sm text-muted-foreground">${t('importDataDescription')}</p>

          <label class="mt-4 inline-flex cursor-pointer rounded-md border border-input px-3 py-2 text-sm hover:bg-muted/60 ${this.busy ? 'pointer-events-none opacity-60' : ''}">
            <input
              class="hidden"
              type="file"
              accept="application/json,.json"
              ?disabled=${this.busy}
              @change=${(event: Event) => this.handleFileChange(event)}
            />
            ${t('importBackup')}
          </label>
        </section>

        ${this.renderPendingImport()}
        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.safetyBackupPath ? html`<div class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">${t('backupSafetyBackupPath')}: <code>${this.safetyBackupPath}</code></div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
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
