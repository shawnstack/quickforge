import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getAppStorage, SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import {
  defaultThinkingLevelForModel,
  getConfiguredModels,
  loadDefaultOptions,
  saveDefaultOptions,
} from '@/lib/pi-chat'
import {
  loadToolDisplaySettings,
  saveToolDisplaySettings,
} from '@/lib/tool-display-settings'
import {
  loadAutoCompactSettings,
  saveAutoCompactSettings,
} from '@/lib/auto-compact-settings'
import { applyAppLanguage, getAppLanguage, t, type AppLanguage } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'
import './info-tip'

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

const THINKING_OPTIONS: { value: ThinkingLevel; label: () => string }[] = [
  { value: 'off', label: () => t('thinkingOff') },
  { value: 'low', label: () => t('thinkingLow') },
  { value: 'medium', label: () => t('thinkingMedium') },
  { value: 'high', label: () => t('thinkingHigh') },
  { value: 'xhigh', label: () => t('thinkingXHigh') },
]

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

function modelLabel(model: AnyModel) {
  return `${model.provider} / ${model.id}`
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

class DefaultOptionsSettingsTab extends SettingsTab {
  private models: AnyModel[] = []
  private selectedModel?: AnyModel
  private thinkingLevel: ThinkingLevel = 'off'
  private showToolDetails = false
  private expandToolsByDefault = false
  private autoCompactEnabled = false
  private autoCompactRequireConfirmation = true
  private autoCompactThresholdPercent = 80
  private autoCompactThresholdPercentInput = '80'
  private autoCompactKeepRecentTurns = 3
  private selectedLanguage: AppLanguage = getAppLanguage()
  private loading = true
  private saved = false
  private savedMessage = ''
  private error = ''
  private terminalShellConfig: TerminalShellConfig = { terminalShell: 'auto', defaultProfileId: 'auto', profiles: [] }
  private customShellCommand = ''

  override getTabName(): string {
    return t('defaultOptions')
  }

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadSettings()
  }

  override updated() {
    this.syncSelectValues()
  }

  private syncSelectValues() {
    const modelSelect = this.querySelector<HTMLSelectElement>('[data-default-model-select]')
    if (modelSelect && this.selectedModel) {
      modelSelect.value = modelKey(this.selectedModel)
    }

    const thinkingSelect = this.querySelector<HTMLSelectElement>('[data-default-thinking-select]')
    if (thinkingSelect) {
      thinkingSelect.value = this.thinkingLevel
    }

    const languageSelect = this.querySelector<HTMLSelectElement>('[data-language-select]')
    if (languageSelect) {
      languageSelect.value = this.selectedLanguage
    }
  }

  private async loadSettings() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      const [models, defaults, toolDisplaySettings, autoCompactSettings] = await Promise.all([
        getConfiguredModels(storage),
        loadDefaultOptions(storage),
        loadToolDisplaySettings(storage),
        loadAutoCompactSettings(storage),
      ])
      this.models = models
      this.selectedModel = defaults.model
        ? models.find((model) => modelKey(model) === modelKey(defaults.model!)) ?? defaults.model
        : models[0]
      this.thinkingLevel = defaults.thinkingLevel ?? defaultThinkingLevelForModel(this.selectedModel)
      this.showToolDetails = toolDisplaySettings.showToolDetails
      this.expandToolsByDefault = toolDisplaySettings.expandToolsByDefault
      this.autoCompactEnabled = autoCompactSettings.enabled
      this.autoCompactRequireConfirmation = autoCompactSettings.requireConfirmation
      this.autoCompactThresholdPercent = autoCompactSettings.thresholdPercent
      this.autoCompactThresholdPercentInput = String(autoCompactSettings.thresholdPercent)
      this.autoCompactKeepRecentTurns = autoCompactSettings.keepRecentTurns
      await this.loadTerminalShell()
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

  private updateShowToolDetails(checked: boolean) {
    this.showToolDetails = checked
    this.saved = false
    this.requestUpdate()
    void this.saveToolDisplayOptions()
  }

  private updateExpandToolsByDefault(checked: boolean) {
    this.expandToolsByDefault = checked
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
    this.autoCompactKeepRecentTurns = Number(value) || 3
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
    const normalized = Math.max(1, Math.min(20, Math.round(this.autoCompactKeepRecentTurns || 3)))
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

  private async saveDefaultModelOptions() {
    try {
      const thinkingLevel = this.selectedModel?.reasoning ? this.thinkingLevel : 'off'
      await saveDefaultOptions(getAppStorage(), {
        model: this.selectedModel,
        thinkingLevel,
      })
      this.markSaved()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  private async saveToolDisplayOptions() {
    try {
      await saveToolDisplaySettings(getAppStorage(), {
        showToolDetails: this.showToolDetails,
        expandToolsByDefault: this.expandToolsByDefault,
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

  private modelOptions() {
    if (!this.selectedModel) return this.models

    const selectedKey = modelKey(this.selectedModel)
    const exists = this.models.some((model) => modelKey(model) === selectedKey)
    return exists ? this.models : [this.selectedModel, ...this.models]
  }

  private shellProfileRow(profile: TerminalShellProfile, isFirstDetected = false) {
    const isDefault = profile.id === this.terminalShellConfig.defaultProfileId
      || (this.terminalShellConfig.defaultProfileId === 'auto' && isFirstDetected)

    return html`
      <div class="quickforge-settings-subrow">
        <div class="quickforge-settings-row-main">
          <div class="quickforge-settings-row-title">${profile.name}</div>
          <div class="quickforge-settings-row-description quickforge-settings-mono" title=${profile.command}>${profile.command}</div>
        </div>
        <div class="quickforge-settings-row-control quickforge-settings-icon-actions">
          ${isDefault
            ? html`
              <span class="quickforge-settings-icon-action quickforge-settings-icon-action-success" title=${t('terminalShellDefaultBadge')} aria-label=${t('terminalShellDefaultBadge')}>
                ${checkIcon}
              </span>
            `
            : html`
              <button
                class="quickforge-settings-icon-action"
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
                class="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
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
      <section class="quickforge-settings-section" aria-label=${t('terminalShell')}>
        <div class="quickforge-settings-row quickforge-settings-row-top">
          <div class="quickforge-settings-row-main">
            <div class="quickforge-settings-row-title">
              ${t('terminalShell')}
              <quickforge-info-tip .label=${t('terminalShellDescription')}></quickforge-info-tip>
            </div>
            <div class="quickforge-settings-row-description">${t('terminalShellAutoDetectedHint')}</div>
          </div>
        </div>

        <div class="quickforge-settings-nested-list">
          ${profiles.length > 0
            ? profiles.map((profile, index) => this.shellProfileRow(profile, index === 0))
            : html`<div class="quickforge-settings-empty-row">${t('terminalShellNoDetected')}</div>`}
        </div>

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
      </section>
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
            <div class="quickforge-settings-row-control">
              <select
                data-language-select
                class="quickforge-settings-select"
                .value=${this.selectedLanguage}
                @change=${(event: Event) => this.updateLanguage((event.target as HTMLSelectElement).value)}
              >
                <option value="zh">${t('simplifiedChinese')}</option>
                <option value="en">${t('english')}</option>
              </select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('defaultModel')}</div>
              <div class="quickforge-settings-row-description">${t('defaultModelDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control quickforge-settings-row-control-wide">
              <select
                data-default-model-select
                class="quickforge-settings-select"
                .value=${this.selectedModel ? modelKey(this.selectedModel) : ''}
                @change=${(event: Event) => this.updateModel((event.target as HTMLSelectElement).value)}
              >
                ${this.modelOptions().length === 0
                  ? html`<option value="">${t('noModelAvailable')}</option>`
                  : this.modelOptions().map((model) => html`
                      <option .value=${modelKey(model)}>${modelLabel(model)}</option>
                    `)}
              </select>
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
              <select
                data-default-thinking-select
                class="quickforge-settings-select"
                .value=${this.thinkingLevel}
                ?disabled=${!this.selectedModel?.reasoning}
                @change=${(event: Event) => this.updateThinkingLevel((event.target as HTMLSelectElement).value)}
              >
                ${THINKING_OPTIONS.map((option) => html`
                  <option .value=${option.value}>${option.label()}</option>
                `)}
              </select>
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">
                ${t('showToolDetails')}
                <quickforge-info-tip .label=${t('showToolDetailsDescription')}></quickforge-info-tip>
              </div>
              <div class="quickforge-settings-row-description">${t('showToolDetailsDescriptionShort')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.showToolDetails, (checked) => this.updateShowToolDetails(checked))}
            </div>
          </div>

          <div class="quickforge-settings-row">
            <div class="quickforge-settings-row-main">
              <div class="quickforge-settings-row-title">${t('expandToolsByDefault')}</div>
              <div class="quickforge-settings-row-description">${t('expandToolsByDefaultDescription')}</div>
            </div>
            <div class="quickforge-settings-row-control">
              ${this.renderSwitch(this.expandToolsByDefault, (checked) => this.updateExpandToolsByDefault(checked))}
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
                min="1"
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

        ${this.terminalShellSettings()}

        ${this.saved ? html`<div class="quickforge-settings-message">${this.savedMessage || t('defaultOptionsSaved')}</div>` : null}
        ${this.error ? html`<div class="quickforge-settings-alert">${this.error}</div>` : null}
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
