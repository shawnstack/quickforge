import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AgentHarness } from '@/lib/types'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import {
  defaultThinkingLevelForModel,
  getSelectableConfiguredModels,
  loadDefaultOptions,
  mergeAvailableModels,
  saveDefaultOptions,
} from '@/lib/pi-chat'
import { getCloudModels, getCloudStatus } from '@/lib/cloud-client'
import { CLOUD_STATE_CHANGED_EVENT } from '@/hooks/useCloudModels'
import { logger } from '@/lib/logger'
import {
  loadToolDisplaySettings,
  saveToolDisplaySettings,
  type ToolDisplayMode,
} from '@/lib/tool-display-settings'
import {
  loadAutoCompactSettings,
  saveAutoCompactSettings,
} from '@/lib/auto-compact-settings'
import {
  loadAutoArchiveSettings,
  saveAutoArchiveSettings,
} from '@/lib/auto-archive-settings'
import { applyAppLanguage, getAppLanguage, t, type AppLanguage } from '@/lib/i18n'
import {
  getSystemNotificationPermission,
  isSystemNotificationsEnabled,
  requestSystemNotificationPermission,
  setSystemNotificationsEnabled,
  showTaskSystemNotification,
  type SystemNotificationPermission,
} from '@/lib/system-notifications'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'
import { loadModelCatalog } from '@/lib/model-reference'
import { notifyDefaultHarnessChanged } from '@/lib/default-harness-events'
import './info-tip'
import './quickforge-settings-select'

type AnyModel = Model<Api>

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

type NetworkProxyMode = 'direct' | 'system' | 'manual' | 'pac'

type NetworkProxyState = {
  config: {
    mode: NetworkProxyMode
    proxyUrl: string
  }
  status: {
    effectiveMode: NetworkProxyMode | 'unsupported'
    supported: boolean
    source: string
    runtimeKind: string
    features?: {
      pac?: boolean
      pacUrl?: boolean
      wpad?: boolean
      socks?: boolean
    }
    error?: string
  }
}

const THINKING_OPTIONS: { value: ThinkingLevel; label: () => string }[] = [
  { value: 'off', label: () => t('thinkingOff') },
  { value: 'low', label: () => t('thinkingLow') },
  { value: 'medium', label: () => t('thinkingMedium') },
  { value: 'high', label: () => t('thinkingHigh') },
  { value: 'xhigh', label: () => t('thinkingXHigh') },
]

const TOOL_DISPLAY_MODE_OPTIONS: { value: ToolDisplayMode; label: () => string }[] = [
  { value: 'compact', label: () => t('toolDisplayCompact') },
  { value: 'detailed', label: () => t('toolDisplayDetailed') },
]

const CUSTOM_SHELL_OPTION = '__custom__'

function normalizeBaseUrl(value?: string) {
  return (value ?? '').trim().replace(/\/$/, '')
}

function modelKey(model: AnyModel) {
  return JSON.stringify([
    model.provider,
    model.id,
    model.api,
    normalizeBaseUrl(model.baseUrl),
  ])
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

const deleteIcon = html`
  <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
  </svg>
`

export class DefaultOptionsSettingsTab extends SettingsTab {
  private models: AnyModel[] = []
  private selectedModel?: AnyModel
  private autoSelectedModelKey = ''
  private loadSettingsGeneration = 0

  private harness: AgentHarness = 'quickforge'
  private savedHarness: AgentHarness = 'quickforge'
  private defaultOptionsSavePromise: Promise<void> = Promise.resolve()
  private thinkingLevel: ThinkingLevel = 'off'
  private toolDisplayMode: ToolDisplayMode = 'compact'
  private showContextUsage = false
  private autoCompactEnabled = true
  private autoCompactRequireConfirmation = true
  private autoCompactThresholdPercent = 80
  private autoCompactThresholdPercentInput = '80'
  private autoCompactKeepRecentTurns = 0
  private autoArchiveEnabled = false
  private systemNotificationsEnabled = false
  private systemNotificationPermission: SystemNotificationPermission = 'unsupported'
  private systemNotificationBusy = false
  private selectedLanguage: AppLanguage = getAppLanguage()
  private loading = true
  private saved = false
  private savedMessage = ''
  private error = ''
  private terminalShellConfig: TerminalShellConfig = { terminalShell: 'auto', defaultProfileId: 'auto', profiles: [] }
  private customShellCommand = ''
  private customShellEditorOpen = false
  private networkProxyMode: NetworkProxyMode = 'direct'
  private networkProxyUrl = ''
  private savedNetworkProxyConfig = { mode: 'direct' as NetworkProxyMode, proxyUrl: '' }
  private networkProxyStatus: NetworkProxyState['status'] | null = null
  private networkProxySaving = false
  private networkProxyLoaded = false

  override getTabName(): string {
    return t('defaultOptions')
  }

  override connectedCallback() {
    super.connectedCallback()
    void this.loadSettings()
    window.addEventListener(CLOUD_STATE_CHANGED_EVENT, this.handleCloudStateChanged)
  }

  override disconnectedCallback() {
    window.removeEventListener(CLOUD_STATE_CHANGED_EVENT, this.handleCloudStateChanged)
    super.disconnectedCallback?.()
  }

  private handleCloudStateChanged = () => {
    // QuickForge Cloud models become visible after login and disappear after
    // logout, so reload the default-options form when the cloud state changes.
    void this.loadSettings()
  }

  private async loadCloudModels(): Promise<Model<Api>[]> {
    try {
      const status = await getCloudStatus()
      if (!status.configured || status.enabled === false || status.mode === 'local' || !status.hasSession) return []
      return await getCloudModels()
    } catch (error) {
      logger.warn('Failed to load QuickForge Cloud models for default options:', error)
      return []
    }
  }

  private async loadSettings() {
    const generation = ++this.loadSettingsGeneration
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      const [localModels, catalogModels, defaults, toolDisplaySettings, autoCompactSettings, autoArchiveSettings] = await Promise.all([
        getSelectableConfiguredModels(storage),
        loadModelCatalog().catch(() => []),
        loadDefaultOptions(storage),
        loadToolDisplaySettings(storage),
        loadAutoCompactSettings(storage),
        loadAutoArchiveSettings(storage),
      ])
      const baseModels = catalogModels.length ? catalogModels : localModels
      const models = mergeAvailableModels(baseModels, [])
      this.models = models
      this.selectedModel = defaults.model
        ? models.find((model) => modelKey(model) === modelKey(defaults.model!)) ?? models[0]
        : models[0]
      this.autoSelectedModelKey = this.selectedModel ? modelKey(this.selectedModel) : ''
      // QuickForge Cloud models load in the background: render the catalog and
      // local models first, then merge the Cloud catalog once it arrives. The
      // generation guard keeps a superseded load (newer loadSettings run or a
      // cloud-state reload) from overwriting newer state.
      void this.loadCloudModels().then((cloudModels) => {
        if (generation !== this.loadSettingsGeneration) return
        const merged = mergeAvailableModels(baseModels, cloudModels)
        this.models = merged
        // Re-resolve the automatic selection against the merged catalog, but
        // leave a manually changed selection untouched.
        if (!this.selectedModel || modelKey(this.selectedModel) === this.autoSelectedModelKey) {
          this.selectedModel = defaults.model
            ? merged.find((model) => modelKey(model) === modelKey(defaults.model!)) ?? merged[0]
            : merged[0]
          this.autoSelectedModelKey = this.selectedModel ? modelKey(this.selectedModel) : ''
        }
        this.requestUpdate()
      })
      this.thinkingLevel = defaults.thinkingLevel ?? defaultThinkingLevelForModel(this.selectedModel)
      this.harness = defaults.harness ?? 'quickforge'
      this.savedHarness = this.harness
      this.toolDisplayMode = toolDisplaySettings.toolDisplayMode
      this.showContextUsage = toolDisplaySettings.showContextUsage
      this.autoCompactEnabled = autoCompactSettings.enabled
      this.autoCompactRequireConfirmation = autoCompactSettings.requireConfirmation
      this.autoCompactThresholdPercent = autoCompactSettings.thresholdPercent
      this.autoCompactThresholdPercentInput = String(autoCompactSettings.thresholdPercent)
      this.autoCompactKeepRecentTurns = autoCompactSettings.keepRecentTurns
      this.autoArchiveEnabled = autoArchiveSettings.enabled
      this.systemNotificationsEnabled = isSystemNotificationsEnabled()
      this.systemNotificationPermission = await getSystemNotificationPermission()
      if (this.systemNotificationsEnabled && this.systemNotificationPermission !== 'granted') {
        this.systemNotificationsEnabled = false
      }
      await Promise.all([
        this.loadTerminalShell(),
        this.loadNetworkProxy(),
      ])
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private updateModel(value: string) {
    const nextModel = this.models.find((model) => modelKey(model) === value)
    this.selectedModel = nextModel
    this.thinkingLevel = defaultThinkingLevelForModel(nextModel)
    this.saved = false
    this.requestUpdate()
    void this.saveDefaultModelOptions()
  }

  private updateHarness(value: string) {
    this.harness = value === 'opencode' ? 'opencode' : 'quickforge'
    this.saved = false
    this.requestUpdate()
    void this.saveDefaultModelOptions()
  }

  private updateThinkingLevel(value: string) {
    this.thinkingLevel = THINKING_OPTIONS.some((option) => option.value === value) ? value as ThinkingLevel : 'off'
    this.saved = false
    this.requestUpdate()
    void this.saveDefaultModelOptions()
  }

  private updateLanguage(value: string) {
    this.selectedLanguage = value === 'zh' ? 'zh' : 'en'
    this.requestUpdate()
    void this.applyLanguage()
  }

  private async applyLanguage() {
    await applyAppLanguage(getAppStorage(), this.selectedLanguage)
  }

  private updateToolDisplayMode(toolDisplayMode: ToolDisplayMode) {
    if (this.toolDisplayMode === toolDisplayMode) return
    this.toolDisplayMode = toolDisplayMode
    this.saved = false
    this.requestUpdate()
    void this.saveToolDisplayOptions()
  }

  private updateShowContextUsage(checked: boolean) {
    this.showContextUsage = checked
    this.saved = false
    this.requestUpdate()
    void this.saveToolDisplayOptions()
  }

  private updateAutoCompactEnabled(checked: boolean) {
    this.autoCompactEnabled = checked
    this.saved = false
    this.requestUpdate()
    void this.saveAutoCompactOptions()
  }

  private updateAutoCompactRequireConfirmation(checked: boolean) {
    this.autoCompactRequireConfirmation = checked
    this.saved = false
    this.requestUpdate()
    void this.saveAutoCompactOptions()
  }

  private updateAutoArchiveEnabled(checked: boolean) {
    this.autoArchiveEnabled = checked
    this.saved = false
    this.requestUpdate()
    void this.saveAutoArchiveOptions()
  }

  private async updateSystemNotifications(checked: boolean) {
    this.systemNotificationBusy = true
    this.saved = false
    this.error = ''
    this.requestUpdate()
    try {
      if (!checked) {
        setSystemNotificationsEnabled(false)
        this.systemNotificationsEnabled = false
        this.markSaved(t('systemNotificationsDisabled'))
        return
      }

      setSystemNotificationsEnabled(true)
      const permission = await requestSystemNotificationPermission()
      this.systemNotificationPermission = permission
      this.systemNotificationsEnabled = permission === 'granted'
      if (permission === 'granted') {
        this.markSaved(t('systemNotificationsEnabled'))
      } else if (permission === 'denied') {
        this.error = t('systemNotificationsDeniedHelp')
      } else if (permission === 'unsupported') {
        this.error = t('systemNotificationsUnsupported')
      }
    } catch (error) {
      this.systemNotificationsEnabled = false
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.systemNotificationBusy = false
      this.requestUpdate()
    }
  }

  private async sendTestSystemNotification() {
    this.systemNotificationBusy = true
    this.error = ''
    this.requestUpdate()
    try {
      const shown = await showTaskSystemNotification({
        key: `test:${Date.now()}`,
        title: t('systemNotificationTestTitle'),
        status: 'idle',
        force: true,
      })
      if (!shown) this.error = t('systemNotificationTestFailed')
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('systemNotificationTestFailed')
    } finally {
      this.systemNotificationBusy = false
      this.requestUpdate()
    }
  }

  private systemNotificationStatusText() {
    if (this.systemNotificationPermission === 'unsupported') return t('systemNotificationsUnsupported')
    if (this.systemNotificationPermission === 'denied') return t('systemNotificationsPermissionDenied')
    if (this.systemNotificationPermission === 'granted') return t('systemNotificationsPermissionGranted')
    return t('systemNotificationsPermissionPrompt')
  }

  private updateAutoCompactThresholdPercent(value: string) {
    this.autoCompactThresholdPercentInput = value
    const parsed = Number(value)
    if (value !== '' && Number.isFinite(parsed)) {
      this.autoCompactThresholdPercent = parsed
    }
    this.saved = false
    this.requestUpdate()
  }

  private updateAutoCompactKeepRecentTurns(value: string) {
    const parsed = Number(value)
    this.autoCompactKeepRecentTurns = Number.isFinite(parsed) ? parsed : 0
    this.saved = false
    this.requestUpdate()
  }

  private commitAutoCompactThresholdPercent() {
    const parsed = Number(this.autoCompactThresholdPercentInput)
    if (!Number.isFinite(parsed)) {
      this.autoCompactThresholdPercentInput = String(this.autoCompactThresholdPercent)
      this.requestUpdate()
      return
    }
    const normalized = Math.max(50, Math.min(95, Math.round(parsed)))
    this.autoCompactThresholdPercent = normalized
    this.autoCompactThresholdPercentInput = String(normalized)
    this.requestUpdate()
    void this.saveAutoCompactOptions()
  }

  private commitAutoCompactKeepRecentTurns() {
    const parsed = Number(this.autoCompactKeepRecentTurns)
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(20, Math.round(parsed))) : 0
    this.autoCompactKeepRecentTurns = normalized
    this.requestUpdate()
    void this.saveAutoCompactOptions()
  }

  private markSaved(message = t('defaultOptionsSaved')) {
    this.saved = true
    this.savedMessage = message
    this.error = ''
    this.requestUpdate()
  }

  private customShellProfiles() {
    return this.terminalShellConfig.profiles.filter((profile) => !profile.builtin)
  }

  private selectedTerminalShellProfileId() {
    const profiles = this.terminalShellConfig.profiles
    if (profiles.some((profile) => profile.id === this.terminalShellConfig.defaultProfileId)) {
      return this.terminalShellConfig.defaultProfileId
    }
    return profiles[0]?.id || CUSTOM_SHELL_OPTION
  }

  private updateTerminalShellSelection(value: string) {
    if (value === CUSTOM_SHELL_OPTION) {
      this.customShellEditorOpen = true
      this.requestUpdate()
      return
    }

    this.customShellEditorOpen = false
    this.requestUpdate()
    void this.saveTerminalShellConfig(value)
  }

  private async loadNetworkProxy() {
    try {
      const response = await fetch('/api/system/network-proxy', { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      this.networkProxyMode = payload?.config?.mode || 'direct'
      this.networkProxyUrl = payload?.config?.proxyUrl || ''
      this.savedNetworkProxyConfig = { mode: this.networkProxyMode, proxyUrl: this.networkProxyUrl }
      this.networkProxyStatus = payload?.status || null
      this.networkProxyLoaded = true
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    }
  }

  private updateNetworkProxyMode(mode: NetworkProxyMode) {
    if (this.networkProxyMode === mode || this.networkProxySaving || !this.networkProxyLoaded) return
    if (mode === 'pac' && this.networkProxyStatus?.features?.pacUrl !== true) return
    this.networkProxyMode = mode
    this.saved = false
    this.error = ''
    this.requestUpdate()
    if (mode === 'manual' || mode === 'pac') return
    void this.saveNetworkProxy()
  }

  private updateNetworkProxyUrl(value: string) {
    this.networkProxyUrl = value
    this.saved = false
    this.requestUpdate()
  }

  private networkProxyValidationError() {
    const value = this.networkProxyUrl.trim()
    const isPac = this.networkProxyMode === 'pac'
    if (!value) return t(isPac ? 'networkProxyPacUrlRequired' : 'networkProxyAddressRequired')
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return t(isPac ? 'networkProxyPacUrlProtocolError' : 'networkProxyAddressProtocolError')
      }
      if (!url.hostname) return t(isPac ? 'networkProxyPacUrlHostError' : 'networkProxyAddressPortError')
      if (!isPac && !url.port) return t('networkProxyAddressPortError')
      if (url.username || url.password) {
        return t(isPac ? 'networkProxyPacUrlCredentialsError' : 'networkProxyAddressCredentialsError')
      }
      if (isPac && url.hash) return t('networkProxyPacUrlFragmentError')
      if (!isPac && ((url.pathname && url.pathname !== '/') || url.search || url.hash)) {
        return t('networkProxyAddressPathError')
      }
      return ''
    } catch {
      return t(isPac ? 'networkProxyPacUrlInvalid' : 'networkProxyAddressInvalid')
    }
  }

  private async saveNetworkProxy() {
    if (this.networkProxySaving || !this.networkProxyLoaded) return
    if (this.networkProxyMode === 'pac' && this.networkProxyStatus?.features?.pacUrl !== true) {
      this.saved = false
      this.error = t('networkProxyPacUnsupported')
      this.requestUpdate()
      return
    }
    if (this.networkProxyMode === 'manual' || this.networkProxyMode === 'pac') {
      const validationError = this.networkProxyValidationError()
      if (validationError) {
        this.saved = false
        this.error = validationError
        this.requestUpdate()
        return
      }
    }
    this.networkProxySaving = true
    this.saved = false
    this.error = ''
    this.requestUpdate()
    try {
      const response = await fetch('/api/system/network-proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: this.networkProxyMode, proxyUrl: this.networkProxyUrl }),
      })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      this.networkProxyMode = payload?.config?.mode || this.networkProxyMode
      this.networkProxyUrl = payload?.config?.proxyUrl || ''
      this.savedNetworkProxyConfig = { mode: this.networkProxyMode, proxyUrl: this.networkProxyUrl }
      this.networkProxyStatus = payload?.status || null
      this.markSaved(t('networkProxySaved'))
    } catch (error) {
      this.networkProxyMode = this.savedNetworkProxyConfig.mode
      this.networkProxyUrl = this.savedNetworkProxyConfig.proxyUrl
      this.saved = false
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.networkProxySaving = false
      this.requestUpdate()
    }
  }

  private async refreshNetworkProxy() {
    if (this.networkProxySaving || !this.networkProxyLoaded) return
    this.networkProxySaving = true
    this.saved = false
    this.error = ''
    this.requestUpdate()
    try {
      const response = await fetch('/api/system/network-proxy/refresh', { method: 'POST' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      this.networkProxyStatus = payload?.status || null
      this.markSaved(t('networkProxyRefreshed'))
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
    } finally {
      this.networkProxySaving = false
      this.requestUpdate()
    }
  }

  private renderNetworkProxyModeOption(mode: NetworkProxyMode, label: string) {
    const selected = this.networkProxyMode === mode
    const unsupported = mode === 'pac' && this.networkProxyStatus?.features?.pacUrl !== true
    return html`
      <button
        type="button"
        class="quickforge-settings-segmented-option ${selected ? 'quickforge-settings-segmented-option-active' : ''}"
        aria-pressed=${selected ? 'true' : 'false'}
        title=${unsupported ? t('networkProxyPacUnsupported') : ''}
        ?disabled=${this.networkProxySaving || !this.networkProxyLoaded || unsupported}
        @click=${() => this.updateNetworkProxyMode(mode)}
      >
        ${label}
      </button>
    `
  }

  private networkProxySettings() {
    const hasProxyUrlInput = this.networkProxyMode === 'manual' || this.networkProxyMode === 'pac'
    const pacUnsupported = this.networkProxyMode === 'pac' && this.networkProxyStatus?.features?.pacUrl !== true
    const proxyValidationError = hasProxyUrlInput ? this.networkProxyValidationError() : ''
    const hasUnsavedProxyUrl = hasProxyUrlInput && (
      this.networkProxyUrl !== this.savedNetworkProxyConfig.proxyUrl
      || this.savedNetworkProxyConfig.mode !== this.networkProxyMode
    )
    const statusText = !this.networkProxyLoaded
      ? t('networkProxyLoadFailed')
      : pacUnsupported
        ? t('networkProxyPacUnsupported')
        : this.networkProxyStatus?.supported === false
          ? this.networkProxyStatus.error || t('networkProxyUnsupported')
          : t('networkProxyStatus', {
              source: this.networkProxyStatus?.source || t('unknown'),
              runtime: this.networkProxyStatus?.runtimeKind || t('unknown'),
            })

    return html`
      <section class="quickforge-settings-section" aria-label=${t('networkConnection')}>
        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">
              ${t('networkProxyMode')}
              <quickforge-info-tip .label=${t('networkProxyDescription')}></quickforge-info-tip>
            </div>
            <div class="quickforge-settings-row-description">${statusText}</div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <div class="quickforge-settings-segmented quickforge-settings-segmented-wrap" role="group" aria-label=${t('networkProxyMode')}>
              ${this.renderNetworkProxyModeOption('direct', t('networkProxyDirect'))}
              ${this.renderNetworkProxyModeOption('system', t('networkProxySystem'))}
              ${this.renderNetworkProxyModeOption('manual', t('networkProxyManual'))}
              ${this.renderNetworkProxyModeOption('pac', t('networkProxyPac'))}
            </div>
          </div>
        </div>

        ${hasProxyUrlInput
          ? html`
            <div class="quickforge-settings-row">
              <div class="quickforge-settings-row-main">
                <div class="quickforge-settings-row-title">
                  ${t(this.networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                </div>
                <div class="quickforge-settings-row-description">
                  ${t(this.networkProxyMode === 'pac' ? 'networkProxyPacUrlDescription' : 'networkProxyAddressDescription')}
                </div>
              </div>
              <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-network-proxy-control">
                <input
                  id="quickforge-network-proxy-url"
                  class="quickforge-settings-input quickforge-settings-mono"
                  type="url"
                  aria-label=${t(this.networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                  aria-invalid=${hasUnsavedProxyUrl && proxyValidationError ? 'true' : 'false'}
                  .value=${this.networkProxyUrl}
                  placeholder=${this.networkProxyMode === 'pac' ? 'https://example.com/proxy.pac' : 'http://127.0.0.1:7890'}
                  ?disabled=${this.networkProxySaving || !this.networkProxyLoaded || pacUnsupported}
                  @input=${(event: Event) => this.updateNetworkProxyUrl((event.target as HTMLInputElement).value)}
                  @keydown=${(event: KeyboardEvent) => {
                    if (event.key === 'Enter' && this.networkProxyUrl.trim()) {
                      event.preventDefault()
                      void this.saveNetworkProxy()
                    }
                  }}
                />
                <button
                  class="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  ?disabled=${this.networkProxySaving || !this.networkProxyLoaded || pacUnsupported || Boolean(proxyValidationError) || !hasUnsavedProxyUrl}
                  @click=${() => this.saveNetworkProxy()}
                >
                  ${this.networkProxySaving ? t('saving') : t('networkProxySave')}
                </button>
              </div>
            </div>
          `
          : null}

        ${this.networkProxyMode === 'system'
          ? html`
            <div class="quickforge-settings-row">
              <div class="quickforge-settings-row-main">
                <div class="quickforge-settings-row-title">${t('networkProxyRefresh')}</div>
                <div class="quickforge-settings-row-description">${t('networkProxyRefreshDescription')}</div>
              </div>
              <div class="quickforge-settings-row-control">
                <button
                  class="quickforge-settings-button"
                  type="button"
                  ?disabled=${this.networkProxySaving || !this.networkProxyLoaded}
                  @click=${() => this.refreshNetworkProxy()}
                >
                  ${this.networkProxySaving ? t('saving') : t('networkProxyRefresh')}
                </button>
              </div>
            </div>
          `
          : null}
      </section>
    `
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
      this.markSaved(message)
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
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

    const profile = { id: customProfileId(), name: profileNameFromCommand(command), command, builtin: false }
    const profiles = [
      ...this.customShellProfiles(),
      profile,
    ]
    this.customShellCommand = ''
    this.customShellEditorOpen = false
    await this.saveTerminalShellConfig(profile.id, profiles, t('terminalShellProfilesSaved'))
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

  private async saveDefaultModelOptions() {
    const model = this.selectedModel
    const thinkingLevel = model?.reasoning ? this.thinkingLevel : 'off'
    const harness = this.harness
    const save = async () => {
      try {
        await saveDefaultOptions(getAppStorage(), {
          model,
          thinkingLevel,
          harness,
        })
        if (this.savedHarness !== harness) {
          notifyDefaultHarnessChanged(harness)
          this.savedHarness = harness
        }
        this.markSaved()
      } catch (error) {
        this.error = error instanceof Error ? error.message : t('requestFailed')
        this.requestUpdate()
      }
    }
    this.defaultOptionsSavePromise = this.defaultOptionsSavePromise.then(save, save)
    await this.defaultOptionsSavePromise
  }

  private async saveToolDisplayOptions() {
    try {
      await saveToolDisplaySettings(getAppStorage(), {
        toolDisplayMode: this.toolDisplayMode,
        showContextUsage: this.showContextUsage,
      })
      this.markSaved()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async saveAutoCompactOptions() {
    try {
      await saveAutoCompactSettings(getAppStorage(), {
        enabled: this.autoCompactEnabled,
        thresholdPercent: this.autoCompactThresholdPercent,
        keepRecentTurns: this.autoCompactKeepRecentTurns,
        minSourceChars: 1600,
        requireConfirmation: this.autoCompactRequireConfirmation,
      })
      this.markSaved()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async saveAutoArchiveOptions() {
    try {
      await saveAutoArchiveSettings(getAppStorage(), { enabled: this.autoArchiveEnabled })
      this.markSaved(t('autoArchiveSaved'))
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel('quickforge-sync')
          channel.postMessage({
            type: 'settings-changed',
            sourceTabId: 'default-options-settings-tab',
            timestamp: Date.now(),
          })
          channel.close()
        } catch {
          // Cross-tab refresh is best-effort only.
        }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private modelOptions() {
    return this.models
  }

  private languageOptions() {
    return [
      { value: 'zh', label: t('simplifiedChinese') },
      { value: 'en', label: t('english') },
    ]
  }

  private harnessOptions() {
    return [
      { value: 'quickforge', label: 'QuickForge' },
      { value: 'claude-code', label: t('claudeCodeHarnessUnavailable'), disabled: true },
      { value: 'opencode', label: 'OpenCode' },
    ]
  }

  private modelSelectOptions() {
    return this.modelOptions().map((model) => ({ value: modelKey(model), label: modelLabel(model) }))
  }

  private thinkingOptions() {
    return THINKING_OPTIONS.map((option) => ({ value: option.value, label: option.label() }))
  }

  private terminalShellOptions() {
    return [
      ...this.terminalShellConfig.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
      { value: CUSTOM_SHELL_OPTION, label: t('terminalShellCustomOption') },
    ]
  }

  private terminalShellSettings() {
    const profiles = this.terminalShellConfig.profiles
    const selectedProfileId = this.selectedTerminalShellProfileId()
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
    const showCustomEditor = this.customShellEditorOpen || profiles.length === 0

    return html`
      <section class="quickforge-settings-section" aria-label=${t('terminalShell')}>
        <div class="quickforge-settings-row">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">
              ${t('terminalShellDefault')}
              <quickforge-info-tip .label=${t('terminalShellDescription')}></quickforge-info-tip>
            </div>
            <div class="quickforge-settings-row-description quickforge-settings-mono">
              ${selectedProfile?.command || t('terminalShellNoDetected')}
            </div>
          </div>
          <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <quickforge-settings-select
              .value=${showCustomEditor ? CUSTOM_SHELL_OPTION : selectedProfileId}
              .options=${this.terminalShellOptions()}
              label=${t('terminalShellDefault')}
              @change=${(event: CustomEvent<string>) => this.updateTerminalShellSelection(event.detail)}
            ></quickforge-settings-select>
            ${selectedProfile && !selectedProfile.builtin && !showCustomEditor
              ? html`
                <button
                  class="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                  type="button"
                  title=${t('delete')}
                  aria-label=${t('delete')}
                  @click=${() => this.deleteCustomTerminalShell(selectedProfile.id)}
                >
                  ${deleteIcon}
                </button>
              `
              : null}
          </div>
        </div>

        ${showCustomEditor
          ? html`
            <div class="quickforge-settings-row">
              <div class="quickforge-settings-row-main">
                <div class="quickforge-settings-row-title">${t('terminalShellCommand')}</div>
                <div class="quickforge-settings-row-description">${t('terminalShellCustomDescription')}</div>
              </div>
              <div class="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-terminal-shell-command-control">
                <input
                  class="quickforge-settings-input quickforge-settings-mono"
                  type="text"
                  .value=${this.customShellCommand}
                  placeholder=${t('terminalShellCommandPlaceholder')}
                  @input=${(event: Event) => {
                    this.customShellCommand = (event.target as HTMLInputElement).value
                  }}
                />
                <button
                  class="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  title=${t('terminalShellAdd')}
                  aria-label=${t('terminalShellAdd')}
                  @click=${() => this.addCustomTerminalShell()}
                >
                  ${t('terminalShellAdd')}
                </button>
              </div>
            </div>
          `
          : null}
      </section>
    `
  }

  private renderToolDisplayModeOption(option: { value: ToolDisplayMode; label: () => string }) {
    const selected = this.toolDisplayMode === option.value
    return html`
      <button
        type="button"
        class="quickforge-settings-segmented-option ${selected ? 'quickforge-settings-segmented-option-active' : ''}"
        aria-pressed=${selected ? 'true' : 'false'}
        @click=${() => this.updateToolDisplayMode(option.value)}
      >
        ${option.label()}
      </button>
    `
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
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    return html`
      <div class="quickforge-settings-stack">
        <section class="quickforge-settings-section" aria-label=${t('defaultOptions')}>
          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('language')}
                <quickforge-info-tip .label=${t('languageDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('displayLanguage')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <quickforge-settings-select
                .value=${this.selectedLanguage}
                .options=${this.languageOptions()}
                label=${t('language')}
                @change=${(event: CustomEvent<string>) => this.updateLanguage(event.detail)}
              ></quickforge-settings-select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('defaultHarness')}</div>
              <div class="quickforge-settings-row-description">${t('defaultHarnessDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <quickforge-settings-select
                .value=${this.harness}
                .options=${this.harnessOptions()}
                label=${t('defaultHarness')}
                @change=${(event: CustomEvent<string>) => this.updateHarness(event.detail)}
              ></quickforge-settings-select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('defaultModel')}</div>
              <div class="quickforge-settings-row-description">${t('defaultModelDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <quickforge-settings-select
                .value=${this.selectedModel ? modelKey(this.selectedModel) : ''}
                .options=${this.modelSelectOptions()}
                .disabled=${this.models.length === 0}
                searchable
                searchPlaceholder=${t('search')}
                noResultsLabel=${t('noMatchingOptions')}
                placeholder=${t('noModelAvailable')}
                label=${t('defaultModel')}
                @change=${(event: CustomEvent<string>) => this.updateModel(event.detail)}
              ></quickforge-settings-select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('defaultThinkingLevel')}</div>
              <div class="quickforge-settings-row-description">
                ${this.selectedModel?.reasoning ? t('defaultThinkingLevelDescription') : t('thinkingRequiresReasoningModel')}
              </div>
            </div>
            <div class="quickforge-settings-row-control">
              <quickforge-settings-select
                .value=${this.thinkingLevel}
                .options=${this.thinkingOptions()}
                .disabled=${!this.selectedModel?.reasoning}
                label=${t('defaultThinkingLevel')}
                @change=${(event: CustomEvent<string>) => this.updateThinkingLevel(event.detail)}
              ></quickforge-settings-select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('toolDisplay')}
                <quickforge-info-tip .label=${t('toolDisplayModeDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('toolDisplayModeDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <div class="quickforge-settings-segmented" role="group" aria-label=${t('toolDisplay')}>
                ${TOOL_DISPLAY_MODE_OPTIONS.map((option) => this.renderToolDisplayModeOption(option))}
              </div>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('systemNotifications')}
                <quickforge-info-tip .label=${t('systemNotificationsDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${this.systemNotificationStatusText()}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              ${this.systemNotificationsEnabled ? html`
                <button
                  class="quickforge-settings-button quickforge-settings-button-secondary"
                  type="button"
                  ?disabled=${this.systemNotificationBusy}
                  @click=${() => this.sendTestSystemNotification()}
                >${t('systemNotificationsTest')}</button>
              ` : null}
              ${this.renderSwitch(
                this.systemNotificationsEnabled,
                (checked) => { void this.updateSystemNotifications(checked) },
                this.systemNotificationBusy || this.systemNotificationPermission === 'unsupported',
              )}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('showContextUsage')}
                <quickforge-info-tip .label=${t('showContextUsageDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('showContextUsageDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.showContextUsage, (checked) => this.updateShowContextUsage(checked))}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('autoArchiveEnabled')}
                <quickforge-info-tip .label=${t('autoArchiveDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('autoArchiveTriggerNote')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.autoArchiveEnabled, (checked) => this.updateAutoArchiveEnabled(checked))}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('autoCompactEnabled')}
                <quickforge-info-tip .label=${t('autoCompactDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('autoCompactTriggerNote')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.autoCompactEnabled, (checked) => this.updateAutoCompactEnabled(checked))}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('autoCompactRequireConfirmation')}</div>
              <div class="quickforge-settings-row-description">${t('autoCompactRequireConfirmationDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(
                this.autoCompactRequireConfirmation,
                (checked) => this.updateAutoCompactRequireConfirmation(checked),
                !this.autoCompactEnabled,
              )}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('autoCompactThresholdPercent')}</div>
              <div class="quickforge-settings-row-description">${t('autoCompactThresholdDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <input
                class="quickforge-settings-input quickforge-settings-number-input"
                type="number"
                min="50"
                max="95"
                step="1"
                .value=${this.autoCompactThresholdPercentInput}
                ?disabled=${!this.autoCompactEnabled}
                @input=${(event: Event) => this.updateAutoCompactThresholdPercent((event.target as HTMLInputElement).value)}
                @change=${() => this.commitAutoCompactThresholdPercent()}
                @blur=${() => this.commitAutoCompactThresholdPercent()}
              />
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('autoCompactKeepRecentTurns')}
                <quickforge-info-tip .label=${t('autoCompactHistoryPreserved')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('autoCompactKeepRecentTurnsDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              <input
                class="quickforge-settings-input quickforge-settings-number-input"
                type="number"
                min="0"
                max="20"
                step="1"
                .value=${String(this.autoCompactKeepRecentTurns)}
                ?disabled=${!this.autoCompactEnabled}
                @input=${(event: Event) => this.updateAutoCompactKeepRecentTurns((event.target as HTMLInputElement).value)}
                @change=${() => this.commitAutoCompactKeepRecentTurns()}
                @blur=${() => this.commitAutoCompactKeepRecentTurns()}
              />
            </div>
          </div>
        </section>

        ${this.networkProxySettings()}

        ${this.terminalShellSettings()}

        ${this.saved ? html`<div class="quickforge-settings-message" role="status">${this.savedMessage || t('defaultOptionsSaved')}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert" role="alert">${this.error}</div>` : null}
      </div>
    `
  }
}

const tagName = 'quickforge-default-options-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, DefaultOptionsSettingsTab)
}

export function createDefaultOptionsSettingsTab() {
  return document.createElement(tagName) as DefaultOptionsSettingsTab
}
