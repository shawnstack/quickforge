import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { getDateLocale, t } from '@/lib/i18n'

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

class ServiceSettingsTab extends SettingsTab {
  private status?: ServiceStatus
  private loading = true
  private restarting = false
  private message = ''
  private error = ''

  override getTabName(): string {
    return t('backendService')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadStatus()
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
    if (!window.confirm(t('restartBackendConfirm'))) return

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
