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
import {
  loadFontSizeSettings,
  saveFontSizeSettings,
} from '@/lib/font-size-settings'
import { t } from '@/lib/i18n'
import './info-tip'

type AnyModel = Model<Api>

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
  private autoCompactKeepRecentTurns = 2
  private baseFontSizePx = 14
  private bodyFontSizePx = 12
  private loading = true
  private saved = false
  private error = ''

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
  }

  private async loadSettings() {
    this.loading = true
    this.error = ''
    this.requestUpdate()

    try {
      const storage = getAppStorage()
      const [models, defaults, toolDisplaySettings, autoCompactSettings, fontSizeSettings] = await Promise.all([
        getConfiguredModels(storage),
        loadDefaultOptions(storage),
        loadToolDisplaySettings(storage),
        loadAutoCompactSettings(storage),
        loadFontSizeSettings(storage),
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
      this.baseFontSizePx = fontSizeSettings.baseFontSizePx
      this.bodyFontSizePx = fontSizeSettings.bodyFontSizePx
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
  }

  private updateThinkingLevel(value: string) {
    this.thinkingLevel = THINKING_OPTIONS.some((option) => option.value === value) ? value as ThinkingLevel : 'off'
    this.saved = false
    this.requestUpdate()
  }

  private updateShowToolDetails(checked: boolean) {
    this.showToolDetails = checked
    this.saved = false
    this.requestUpdate()
  }

  private updateExpandToolsByDefault(checked: boolean) {
    this.expandToolsByDefault = checked
    this.saved = false
    this.requestUpdate()
  }

  private updateAutoCompactEnabled(checked: boolean) {
    this.autoCompactEnabled = checked
    this.saved = false
    this.requestUpdate()
  }

  private updateAutoCompactRequireConfirmation(checked: boolean) {
    this.autoCompactRequireConfirmation = checked
    this.saved = false
    this.requestUpdate()
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
    this.autoCompactKeepRecentTurns = Number(value) || 2
    this.saved = false
    this.requestUpdate()
  }

  private updateBaseFontSize(value: string) {
    this.baseFontSizePx = Number(value) || 14
    this.saved = false
    this.requestUpdate()
  }

  private updateBodyFontSize(value: string) {
    this.bodyFontSizePx = Number(value) || 12
    this.saved = false
    this.requestUpdate()
  }

  private modelOptions() {
    if (!this.selectedModel) return this.models

    const selectedKey = modelKey(this.selectedModel)
    const exists = this.models.some((model) => modelKey(model) === selectedKey)
    return exists ? this.models : [this.selectedModel, ...this.models]
  }

  private async save() {
    try {
      const thinkingLevel = this.selectedModel?.reasoning ? this.thinkingLevel : 'off'
      await saveDefaultOptions(getAppStorage(), {
        model: this.selectedModel,
        thinkingLevel,
      })
      await saveToolDisplaySettings(getAppStorage(), {
        showToolDetails: this.showToolDetails,
        expandToolsByDefault: this.expandToolsByDefault,
      })
      await saveAutoCompactSettings(getAppStorage(), {
        enabled: this.autoCompactEnabled,
        thresholdPercent: this.autoCompactThresholdPercent,
        keepRecentTurns: this.autoCompactKeepRecentTurns,
        minSourceChars: 1600,
        requireConfirmation: this.autoCompactRequireConfirmation,
      })
      await saveFontSizeSettings(getAppStorage(), {
        baseFontSizePx: this.baseFontSizePx,
        bodyFontSizePx: this.bodyFontSizePx,
      })
      await this.loadSettings()
      this.saved = true
      this.error = ''
      this.requestUpdate()
    } catch (error) {
      this.error = error instanceof Error ? error.message : t('requestFailed')
      this.requestUpdate()
    }
  }

  override render(): TemplateResult {
    if (this.loading) {
      return html`<div class="text-sm text-muted-foreground">${t('loading')}</div>`
    }

    return html`
      <div class="flex flex-col gap-6">
        <div>
          <h3 class="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            ${t('defaultOptions')}
            <quickforge-info-tip .label=${t('defaultOptionsDescription')}></quickforge-info-tip>
          </h3>
        </div>

        <label class="grid max-w-md gap-1.5 text-sm">
          <span class="text-foreground">${t('defaultModel')}</span>
          <select
            data-default-model-select
            class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            .value=${this.selectedModel ? modelKey(this.selectedModel) : ''}
            @change=${(event: Event) => this.updateModel((event.target as HTMLSelectElement).value)}
          >
            ${this.modelOptions().length === 0
              ? html`<option value="">${t('noModelAvailable')}</option>`
              : this.modelOptions().map((model) => html`
                  <option .value=${modelKey(model)}>${modelLabel(model)}</option>
                `)}
          </select>
        </label>

        <label class="grid max-w-sm gap-1.5 text-sm">
          <span class="text-foreground">${t('defaultThinkingLevel')}</span>
          <select
            data-default-thinking-select
            class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            .value=${this.thinkingLevel}
            ?disabled=${!this.selectedModel?.reasoning}
            @change=${(event: Event) => this.updateThinkingLevel((event.target as HTMLSelectElement).value)}
          >
            ${THINKING_OPTIONS.map((option) => html`
              <option .value=${option.value}>${option.label()}</option>
            `)}
          </select>
          ${!this.selectedModel?.reasoning
            ? html`<span class="text-xs text-muted-foreground">${t('thinkingRequiresReasoningModel')}</span>`
            : null}
        </label>

        <div class="grid max-w-xl gap-3 rounded-lg border border-border p-4">
          <div>
            <h4 class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              ${t('toolDisplay')}
              <quickforge-info-tip .label=${t('showToolDetailsDescription')}></quickforge-info-tip>
            </h4>
          </div>
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              class="size-4 rounded border-input"
              .checked=${this.showToolDetails}
              @change=${(event: Event) => this.updateShowToolDetails((event.target as HTMLInputElement).checked)}
            />
            <span>${t('showToolDetails')}</span>
          </label>
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              class="size-4 rounded border-input"
              .checked=${this.expandToolsByDefault}
              @change=${(event: Event) => this.updateExpandToolsByDefault((event.target as HTMLInputElement).checked)}
            />
            <span>${t('expandToolsByDefault')}</span>
          </label>
        </div>

        <div class="grid max-w-xl gap-3 rounded-lg border border-border p-4">
          <div>
            <h4 class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              ${t('fontSize')}
              <quickforge-info-tip .label=${t('fontSizeDescription')}></quickforge-info-tip>
            </h4>
          </div>
          <label class="grid max-w-xs gap-1.5 text-sm">
            <span class="text-foreground">${t('baseFontSize')}</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              type="number"
              min="12"
              max="18"
              step="1"
              .value=${String(this.baseFontSizePx)}
              @input=${(event: Event) => this.updateBaseFontSize((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="grid max-w-xs gap-1.5 text-sm">
            <span class="inline-flex items-center gap-1.5 text-foreground">
              ${t('bodyFontSize')}
              <quickforge-info-tip .label=${t('bodyFontSizeNote')}></quickforge-info-tip>
            </span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              type="number"
              min="11"
              max="16"
              step="1"
              .value=${String(this.bodyFontSizePx)}
              @input=${(event: Event) => this.updateBodyFontSize((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="grid max-w-xl gap-3 rounded-lg border border-border p-4">
          <div>
            <h4 class="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              ${t('contextManagement')}
              <quickforge-info-tip .label=${t('autoCompactDescription')}></quickforge-info-tip>
            </h4>
          </div>
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              class="size-4 rounded border-input"
              .checked=${this.autoCompactEnabled}
              @change=${(event: Event) => this.updateAutoCompactEnabled((event.target as HTMLInputElement).checked)}
            />
            <span class="inline-flex items-center gap-1.5">
              ${t('autoCompactEnabled')}
              <quickforge-info-tip .label=${t('autoCompactTriggerNote')}></quickforge-info-tip>
            </span>
          </label>
          <label class="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              class="size-4 rounded border-input disabled:opacity-60"
              .checked=${this.autoCompactRequireConfirmation}
              ?disabled=${!this.autoCompactEnabled}
              @change=${(event: Event) => this.updateAutoCompactRequireConfirmation((event.target as HTMLInputElement).checked)}
            />
            <span>${t('autoCompactRequireConfirmation')}</span>
          </label>
          <label class="grid max-w-xs gap-1.5 text-sm">
            <span class="text-foreground">${t('autoCompactThresholdPercent')}</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              type="number"
              min="50"
              max="95"
              step="1"
              .value=${this.autoCompactThresholdPercentInput}
              ?disabled=${!this.autoCompactEnabled}
              @input=${(event: Event) => this.updateAutoCompactThresholdPercent((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="grid max-w-xs gap-1.5 text-sm">
            <span class="inline-flex items-center gap-1.5 text-foreground">
              ${t('autoCompactKeepRecentTurns')}
              <quickforge-info-tip .label=${t('autoCompactHistoryPreserved')}></quickforge-info-tip>
            </span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
              type="number"
              min="1"
              max="20"
              step="1"
              .value=${String(this.autoCompactKeepRecentTurns)}
              ?disabled=${!this.autoCompactEnabled}
              @input=${(event: Event) => this.updateAutoCompactKeepRecentTurns((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>

        <div class="flex items-center gap-3">
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
            type="button"
            ?disabled=${!this.selectedModel}
            @click=${() => this.save()}
          >
            ${t('saveDefaultOptions')}
          </button>
          ${this.saved ? html`<span class="text-sm text-muted-foreground">${t('defaultOptionsSaved')}</span>` : null}
          ${this.error ? html`<span class="text-sm text-destructive">${this.error}</span>` : null}
        </div>
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
