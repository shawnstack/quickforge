import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { getDateLocale, t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'

type ServiceStatus = {
  ok: boolean
  mode: string
  pid: number
  bootId: string
  startedAt: string
  restartSupported: boolean
  restartUnsupportedReason?: string | null
  dataDir: string
  workspaceRoot: string
}

type TerminalShellProfile = {
  id: string
  name: string
  command: string
  builtin: boolean
  detected?: boolean
}

type TerminalShellConfig = {
  terminalShell: string
  defaultProfileId: string
  profiles: TerminalShellProfile[]
}

const RESTART_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 800

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatDate(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(getDateLocale())
}

function customProfileId() {
  return `custom_${globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36)}`
}

function profileNameFromCommand(command: string) {
  const normalized = command.trim()
  const executable = normalized.split(/[\\/]/).pop()?.replace(/^"|"$/g, '') || normalized
  if (/^bash(\.exe)?$/i.test(executable)) return 'Bash'
  if (/^zsh$/i.test(executable)) return 'Zsh'
  if (/^fish$/i.test(executable)) return 'Fish'
  if (/^cmd(\.exe)?$/i.test(executable)) return 'Command Prompt'
  if (/^powershell(\.exe)?$/i.test(executable)) return 'Windows PowerShell'
  if (/^pwsh(\.exe)?$/i.test(executable)) return 'PowerShell 7+'
  return executable || 'Custom Shell'
}

const checkIcon = html`
  <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.2 6.6 11.3 12.7 4.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`

const circleIcon = html`
  <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="4.8" stroke="currentColor" stroke-width="1.5" />
  </svg>
`

const deleteIcon = html`
  <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  </svg>
`

class ServiceSettingsTab extends SettingsTab {
  private status?: ServiceStatus
  private loading = true
  private restarting = false
  private message = ''
  private error = ''
  private terminalShellConfig: TerminalShellConfig = { terminalShell: 'auto', defaultProfileId: 'auto', profiles: [] }
  private customShellCommand = ''

  override getTabName(): string {
    return t('backendService')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await Promise.all([this.loadStatus(), this.loadTerminalShell()])
  }

  private customShellProfiles() {
    return this.terminalShellConfig.profiles.filter((profile) => !profile.builtin)
  }

  private async loadTerminalShell() {
    try {
      const response = await fetch('/api/system/terminal-shell', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.terminalShellConfig = {
        terminalShell: payload?.terminalShell || 'auto',
        defaultProfileId: payload?.defaultProfileId || 'auto',
        profiles: Array.isArray(payload?.profiles) ? payload.profiles : [],
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.requestUpdate()
    }
  }

  private async saveTerminalShellConfig(defaultProfileId: string, customProfiles = this.customShellProfiles(), message = t('terminalShellSaved')) {
    try {
      const response = await fetch('/api/system/terminal-shell', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultProfileId, profiles: customProfiles }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.terminalShellConfig = payload as TerminalShellConfig
      this.message = message
      this.error = ''
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.requestUpdate()
    }
  }

  private async addCustomTerminalShell() {
    const command = this.customShellCommand.trim()
    if (!command) {
      this.error = t('terminalShellProfileRequired')
      this.requestUpdate()
      return
    }

    const profiles = [
      ...this.customShellProfiles(),
      { id: customProfileId(), name: profileNameFromCommand(command), command, builtin: false },
    ]
    this.customShellCommand = ''
    await this.saveTerminalShellConfig(this.terminalShellConfig.defaultProfileId, profiles, t('terminalShellProfilesSaved'))
  }

  private async deleteCustomTerminalShell(profileId: string) {
    const profile = this.terminalShellConfig.profiles.find((item) => item.id === profileId)
    if (!profile || profile.builtin) return
    const confirmed = await showConfirm({
      description: t('terminalShellDeleteConfirm', { name: profile.name }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const profiles = this.customShellProfiles().filter((item) => item.id !== profileId)
    const defaultProfileId = this.terminalShellConfig.defaultProfileId === profileId ? 'auto' : this.terminalShellConfig.defaultProfileId
    await this.saveTerminalShellConfig(defaultProfileId, profiles, t('terminalShellProfilesSaved'))
  }

  private async loadStatus() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.status = payload as ServiceStatus
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private async pollUntilRestarted(previousBootId?: string) {
    const started = Date.now()

    while (Date.now() - started < RESTART_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      try {
        const response = await fetch(`/api/health?restartPoll=${Date.now()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null) as ServiceStatus | null
        if (response.ok && payload?.ok && payload.bootId && payload.bootId !== previousBootId) {
          this.message = t('backendRestarted')
          this.requestUpdate()
          window.setTimeout(() => window.location.reload(), 300)
          return
        }
      } catch {
        // Expected while the local service is restarting.
      }
    }

    throw new Error(t('backendRestartTimeout'))
  }

  private async restartService() {
    if (!this.status || this.restarting) return
    const confirmed = await showConfirm({
      description: t('restartBackendConfirm'),
      confirmLabel: t('restartBackendService'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed) return

    this.restarting = true
    this.message = t('backendRestarting')
    this.error = ''
    this.requestUpdate()

    const previousBootId = this.status.bootId

    try {
      const response = await fetch('/api/system/restart', {
        method: 'POST',
        headers: { 'x-quickforge-action': 'restart' },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('backendRestartFailed'))
      await this.pollUntilRestarted(previousBootId)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('backendRestartFailed')
      this.message = ''
      this.restarting = false
      this.requestUpdate()
    }
  }

  private statusRows() {
    if (!this.status) return null
    const rows = [
      [t('serviceMode'), this.status.mode],
      [t('servicePid'), String(this.status.pid)],
      [t('serviceStartedAt'), formatDate(this.status.startedAt)],
      [t('serviceDataDir'), this.status.dataDir],
      [t('serviceWorkspace'), this.status.workspaceRoot],
    ]

    return html`
      <dl class="grid gap-3 text-sm">
        ${rows.map(([label, value]) => html`
          <div class="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
            <dt class="text-muted-foreground">${label}</dt>
            <dd class="min-w-0 break-all text-foreground">${value}</dd>
          </div>
        `)}
      </dl>
    `
  }

  private shellProfileRow(profile: TerminalShellProfile, isFirstDetected = false) {
    const isDefault = profile.id === this.terminalShellConfig.defaultProfileId
      || (this.terminalShellConfig.defaultProfileId === 'auto' && isFirstDetected)

    return html`
      <div class="flex min-w-0 items-center gap-3 border-b px-1.5 py-2 last:border-b-0 hover:bg-muted/5" style="border-bottom-color: color-mix(in oklab, var(--border) 32%, transparent);">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-foreground/90">${profile.name}</div>
          <div class="truncate font-mono text-xs text-muted-foreground/55" title=${profile.command}>${profile.command}</div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          ${isDefault
            ? html`
              <span class="inline-flex size-7 items-center justify-center rounded-md text-emerald-500/85" title=${t('terminalShellDefaultBadge')} aria-label=${t('terminalShellDefaultBadge')}>
                ${checkIcon}
              </span>
            `
            : html`
              <button
                class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-muted/20 hover:text-foreground/85"
                type="button"
                title=${t('terminalShellSetDefault')}
                aria-label=${t('terminalShellSetDefault')}
                @click=${() => this.saveTerminalShellConfig(profile.id)}
              >
                ${circleIcon}
              </button>
            `}
          ${!profile.builtin
            ? html`
              <button
                class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/55 hover:bg-destructive/10 hover:text-destructive"
                type="button"
                title=${t('delete')}
                aria-label=${t('delete')}
                @click=${() => this.deleteCustomTerminalShell(profile.id)}
              >
                ${deleteIcon}
              </button>
            `
            : null}
        </div>
      </div>
    `
  }

  private terminalShellSettings() {
    const profiles = this.terminalShellConfig.profiles

    return html`
      <section class="rounded-lg border border-border p-4">
        <div>
          <h4 class="text-sm font-semibold text-foreground">${t('terminalShell')}</h4>
          <p class="mt-1 max-w-2xl text-sm text-muted-foreground">${t('terminalShellDescription')}</p>
          <p class="mt-1 text-xs text-muted-foreground/60">${t('terminalShellAutoDetectedHint')}</p>
        </div>

        <div class="mt-4 overflow-hidden rounded-lg border bg-transparent" style="border-color: color-mix(in oklab, var(--border) 36%, transparent);">
          ${profiles.length > 0
            ? profiles.map((profile, index) => this.shellProfileRow(profile, index === 0))
            : html`<div class="px-2 py-3 text-sm text-muted-foreground">${t('terminalShellNoDetected')}</div>`}
        </div>

        <div class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label class="grid gap-1 text-sm">
            <span class="text-xs text-muted-foreground/70">${t('terminalShellCommand')}</span>
            <input
              class="h-9 rounded-md border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus:border-ring"
              type="text"
              .value=${this.customShellCommand}
              placeholder=${t('terminalShellCommandPlaceholder')}
              @input=${(event: Event) => {
                this.customShellCommand = (event.target as HTMLInputElement).value
              }}
            />
          </label>
          <button
            class="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            type="button"
            title=${t('terminalShellAdd')}
            aria-label=${t('terminalShellAdd')}
            @click=${() => this.addCustomTerminalShell()}
          >
            ${t('terminalShellAdd')}
          </button>
        </div>
      </section>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    const unsupportedReason = this.status?.restartUnsupportedReason || t('backendRestartUnsupported')
    const restartDisabled = this.restarting || !this.status?.restartSupported

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('backendService')}</h3>
          <p class="text-sm text-muted-foreground">${t('backendServiceDescription')}</p>
        </div>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('backendServiceStatus')}</h4>
          <div class="mt-4">${this.statusRows()}</div>
        </section>

        ${this.terminalShellSettings()}

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('restartBackendService')}</h4>
          <p class="mt-1 text-sm text-muted-foreground">${t('restartBackendServiceDescription')}</p>

          ${!this.status?.restartSupported
            ? html`<div class="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">${unsupportedReason}</div>`
            : null}

          <button
            class="mt-4 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-60"
            type="button"
            ?disabled=${restartDisabled}
            @click=${() => this.restartService()}
          >
            ${this.restarting ? t('backendRestarting') : t('restartBackendService')}
          </button>
        </section>

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-service-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, ServiceSettingsTab)
}

export function createServiceSettingsTab() {
  return document.createElement(tagName) as ServiceSettingsTab
}
