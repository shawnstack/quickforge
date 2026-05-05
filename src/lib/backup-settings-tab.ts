import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'

const BACKUP_FILE_PREFIX = 'quickforge-backup'

type BackupScope = 'all' | 'config' | 'sessions'
type BackupImportSummary = Record<string, number>

type BackupImportResponse = {
  ok: boolean
  safetyBackupPath?: string
  summary?: BackupImportSummary
}

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

class BackupSettingsTab extends SettingsTab {
  private exportScope: BackupScope = 'all'
  private busy = false
  private message = ''
  private error = ''

  override getTabName(): string {
    return t('backupRestore')
  }

  private setScope(value: string) {
    this.exportScope = value === 'config' || value === 'sessions' ? value : 'all'
    this.message = ''
    this.error = ''
    this.requestUpdate()
  }

  private async exportBackup() {
    this.busy = true
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch(`/api/backup/export?scope=${encodeURIComponent(this.exportScope)}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('backupExportFailed'))
      downloadJson(`${BACKUP_FILE_PREFIX}-${this.exportScope}-${timestampForFile()}.json`, payload)
      this.message = t('backupExported')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('backupExportFailed')
    } finally {
      this.busy = false
      this.requestUpdate()
    }
  }

  private async importBackupFromFile(file: File) {
    this.busy = true
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const text = await file.text()
      const backup = JSON.parse(text) as unknown
      const confirmed = window.confirm(t('backupImportConfirm'))
      if (!confirmed) {
        this.busy = false
        this.requestUpdate()
        return
      }

      const response = await fetch('/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(backup),
      })
      const payload = await response.json().catch(() => null) as BackupImportResponse & { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || t('backupImportFailed'))

      const summary = formatSummary(payload?.summary)
      this.message = summary
        ? `${t('backupImported')} ${summary}`
        : t('backupImported')
      window.setTimeout(() => window.location.reload(), 500)
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

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
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
