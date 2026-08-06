import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { getDateLocale, t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import {
  DEFAULT_UPDATE_CHECK_SETTINGS,
  loadUpdateCheckSettings,
  saveUpdateCheckSettings,
  type UpdateCheckFrequency,
} from '@/lib/update-check-settings'
import './info-tip'

type AboutInfo = {
  name: string
  version: string
  repositoryUrl: string
  homepage?: string
  bugsUrl?: string
}

type UpdateInfo = AboutInfo & {
  channel?: 'npm-runtime'
  distribution?: 'npm'
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  localVersionIsNewer?: boolean
  installCommand: string
  releaseUrl?: string
  updateStarted?: boolean
  updaterPid?: number
  logFile?: string
  bootId?: string
}

type ServiceStatus = {
  ok: boolean
  bootId: string
  restartSupported?: boolean
  restartUnsupportedReason?: string | null
  isLocalRequest?: boolean
}

const UPDATE_TIMEOUT_MS = 180_000
const RESTART_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 1000
const QUICKFORGE_RELEASES_URL = 'https://github.com/shawnstack/quickforge/releases/latest'

function isDesktopApp() {
  if (typeof document === 'undefined') return false
  const desktopWindow = window as Window & { __quickforgeDesktopApp?: boolean }
  return document.body.classList.contains('quickforge-desktop-app') || desktopWindow.__quickforgeDesktopApp === true
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

const FREQUENCY_OPTIONS: { value: UpdateCheckFrequency; label: () => string }[] = [
  { value: 'startup', label: () => t('frequencyStartup') },
  { value: 'daily', label: () => t('frequencyDaily') },
  { value: 'weekly', label: () => t('frequencyWeekly') },
  { value: 'off', label: () => t('frequencyOff') },
]

class AboutSettingsTab extends SettingsTab {
  private about?: AboutInfo
  private updateInfo?: UpdateInfo
  private loading = true
  private checking = false
  private updating = false
  private restarting = false
  private message = ''
  private error = ''
  private frequency: UpdateCheckFrequency = DEFAULT_UPDATE_CHECK_SETTINGS.frequency
  private lastCheckAt: string | null = null
  private serviceStatus?: ServiceStatus

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
      try {
        const [settings, serviceStatus] = await Promise.all([
          loadUpdateCheckSettings(getAppStorage()),
          this.loadServiceStatus(),
        ])
        this.frequency = settings.frequency
        this.lastCheckAt = settings.lastCheckAt
        this.serviceStatus = serviceStatus
      } catch {
        // ignore — defaults are fine
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private async loadServiceStatus() {
    const response = await fetch('/api/health', { cache: 'no-store' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
    return payload as ServiceStatus
  }

  private async checkUpdate() {
    if (this.checking || this.updating) return

    if (isDesktopApp()) {
      window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
      this.message = t('desktopUpdateHint')
      this.error = ''
      this.requestUpdate()
      return
    }

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

  private async pollUntilUpdated(previousBootId?: string) {
    const started = Date.now()

    while (Date.now() - started < UPDATE_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS)
      try {
        const response = await fetch(`/api/health?updatePoll=${Date.now()}`, { cache: 'no-store' })
        const payload = await response.json().catch(() => null) as ServiceStatus | null
        if (response.ok && payload?.ok && payload.bootId && payload.bootId !== previousBootId) {
          this.message = t('updateRestarted')
          this.requestUpdate()
          window.setTimeout(() => window.location.reload(), 300)
          return
        }
      } catch {
        // Expected while the local service is updating and restarting.
      }
    }

    throw new Error(t('updateRestartTimeout'))
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
    if (!this.serviceStatus || this.restarting) return
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

    const previousBootId = this.serviceStatus.bootId

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

  private async updateQuickForge() {
    if (isDesktopApp()) {
      window.open(QUICKFORGE_RELEASES_URL, '_blank', 'noopener,noreferrer')
      this.message = t('desktopUpdateHint')
      this.error = ''
      this.requestUpdate()
      return
    }

    if (!this.updateInfo?.updateAvailable || this.updating) return

    const confirmed = await showConfirm({
      description: t('updateConfirm', { command: this.updateInfo.installCommand }),
      confirmLabel: t('updateRuntimeNow'),
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
      if (payload?.updateStarted) {
        const logHint = payload.logFile ? ` ${t('updateLogFile', { path: payload.logFile })}` : ''
        this.message = `${t('updateStarted')}${logHint}`
        this.requestUpdate()
        await this.pollUntilUpdated(payload.bootId)
      } else {
        this.message = payload?.updated ? t('updateCompleted') : t('alreadyLatestVersion', { version: payload?.currentVersion || this.about?.version || '-' })
        this.updating = false
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('updateFailed')
      this.message = ''
      this.updating = false
    } finally {
      this.requestUpdate()
    }
  }

  private async selectFrequency(frequency: UpdateCheckFrequency) {
    if (this.frequency === frequency) return
    this.frequency = frequency
    this.requestUpdate()
    try {
      const storage = getAppStorage()
      const settings = await loadUpdateCheckSettings(storage)
      await saveUpdateCheckSettings(storage, { ...settings, frequency })
      this.error = ''
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.requestUpdate()
    }
  }

  private renderFrequencyOption(option: { value: UpdateCheckFrequency; label: () => string }) {
    const selected = this.frequency === option.value
    return html`
      <button
        type="button"
        class="quickforge-settings-segmented-option ${selected ? 'quickforge-settings-segmented-option-active' : ''}"
        aria-pressed=${selected ? 'true' : 'false'}
        @click=${() => this.selectFrequency(option.value)}
      >
        ${option.label()}
      </button>
    `
  }

  private infoRows() {
    const about = this.about
    if (!about) return null

    return html`
      <div class="quickforge-settings-row">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">${t('packageName')}</div>
          <div class="quickforge-settings-row-description">${t('packageNameDescription')}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${about.name}</div>
      </div>
      <div class="quickforge-settings-row">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">${t('currentVersion')}</div>
          <div class="quickforge-settings-row-description">${t('currentVersionDescription')}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${about.version}</div>
      </div>
      <div class="quickforge-settings-row">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">${t('github')}</div>
          <div class="quickforge-settings-row-description">${t('githubDescription')}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
          <a class="quickforge-settings-link" href=${about.repositoryUrl} target="_blank" rel="noreferrer">
            ${about.repositoryUrl}
          </a>
        </div>
      </div>
    `
  }

  private updateStatus() {
    if (!this.updateInfo) return null

    return html`
      <div class="quickforge-settings-row">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">${t('latestVersion')}</div>
          <div class="quickforge-settings-row-description">${t('latestVersionDescription')}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-readonly-value">${this.updateInfo.latestVersion}</div>
      </div>
      ${this.updateInfo.logFile ? html`
        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">${t('updateLog')}</div>
            <div class="quickforge-settings-row-description">${t('updateLogDescription')}</div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
            <code>${this.updateInfo.logFile}</code>
          </div>
        </div>
      ` : null}
    `
  }

  private restartSection() {
    const unsupportedReason = this.serviceStatus?.restartUnsupportedReason || t('backendRestartUnsupported')
    const restartDisabled = this.restarting || !this.serviceStatus?.restartSupported

    return html`
      <section class="quickforge-settings-section" aria-label=${t('restartBackendService')}>
        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">
              ${t('restartBackendService')}
              <quickforge-info-tip .label=${t('restartBackendServiceDescription')}></quickforge-info-tip>
            </div>
            <div class="quickforge-settings-row-description">
              ${this.serviceStatus?.restartSupported ? t('restartBackendServiceDescription') : unsupportedReason}
            </div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              class="quickforge-settings-button quickforge-settings-button-danger"
              type="button"
              ?disabled=${restartDisabled}
              @click=${() => this.restartService()}
            >
              ${this.restarting ? t('backendRestarting') : t('restartBackendService')}
            </button>
          </div>
        </div>
      </section>
    `
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    const updateDisabled = this.checking || this.updating || !this.updateInfo?.updateAvailable
    const desktopApp = isDesktopApp()

    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('projectInfo')}>
          ${this.infoRows()}
        </section>

        <section class="quickforge-settings-section" aria-label=${desktopApp ? t('desktopUpdates') : t('runtimeUpdates')}>
          ${desktopApp ? null : html`
            <div class="quickforge-settings-row">
              <div class="quickforge-settings-row-main">
                <div class="quickforge-settings-row-title">
                  ${t('updateFrequencySection')}
                  <quickforge-info-tip .label=${t('updateFrequencyDescription')}></quickforge-info-tip>
                </div>
                <div class="quickforge-settings-row-description">
                  ${this.lastCheckAt
                    ? t('lastCheckedAt', { time: new Date(this.lastCheckAt).toLocaleString(getDateLocale()) })
                    : t('lastCheckedNever')}
                </div>
              </div>
              <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
                <div class="quickforge-settings-segmented quickforge-settings-segmented-wrap" role="group" aria-label=${t('updateFrequencySection')}>
                  ${FREQUENCY_OPTIONS.map((option) => this.renderFrequencyOption(option))}
                </div>
              </div>
            </div>

            ${this.updateStatus()}
          `}

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${desktopApp ? t('desktopUpdates') : t('runtimeUpdates')}
                <quickforge-info-tip .label=${desktopApp ? t('desktopUpdatesDescription') : t('runtimeUpdatesDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">
                ${desktopApp ? t('desktopUpdatesDescription') : t('runtimeUpdatesDescription')}
              </div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <button
                class="quickforge-settings-button quickforge-settings-button-secondary"
                type="button"
                ?disabled=${this.checking || this.updating}
                @click=${() => this.checkUpdate()}
              >
                ${this.checking ? t('checkingUpdate') : (desktopApp ? t('openDesktopReleases') : t('checkRuntimeUpdate'))}
              </button>
              ${desktopApp ? null : html`
                <button
                  class="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  ?disabled=${updateDisabled}
                  @click=${() => this.updateQuickForge()}
                >
                  ${this.updating ? t('updatingQuickForge') : t('updateRuntimeNow')}
                </button>
              `}
            </div>
          </div>
        </section>

        ${this.restartSection()}

        ${this.message ? html`<div class="quickforge-settings-message">${this.message}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
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
