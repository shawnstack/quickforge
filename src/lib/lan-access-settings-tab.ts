import { SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'

function generateLanPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  return Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

type LanAccessStatus = {
  enabled: boolean
  hasPassword: boolean
  sessionTtlHours: number
  activeTokenCount?: number
  lanUrls?: string[]
}

class LanAccessSettingsTab extends SettingsTab {
  private loading = true
  private saving = false
  private enabled = false
  private hasPassword = false
  private password = ''
  private sessionTtlHours = 12
  private activeTokenCount = 0
  private lanUrls: string[] = []
  private error = ''
  private message = ''

  override getTabName(): string {
    return t('lanAccess')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadStatus()
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : undefined),
        ...init?.headers,
      },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
    return payload as T
  }

  private applyStatus(status: LanAccessStatus) {
    this.enabled = Boolean(status.enabled)
    this.hasPassword = Boolean(status.hasPassword)
    this.sessionTtlHours = Number(status.sessionTtlHours || 12)
    this.activeTokenCount = Number(status.activeTokenCount || 0)
    this.lanUrls = Array.isArray(status.lanUrls) ? status.lanUrls : []
  }

  private async loadStatus() {
    this.loading = true
    this.error = ''
    this.requestUpdate()
    try {
      this.applyStatus(await this.request<LanAccessStatus>('/api/lan-access/status'))
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private updatePassword(value: string) {
    this.password = value
    this.requestUpdate()
  }

  private updateEnabled(value: boolean) {
    this.enabled = value
    this.requestUpdate()
  }

  private updateTtl(value: string) {
    this.sessionTtlHours = Number(value) || 12
    this.requestUpdate()
  }

  private async saveSettings() {
    if (this.saving) return
    if (this.enabled && !this.hasPassword && !this.password.trim()) {
      this.error = t('lanAccessPasswordRequired')
      this.requestUpdate()
      return
    }
    if (this.password.trim() && this.password.trim().length < 8) {
      this.error = t('lanAccessPasswordTooShort')
      this.requestUpdate()
      return
    }
    if (this.enabled && !window.confirm(t('lanAccessEnableConfirm'))) return

    this.saving = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const status = await this.request<LanAccessStatus & { ok: boolean }>('/api/lan-access/settings', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: this.enabled,
          password: this.password.trim() || undefined,
          sessionTtlHours: this.sessionTtlHours,
        }),
      })
      this.applyStatus(status)
      this.password = ''
      this.message = t('lanAccessSaved')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  private async revokeAll() {
    if (!window.confirm(t('lanAccessRevokeAllConfirm'))) return
    this.saving = true
    this.error = ''
    this.message = ''
    this.requestUpdate()
    try {
      const status = await this.request<LanAccessStatus & { ok: boolean }>('/api/lan-access/revoke-all', { method: 'POST' })
      this.applyStatus(status)
      this.message = t('lanAccessRevoked')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.saving = false
      this.requestUpdate()
    }
  }

  override render(): TemplateResult {
    if (this.loading) return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('lanAccess')}</h3>
          <p class="text-sm text-muted-foreground">${t('lanAccessDescription')}</p>
        </div>

        <section class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          ${t('lanAccessRiskWarning')}
        </section>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('lanAccessStatus')}</h4>
          <dl class="mt-4 grid gap-3 text-sm">
            <div class="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
              <dt class="text-muted-foreground">${t('lanAccessEnabled')}</dt>
              <dd>${this.enabled ? t('enabled') : t('disabled')}</dd>
            </div>
            <div class="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
              <dt class="text-muted-foreground">${t('lanAccessPassword')}</dt>
              <dd>${this.hasPassword ? t('configured') : t('notConfigured')}</dd>
            </div>
            <div class="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
              <dt class="text-muted-foreground">${t('lanAccessActiveDevices')}</dt>
              <dd>${this.activeTokenCount}</dd>
            </div>
            <div class="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-3">
              <dt class="text-muted-foreground">${t('lanAccessUrls')}</dt>
              <dd class="min-w-0 break-all">${this.lanUrls.length ? this.lanUrls.map((url) => html`<div>${url}</div>`) : '-'}</dd>
            </div>
          </dl>
        </section>

        <section class="rounded-lg border border-border p-4">
          <label class="flex items-center gap-2 text-sm font-medium text-foreground">
            <input type="checkbox" .checked=${this.enabled} @change=${(event: Event) => this.updateEnabled((event.target as HTMLInputElement).checked)} />
            ${t('lanAccessAllowFull')}
          </label>

          <label class="mt-4 block text-sm font-medium text-foreground">
            ${t('lanAccessPassword')}
            <div class="mt-2 flex flex-col gap-3 sm:flex-row">
              <input class="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" type="password" .value=${this.password} @input=${(event: Event) => this.updatePassword((event.target as HTMLInputElement).value)} placeholder=${this.hasPassword ? t('lanAccessPasswordPlaceholderConfigured') : t('lanAccessPasswordPlaceholder')} />
              <button class="rounded-md border border-input px-3 py-2 text-sm" type="button" @click=${() => this.updatePassword(generateLanPassword())}>${t('generatePassword')}</button>
            </div>
          </label>

          <label class="mt-4 block text-sm font-medium text-foreground">
            ${t('lanAccessSessionTtl')}
            <select class="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" .value=${String(this.sessionTtlHours)} @change=${(event: Event) => this.updateTtl((event.target as HTMLSelectElement).value)}>
              <option value="1">1 ${t('hour')}</option>
              <option value="12">12 ${t('hours')}</option>
              <option value="24">24 ${t('hours')}</option>
              <option value="168">7 ${t('days')}</option>
            </select>
          </label>

          <div class="mt-4 flex flex-wrap gap-2">
            <button class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60" type="button" ?disabled=${this.saving} @click=${() => this.saveSettings()}>${this.saving ? t('saving') : t('save')}</button>
            <button class="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive disabled:opacity-60" type="button" ?disabled=${this.saving} @click=${() => this.revokeAll()}>${t('lanAccessRevokeAll')}</button>
          </div>
        </section>

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-lan-access-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, LanAccessSettingsTab)
}

export function createLanAccessSettingsTab() {
  return document.createElement(tagName) as LanAccessSettingsTab
}
