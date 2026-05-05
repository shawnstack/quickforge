import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model } from '@mariozechner/pi-ai'
import { getAppStorage, SettingsTab } from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import {
  defaultThinkingLevelForModel,
  getConfiguredModels,
  loadDefaultOptions,
  saveDefaultOptions,
} from '@/lib/pi-chat'
import { t } from '@/lib/i18n'

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
      const [models, defaults] = await Promise.all([
        getConfiguredModels(storage),
        loadDefaultOptions(storage),
      ])
      this.models = models
      this.selectedModel = defaults.model
        ? models.find((model) => modelKey(model) === modelKey(defaults.model!)) ?? defaults.model
        : models[0]
      this.thinkingLevel = defaults.thinkingLevel ?? defaultThinkingLevelForModel(this.selectedModel)
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
          <h3 class="mb-2 text-sm font-semibold text-foreground">${t('defaultOptions')}</h3>
          <p class="text-sm text-muted-foreground">${t('defaultOptionsDescription')}</p>
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
