import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'

type AboutInfo = {
  name: string
  version: string
  repositoryUrl: string
  homepage?: string
  bugsUrl?: string
}

type UpdateInfo = AboutInfo & {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  localVersionIsNewer?: boolean
  installCommand: string
}

class AboutSettingsTab extends SettingsTab {
  private about?: AboutInfo
  private updateInfo?: UpdateInfo
  private loading = true
  private checking = false
  private updating = false
  private message = ''
  private error = ''

  override getTabName(): string {
    return t('about')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadAbout()
  }

  private async loadAbout() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch('/api/system/about', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      this.about = payload as AboutInfo
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private async checkUpdate() {
    if (this.checking || this.updating) return

    this.checking = true
    this.message = ''
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch('/api/system/update/check', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('updateCheckFailed'))
      this.updateInfo = payload as UpdateInfo
      this.about = payload as AboutInfo

      if (this.updateInfo.updateAvailable) {
        this.message = t('updateAvailableMessage', {
          current: this.updateInfo.currentVersion,
          latest: this.updateInfo.latestVersion,
        })
      } else if (this.updateInfo.localVersionIsNewer) {
        this.message = t('localVersionNewerMessage', {
          current: this.updateInfo.currentVersion,
          latest: this.updateInfo.latestVersion,
        })
      } else {
        this.message = t('alreadyLatestVersion', { version: this.updateInfo.currentVersion })
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('updateCheckFailed')
    } finally {
      this.checking = false
      this.requestUpdate()
    }
  }

  private async updateQuickForge() {
    if (!this.updateInfo?.updateAvailable || this.updating) return

    const confirmed = await showConfirm({
      description: t('updateConfirm', { command: this.updateInfo.installCommand }),
      confirmLabel: t('updateNow'),
      cancelLabel: t('cancel'),
    })
    if (!confirmed) return

    this.updating = true
    this.message = t('updatingQuickForge')
    this.error = ''
    this.requestUpdate()

    try {
      const response = await fetch('/api/system/update', {
        method: 'POST',
        headers: { 'x-quickforge-action': 'update' },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('updateFailed'))
      this.updateInfo = payload as UpdateInfo
      this.message = payload?.updated ? t('updateCompleted') : t('alreadyLatestVersion', { version: payload?.currentVersion || this.about?.version || '-' })
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('updateFailed')
      this.message = ''
    } finally {
      this.updating = false
      this.requestUpdate()
    }
  }

  private infoRows() {
    const about = this.about
    if (!about) return null

    const rows = [
      [t('packageName'), about.name],
      [t('currentVersion'), about.version],
    ]

    return html`
      <dl class="grid gap-3 text-sm">
        ${rows.map(([label, value]) => html`
          <div class="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
            <dt class="text-muted-foreground">${label}</dt>
            <dd class="min-w-0 break-all text-foreground">${value}</dd>
          </div>
        `)}
        <div class="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-3">
          <dt class="text-muted-foreground">${t('github')}</dt>
          <dd class="min-w-0 break-all">
            <a class="text-primary underline-offset-4 hover:underline" href=${about.repositoryUrl} target="_blank" rel="noreferrer">
              ${about.repositoryUrl}
            </a>
          </dd>
        </div>
      </dl>
    `
  }

  private updateStatus() {
    if (!this.updateInfo) return null

    return html`
      <div class="mt-4 rounded-lg border bg-transparent p-3 text-sm" style="border-color: color-mix(in oklab, var(--border) 36%, transparent);">
        <div class="grid gap-2 sm:grid-cols-[120px_1fr] sm:gap-3">
          <span class="text-muted-foreground">${t('latestVersion')}</span>
          <span class="text-foreground">${this.updateInfo.latestVersion}</span>
        </div>
        <div class="mt-2 grid gap-2 sm:grid-cols-[120px_1fr] sm:gap-3">
          <span class="text-muted-foreground">${t('updateCommand')}</span>
          <code class="min-w-0 break-all rounded bg-muted/20 px-1.5 py-0.5 font-mono text-xs text-foreground/90">${this.updateInfo.installCommand}</code>
        </div>
      </div>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    const updateDisabled = this.checking || this.updating || !this.updateInfo?.updateAvailable

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('aboutQuickForge')}</h3>
          <p class="text-sm text-muted-foreground">${t('aboutQuickForgeDescription')}</p>
        </div>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('projectInfo')}</h4>
          <div class="mt-4">${this.infoRows()}</div>
        </section>

        <section class="rounded-lg border border-border p-4">
          <h4 class="text-sm font-semibold text-foreground">${t('checkUpdate')}</h4>
          <p class="mt-1 text-sm text-muted-foreground">${t('checkUpdateDescription')}</p>
          ${this.updateStatus()}

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              class="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted/20 disabled:opacity-60"
              type="button"
              ?disabled=${this.checking || this.updating}
              @click=${() => this.checkUpdate()}
            >
              ${this.checking ? t('checkingUpdate') : t('checkUpdate')}
            </button>
            <button
              class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              type="button"
              ?disabled=${updateDisabled}
              @click=${() => this.updateQuickForge()}
            >
              ${this.updating ? t('updatingQuickForge') : t('updateNow')}
            </button>
          </div>
        </section>

        ${this.message ? html`<div class="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">${this.message}</div>` : null}
        ${this.error ? html`<div class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-about-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, AboutSettingsTab)
}

export function createAboutSettingsTab() {
  return document.createElement(tagName) as AboutSettingsTab
}
