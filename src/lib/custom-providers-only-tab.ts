import {
  getAppStorage,
  SettingsTab,
  type CustomProvider,
  type CustomProviderType,
} from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import type { Api, Model } from '@earendil-works/pi-ai'
import { t } from '@/lib/i18n'
import { DEFAULT_CONNECTION, normalizeModelForProvider } from '@/lib/pi-chat'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import './info-tip'

type ProviderProtocol = Extract<CustomProviderType, 'openai-completions' | 'anthropic-messages'>
type AnyModel = Model<Api>

type ModelForm = {
  modelId: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  open?: boolean
}

type HeaderRow = { key: string; value: string }

type ProviderForm = {
  providerId?: string
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  headerRows: HeaderRow[]
  protocol: ProviderProtocol
  models: ModelForm[]
}

type PresetKey = 'openai' | 'deepseek' | 'glm' | 'ollama' | 'litellm' | 'custom'

// Preset values that get filled into the form fields. Labels for the chips come
// from i18n; these are the concrete provider/model values.
const PROVIDER_PRESETS: Record<Exclude<PresetKey, 'custom'>, {
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  modelId: string
}> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-completions', modelId: 'gpt-4o' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-completions', modelId: 'deepseek-chat' },
  glm: { name: 'Zhipu GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-completions', modelId: 'glm-4-plus' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai-completions', modelId: 'llama3.1' },
  litellm: { name: DEFAULT_CONNECTION.name, baseUrl: DEFAULT_CONNECTION.baseUrl, protocol: 'openai-completions', modelId: DEFAULT_CONNECTION.modelId },
}

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: 'openai', label: t('presetOpenai') },
  { key: 'deepseek', label: t('presetDeepseek') },
  { key: 'glm', label: t('presetGlm') },
  { key: 'ollama', label: t('presetOllama') },
  { key: 'litellm', label: t('presetLitellm') },
  { key: 'custom', label: t('presetCustom') },
]

const emptyModelForm = (): ModelForm => ({
  modelId: '',
  contextWindow: DEFAULT_CONNECTION.contextWindow,
  maxTokens: DEFAULT_CONNECTION.maxTokens,
  reasoning: true,
  open: false,
})

const emptyForm = (): ProviderForm => ({
  name: DEFAULT_CONNECTION.name,
  baseUrl: DEFAULT_CONNECTION.baseUrl,
  apiKey: '',
  headerRows: [],
  protocol: 'openai-completions',
  models: [emptyModelForm()],
})

export class CustomProvidersOnlyTab extends SettingsTab {
  private providers: CustomProvider[] = []
  private form: ProviderForm = emptyForm()
  private editingProviderId: string | undefined
  private formOpen = false
  private loading = true
  private apiKeyVisible = false

  // Progressive disclosure / connection-test UI state
  private advancedOpen = false
  private activePreset: PresetKey | '' = ''
  private testing = false
  private testResult: 'idle' | 'ok' | 'fail' = 'idle'
  private testError = ''

  public autoEditProviderName: string | null = null

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadProviders()
    if (this.autoEditProviderName) {
      const provider = this.providers.find((p) => p.name === this.autoEditProviderName)
      if (provider) {
        await this.openEditForm(provider)
      }
      this.autoEditProviderName = null
    }
  }

  override getTabName(): string {
    return t('customModels')
  }

  private async loadProviders() {
    this.loading = true
    this.requestUpdate()

    try {
      this.providers = await getAppStorage().customProviders.getAll()
    } catch (error) {
      logger.error('Failed to load custom providers:', error)
      this.providers = []
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private resetTestState() {
    this.testing = false
    this.testResult = 'idle'
    this.testError = ''
  }

  private openAddForm() {
    this.editingProviderId = undefined
    this.form = emptyForm()
    this.apiKeyVisible = false
    this.advancedOpen = false
    this.activePreset = ''
    this.resetTestState()
    this.formOpen = true
    this.requestUpdate()
  }

  private async openEditForm(provider: CustomProvider) {
    const apiKey = (await getAppStorage().providerKeys.get(provider.name)) ?? provider.apiKey ?? ''

    const existingModels = provider.models ?? []
    const models: ModelForm[] =
      existingModels.length > 0
        ? existingModels.map((model) => ({
            modelId: model.id,
            contextWindow: model.contextWindow ?? DEFAULT_CONNECTION.contextWindow,
            maxTokens: model.maxTokens ?? DEFAULT_CONNECTION.maxTokens,
            reasoning: model.reasoning === true,
            open: false,
          }))
        : [emptyModelForm()]

    const sourceHeaders = existingModels[0]?.headers ?? {}
    const headerRows: HeaderRow[] = Object.entries(sourceHeaders).map(([key, value]) => ({
      key,
      value: String(value),
    }))

    this.editingProviderId = provider.id
    this.form = {
      providerId: provider.id,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      headerRows,
      protocol: provider.type === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions',
      models,
    }
    this.apiKeyVisible = false
    this.advancedOpen = headerRows.length > 0 || provider.type === 'anthropic-messages'
    this.activePreset = ''
    this.resetTestState()
    this.formOpen = true
    this.requestUpdate()
  }

  private closeForm() {
    this.formOpen = false
    this.editingProviderId = undefined
    this.form = emptyForm()
    this.apiKeyVisible = false
    this.advancedOpen = false
    this.activePreset = ''
    this.resetTestState()
    this.requestUpdate()
  }

  private toggleApiKeyVisibility() {
    this.apiKeyVisible = !this.apiKeyVisible
    this.requestUpdate()
  }

  private updateForm<K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) {
    this.form = { ...this.form, [key]: value }
    // Manual edits to identity fields invalidate the active preset highlight.
    if (key === 'name' || key === 'baseUrl') {
      this.activePreset = ''
    }
    this.resetTestState()
    this.requestUpdate()
  }

  private updateModelField(index: number, key: keyof ModelForm, value: string | number | boolean) {
    const models = this.form.models.map((model, i) =>
      i === index ? { ...model, [key]: value } : model,
    )
    this.form = { ...this.form, models }
    if (key === 'modelId') {
      this.activePreset = ''
      this.resetTestState()
    }
    this.requestUpdate()
  }

  private addModelRow() {
    this.form = { ...this.form, models: [...this.form.models, emptyModelForm()] }
    this.requestUpdate()
  }

  private removeModelRow(index: number) {
    const models = this.form.models.filter((_, i) => i !== index)
    this.form = { ...this.form, models }
    this.requestUpdate()
  }

  private toggleModelExpanded(index: number) {
    const models = this.form.models.map((model, i) =>
      i === index ? { ...model, open: !model.open } : model,
    )
    this.form = { ...this.form, models }
    this.requestUpdate()
  }

  private addHeaderRow() {
    this.form = { ...this.form, headerRows: [...this.form.headerRows, { key: '', value: '' }] }
    this.requestUpdate()
  }

  private updateHeaderRow(index: number, field: keyof HeaderRow, value: string) {
    const headerRows = this.form.headerRows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
    )
    this.form = { ...this.form, headerRows }
    this.requestUpdate()
  }

  private removeHeaderRow(index: number) {
    const headerRows = this.form.headerRows.filter((_, i) => i !== index)
    this.form = { ...this.form, headerRows }
    this.requestUpdate()
  }

  private applyPreset(key: PresetKey) {
    this.activePreset = key
    if (key === 'custom') {
      this.form = {
        ...this.form,
        name: '',
        baseUrl: '',
        protocol: 'openai-completions',
        models: [emptyModelForm()],
      }
    } else {
      const preset = PROVIDER_PRESETS[key]
      this.form = {
        ...this.form,
        name: preset.name,
        baseUrl: preset.baseUrl,
        protocol: preset.protocol,
        models: [{ ...emptyModelForm(), modelId: preset.modelId, open: false }],
      }
    }
    this.resetTestState()
    this.requestUpdate()
  }

  // Build a headers object from the key/value rows, skipping empty rows.
  private buildHeadersFromRows(): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const row of this.form.headerRows) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (key && value) {
        headers[key] = value
      }
    }
    return headers
  }

  private buildModel(modelForm: ModelForm, headers: Record<string, string>): AnyModel {
    const name = this.form.name.trim()
    const baseUrl = this.form.baseUrl.trim()
    const isReasoningModel = modelForm.reasoning === true
    const isDeepSeek = baseUrl.includes('api.deepseek.com')

    const model = {
      id: modelForm.modelId,
      name: `${modelForm.modelId} (${name})`,
      api: this.form.protocol,
      provider: name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      reasoning: isReasoningModel,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(modelForm.contextWindow) || DEFAULT_CONNECTION.contextWindow,
      maxTokens: Number(modelForm.maxTokens) || DEFAULT_CONNECTION.maxTokens,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      thinkingLevelMap:
        isDeepSeek && isReasoningModel
          ? {
              low: 'high',
              medium: 'high',
              high: 'high',
              xhigh: 'max',
            }
          : undefined,
      compat:
        this.form.protocol === 'openai-completions'
          ? {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: isReasoningModel,
              supportsUsageInStreaming: false,
              supportsStrictMode: false,
              maxTokensField: 'max_tokens',
              // DeepSeek V4 requires reasoning_content on assistant messages in tool-call rounds
              ...(isDeepSeek && isReasoningModel
                ? {
                    requiresReasoningContentOnAssistantMessages: true,
                    thinkingFormat: 'deepseek' as const,
                  }
                : {}),
            }
          : undefined,
    } satisfies AnyModel

    return normalizeModelForProvider(model)
  }

  private async testConnection() {
    const baseUrl = this.form.baseUrl.trim()
    const firstModel = this.form.models.find((m) => m.modelId.trim())
    if (!baseUrl || !firstModel) {
      this.testing = false
      this.testResult = 'fail'
      this.testError = t('testRequiresFields')
      this.requestUpdate()
      return
    }

    const headers = this.buildHeadersFromRows()
    const model = this.buildModel(firstModel, headers)

    this.testing = true
    this.testResult = 'idle'
    this.testError = ''
    this.requestUpdate()

    try {
      const resp = await fetch('/api/models/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, apiKey: this.form.apiKey.trim() }),
      })
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (data?.ok) {
        this.testResult = 'ok'
        this.testError = ''
      } else {
        this.testResult = 'fail'
        this.testError = data?.error || t('connectionFailed')
      }
    } catch (error) {
      this.testResult = 'fail'
      this.testError = (error as Error)?.message || t('connectionFailed')
    } finally {
      this.testing = false
      this.requestUpdate()
    }
  }

  private async saveModel() {
    const name = this.form.name.trim()
    const baseUrl = this.form.baseUrl.trim()

    if (!name || !baseUrl) {
      void showAlert(t('fillProviderBaseUrlModel'))
      return
    }

    // Filter out models with empty IDs
    const filledModels = this.form.models.filter((model) => model.modelId.trim())

    if (filledModels.length === 0) {
      void showAlert(t('atLeastOneModel'))
      return
    }

    // Check for duplicate model IDs
    const ids = filledModels.map((model) => model.modelId.trim())
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      void showAlert(t('duplicateModelId'))
      return
    }

    const headers = this.buildHeadersFromRows()
    const models = filledModels.map((modelForm) => this.buildModel(modelForm, headers))
    const apiKey = this.form.apiKey.trim()
    const oldProvider = this.editingProviderId
      ? this.providers.find((provider) => provider.id === this.editingProviderId)
      : undefined

    const provider: CustomProvider = {
      id: this.editingProviderId ?? randomId(),
      name,
      type: this.form.protocol,
      baseUrl: models[0].baseUrl,
      apiKey: apiKey || undefined,
      models,
    }

    try {
      const storage = getAppStorage()
      await storage.customProviders.set(provider)
      if (oldProvider && oldProvider.name !== provider.name) {
        await storage.providerKeys.delete(oldProvider.name)
      }
      if (apiKey) {
        await storage.providerKeys.set(provider.name, apiKey)
      } else {
        await storage.providerKeys.delete(provider.name)
      }
      this.closeForm()
      await this.loadProviders()
    } catch (error) {
      logger.error('Failed to save custom model:', error)
      void showAlert(t('saveCustomModelFailed'))
    }
  }

  private async deleteProvider(provider: CustomProvider) {
    const confirmed = await showConfirm({
      description: t('confirmDeleteProvider', { name: provider.name }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      const storage = getAppStorage()
      await storage.customProviders.delete(provider.id)
      await storage.providerKeys.delete(provider.name)
      await this.loadProviders()
    } catch (error) {
      logger.error('Failed to delete custom provider:', error)
      void showAlert(t('deleteFailed'))
    }
  }

  private renderProvider(provider: CustomProvider): TemplateResult {
    const models = provider.models ?? []
    const modelCount = models.length

    return html`
      <div class="rounded-lg border border-border p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-foreground">${provider.name}</div>
            <div class="mt-1 break-all text-xs text-muted-foreground">${provider.baseUrl}</div>
            <div class="mt-2 text-xs text-muted-foreground">
              ${t('providerProtocol')}: ${provider.type === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Compatible'}
            </div>
            ${modelCount === 0
              ? html`<div class="mt-1 text-xs text-muted-foreground">${t('noModelAdded')}</div>`
              : html`
                  <div class="mt-2 text-xs text-muted-foreground">${t('modelsCount', { count: modelCount })}</div>
                  <div class="mt-1 flex flex-wrap gap-1">
                    ${models.map(
                      (model) => html`
                        <span class="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-foreground">
                          <span class="font-medium">${model.id}</span>
                          <span class="text-muted-foreground">${model.contextWindow}/${model.maxTokens}</span>
                        </span>
                      `,
                    )}
                  </div>
                `}
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              class="rounded-md px-3 py-1.5 text-sm hover:bg-secondary"
              type="button"
              @click=${() => this.openEditForm(provider)}
            >
              ${t('editModel')}
            </button>
            <button
              class="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-secondary"
              type="button"
              @click=${() => this.deleteProvider(provider)}
            >
              ${t('delete')}
            </button>
          </div>
        </div>
      </div>
    `
  }

  private renderPresetChips(): TemplateResult {
    return html`
      <div class="grid gap-1.5">
        <span class="text-xs text-muted-foreground">${t('presets')}</span>
        <div class="flex flex-wrap gap-1.5">
          ${PRESET_OPTIONS.map((option) => {
            const active = this.activePreset === option.key
            return html`
              <button
                class="rounded-full border px-3 py-1 text-xs ${active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'}"
                type="button"
                @click=${() => this.applyPreset(option.key)}
              >
                ${option.label}
              </button>
            `
          })}
        </div>
      </div>
    `
  }

  private renderModelRow(model: ModelForm, index: number): TemplateResult {
    const expanded = model.open === true
    return html`
      <div class="rounded-md border border-border">
        <div class="flex items-center gap-2 p-2">
          <button
            class="shrink-0 inline-flex size-6 items-center justify-center rounded text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            type="button"
            title=${t('expandModel')}
            aria-expanded=${expanded ? 'true' : 'false'}
            @click=${() => this.toggleModelExpanded(index)}
          >
            ${expanded ? '▾' : '▸'}
          </button>
          <input
            class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
            .value=${model.modelId}
            @input=${(event: Event) =>
              this.updateModelField(index, 'modelId', (event.target as HTMLInputElement).value)}
            placeholder=${t('modelIdPlaceholder')}
          />
          ${this.form.models.length > 1
            ? html`
                <button
                  class="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                  type="button"
                  title=${t('delete')}
                  @click=${() => this.removeModelRow(index)}
                >
                  ✕
                </button>
              `
            : ''}
        </div>
        ${expanded
          ? html`
              <div class="grid gap-3 border-t border-border p-3">
                <div class="grid grid-cols-2 gap-3">
                  <label class="grid gap-1 text-xs">
                    <span class="text-muted-foreground">${t('contextWindow')}</span>
                    <input
                      class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      .value=${String(model.contextWindow)}
                      type="number"
                      @input=${(event: Event) =>
                        this.updateModelField(index, 'contextWindow', Number((event.target as HTMLInputElement).value))}
                    />
                  </label>
                  <label class="grid gap-1 text-xs">
                    <span class="text-muted-foreground">${t('maxTokens')}</span>
                    <input
                      class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      .value=${String(model.maxTokens)}
                      type="number"
                      @input=${(event: Event) =>
                        this.updateModelField(index, 'maxTokens', Number((event.target as HTMLInputElement).value))}
                    />
                  </label>
                </div>
                <label class="mt-1 flex items-center gap-2 text-xs">
                  <input
                    class="rounded border-border"
                    type="checkbox"
                    .checked=${model.reasoning}
                    @change=${(event: Event) =>
                      this.updateModelField(index, 'reasoning', (event.target as HTMLInputElement).checked)}
                  />
                  <span class="text-muted-foreground">${t('reasoningModel')}</span>
                </label>
              </div>
            `
          : ''}
      </div>
    `
  }

  private renderHeadersEditor(): TemplateResult {
    return html`
      <div class="grid gap-1.5">
        <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          ${t('customHeaders')}
          <quickforge-info-tip .label=${t('customHeadersHelp')}></quickforge-info-tip>
        </span>
        ${this.form.headerRows.length === 0
          ? html``
          : html`
              <div class="grid gap-2">
                ${this.form.headerRows.map((row, index) => html`
                  <div class="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                    <input
                      class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      .value=${row.key}
                      @input=${(event: Event) =>
                        this.updateHeaderRow(index, 'key', (event.target as HTMLInputElement).value)}
                      placeholder=${t('headerName')}
                    />
                    <input
                      class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                      .value=${row.value}
                      @input=${(event: Event) =>
                        this.updateHeaderRow(index, 'value', (event.target as HTMLInputElement).value)}
                      placeholder=${t('headerValue')}
                    />
                    <button
                      class="shrink-0 rounded px-1.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-destructive"
                      type="button"
                      title=${t('removeHeader')}
                      @click=${() => this.removeHeaderRow(index)}
                    >
                      ✕
                    </button>
                  </div>
                `)}
              </div>
            `}
        <button
          class="justify-self-start rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          type="button"
          @click=${() => this.addHeaderRow()}
        >
          + ${t('addHeader')}
        </button>
      </div>
    `
  }

  private renderTestStatus(): TemplateResult {
    if (this.testResult === 'idle' && !this.testing) return html``
    if (this.testing) {
      return html`<span class="text-xs text-muted-foreground">${t('testingConnection')}</span>`
    }
    if (this.testResult === 'ok') {
      return html`<span class="text-xs text-green-600">✓ ${t('connectionOk')}</span>`
    }
    return html`<span class="break-all text-xs text-destructive">✗ ${this.testError || t('connectionFailed')}</span>`
  }

  private renderForm(): TemplateResult {
    return html`
      <div class="rounded-lg border border-border p-4">
        <div class="mb-4 text-sm font-semibold text-foreground">
          ${this.editingProviderId ? t('editCustomModel') : t('addCustomModel')}
        </div>

        <div class="grid gap-4">
          ${this.renderPresetChips()}

          <label class="grid gap-1.5 text-sm">
            <span class="text-foreground">${t('providerName')}</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.form.name}
              @input=${(event: Event) => this.updateForm('name', (event.target as HTMLInputElement).value)}
              placeholder=${t('providerNamePlaceholder')}
            />
          </label>

          <label class="grid gap-1.5 text-sm">
            <span class="text-foreground">Base URL</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.form.baseUrl}
              @input=${(event: Event) => this.updateForm('baseUrl', (event.target as HTMLInputElement).value)}
              placeholder=${this.form.protocol === 'anthropic-messages'
                ? 'e.g., https://api.anthropic.com'
                : 'e.g., http://localhost:4000/v1'}
            />
          </label>

          <label class="grid gap-1.5 text-sm">
            <span class="text-foreground">${t('apiKey')}</span>
            <div class="relative">
              <input
                class="w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm"
                .value=${this.form.apiKey}
                type=${this.apiKeyVisible ? 'text' : 'password'}
                @input=${(event: Event) => this.updateForm('apiKey', (event.target as HTMLInputElement).value)}
                placeholder=${t('apiKeyPlaceholder')}
              />
              <button
                class="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                type="button"
                title=${this.apiKeyVisible ? t('hideApiKey') : t('showApiKey')}
                aria-label=${this.apiKeyVisible ? t('hideApiKey') : t('showApiKey')}
                aria-pressed=${this.apiKeyVisible ? 'true' : 'false'}
                @click=${() => this.toggleApiKeyVisibility()}
              >
                ${this.apiKeyVisible
                  ? html`<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M8.53 8.53A5 5 0 0 0 12 17a5 5 0 0 0 3.47-8.53"/></svg>`
                  : html`<svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`}
              </button>
            </div>
          </label>

          <div class="grid gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-foreground">${t('modelsList')}</span>
              <button
                class="rounded-md px-2 py-1 text-xs hover:bg-secondary"
                type="button"
                @click=${() => this.addModelRow()}
              >
                + ${t('addModel')}
              </button>
            </div>
            ${this.form.models.map((model, index) => this.renderModelRow(model, index))}
          </div>

          <button
            class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            type="button"
            aria-expanded=${this.advancedOpen ? 'true' : 'false'}
            @click=${() => {
              this.advancedOpen = !this.advancedOpen
              this.requestUpdate()
            }}
          >
            <span>${this.advancedOpen ? '▾' : '▸'}</span>
            ${t('providerAdvanced')}
          </button>

          ${this.advancedOpen
            ? html`
                <div class="grid gap-4 rounded-md border border-border p-3">
                  <label class="grid gap-1.5 text-sm">
                    <span class="inline-flex items-center gap-1.5 text-foreground">
                      ${t('protocolType')}
                      <quickforge-info-tip .label=${t('protocolHelp')}></quickforge-info-tip>
                    </span>
                    <select
                      class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                      .value=${this.form.protocol}
                      @change=${(event: Event) =>
                        this.updateForm('protocol', (event.target as HTMLSelectElement).value as ProviderProtocol)}
                    >
                      <option value="openai-completions">OpenAI Compatible / Chat Completions</option>
                      <option value="anthropic-messages">Anthropic Messages</option>
                    </select>
                  </label>
                  ${this.renderHeadersEditor()}
                </div>
              `
            : ''}
        </div>

        <div class="mt-4 flex items-center gap-2">
          <span class="mr-auto">${this.renderTestStatus()}</span>
          <button
            class="rounded-md px-3 py-2 text-sm hover:bg-secondary"
            type="button"
            @click=${() => this.closeForm()}
          >
            ${t('cancel')}
          </button>
          <button
            class="rounded-md px-3 py-2 text-sm hover:bg-secondary ${this.testing ? 'opacity-50 pointer-events-none' : ''}"
            type="button"
            ?disabled=${this.testing}
            @click=${() => this.testConnection()}
          >
            ${t('testConnection')}
          </button>
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            type="button"
            @click=${() => this.saveModel()}
          >
            ${t('save')}
          </button>
        </div>
      </div>
    `
  }

  override render(): TemplateResult {
    return html`
      <div class="flex flex-col gap-6">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h3 class="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              ${t('customModelsTitle')}
              <quickforge-info-tip .label=${t('customModelsDescription')}></quickforge-info-tip>
            </h3>
          </div>
          <button
            class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            type="button"
            @click=${() => this.openAddForm()}
          >
            ${t('addModel')}
          </button>
        </div>

        ${this.formOpen ? this.renderForm() : ''}

        ${this.loading
          ? html`<div class="py-8 text-center text-sm text-muted-foreground">${t('loading')}</div>`
          : this.providers.length === 0
            ? html`<div class="py-8 text-center text-sm text-muted-foreground">${t('noCustomModels')}</div>`
            : html`<div class="flex flex-col gap-3">${this.providers.map((provider) => this.renderProvider(provider))}</div>`}
      </div>
    `
  }
}

const tagName = 'quickforge-custom-providers-only-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, CustomProvidersOnlyTab)
}

export function createCustomProvidersOnlyTab(autoEditProviderName?: string) {
  const el = document.createElement(tagName) as CustomProvidersOnlyTab
  if (autoEditProviderName) {
    el.autoEditProviderName = autoEditProviderName
  }
  return el
}
