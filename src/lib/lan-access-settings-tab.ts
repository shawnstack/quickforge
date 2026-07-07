import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import './info-tip'

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
    if (this.enabled) {
      const confirmed = await showConfirm({
        description: t('lanAccessEnableConfirm'),
        confirmLabel: t('enabled'),
        cancelLabel: t('cancel'),
      })
      if (!confirmed) return
    }

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
    const confirmed = await showConfirm({
      description: t('lanAccessRevokeAllConfirm'),
      confirmLabel: t('lanAccessRevokeAll'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
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

  override render(): TemplateResult {
    if (this.loading) return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`

    return html`
      <div class="quickforge-settings-stack">
        <div class="quickforge-settings-warning">${t('lanAccessRiskWarning')}</div>

        <section class="quickforge-settings-section" aria-label=${t('lanAccessStatus')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessEnabled')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessEnabledDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${this.enabled ? t('enabled') : t('disabled')}</div>
          </div>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessPassword')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessPasswordStatusDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${this.hasPassword ? t('configured') : t('notConfigured')}</div>
          </div>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessActiveDevices')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessActiveDevicesDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${this.activeTokenCount}</div>
          </div>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessUrls')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessUrlsDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
              ${this.lanUrls.length ? this.lanUrls.map((url) => html`<div>${url}</div>`) : '-'}
            </div>
          </div>
        </section>

        <section class="quickforge-settings-section" aria-label=${t('lanAccess')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessAllowFull')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessAllowFullDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.enabled, (checked) => this.updateEnabled(checked), this.saving)}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessPassword')}</div>
              <div class="quickforge-settings-row-description">${this.hasPassword ? t('lanAccessPasswordPlaceholderConfigured') : t('lanAccessPasswordPlaceholder')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-lan-password-control">
              <input
                class="quickforge-settings-input"
                type="password"
                .value=${this.password}
                @input=${(event: Event) => this.updatePassword((event.target as HTMLInputElement).value)}
                placeholder=${this.hasPassword ? t('lanAccessPasswordPlaceholderConfigured') : t('lanAccessPasswordPlaceholder')}
              />
              <button
                class="quickforge-settings-button quickforge-settings-button-secondary"
                type="button"
                @click=${() => this.updatePassword(generateLanPassword())}
              >
                ${t('generatePassword')}
              </button>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessSessionTtl')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessSessionTtlDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <select class="quickforge-settings-select" .value=${String(this.sessionTtlHours)} @change=${(event: Event) => this.updateTtl((event.target as HTMLSelectElement).value)}>
                <option value="1">1 ${t('hour')}</option>
                <option value="12">12 ${t('hours')}</option>
                <option value="24">24 ${t('hours')}</option>
                <option value="168">7 ${t('days')}</option>
              </select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('lanAccessActions')}</div>
              <div class="quickforge-settings-row-description">${t('lanAccessActionsDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <button class="quickforge-settings-button quickforge-settings-button-primary" type="button" ?disabled=${this.saving} @click=${() => this.saveSettings()}>
                ${this.saving ? t('saving') : t('save')}
              </button>
              <button class="quickforge-settings-button quickforge-settings-button-danger" type="button" ?disabled=${this.saving} @click=${() => this.revokeAll()}>
                ${t('lanAccessRevokeAll')}
              </button>
            </div>
          </div>
        </section>

        ${this.message ? html`<div class="quickforge-settings-message">${this.message}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
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
