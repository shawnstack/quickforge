import {
  getAppStorage,
  SettingsTab,
  type CustomProvider,
  type CustomProviderType,
} from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import type { Api, Model } from '@mariozechner/pi-ai'
import { t } from '@/lib/i18n'
import { DEFAULT_CONNECTION, normalizeModelForProvider } from '@/lib/pi-chat'

type ProviderProtocol = Extract<CustomProviderType, 'openai-completions' | 'anthropic-messages'>
type AnyModel = Model<Api>

type ModelForm = {
  modelId: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
}

type ProviderForm = {
  providerId?: string
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  protocol: ProviderProtocol
  models: ModelForm[]
}

const emptyModelForm = (): ModelForm => ({
  modelId: '',
  contextWindow: DEFAULT_CONNECTION.contextWindow,
  maxTokens: DEFAULT_CONNECTION.maxTokens,
  reasoning: false,
})

const emptyForm = (): ProviderForm => ({
  name: DEFAULT_CONNECTION.name,
  baseUrl: DEFAULT_CONNECTION.baseUrl,
  apiKey: '',
  protocol: 'openai-completions',
  models: [emptyModelForm()],
})

export class CustomProvidersOnlyTab extends SettingsTab {
  private providers: CustomProvider[] = []
  private form: ProviderForm = emptyForm()
  private editingProviderId: string | undefined
  private formOpen = false
  private loading = true

  override async connectedCallback() {
    super.connectedCallback()
    await this.loadProviders()
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
      console.error('Failed to load custom providers:', error)
      this.providers = []
    } finally {
      this.loading = false
      this.requestUpdate()
    }
  }

  private openAddForm() {
    this.editingProviderId = undefined
    this.form = emptyForm()
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
          }))
        : [emptyModelForm()]

    this.editingProviderId = provider.id
    this.form = {
      providerId: provider.id,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      protocol: provider.type === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions',
      models,
    }
    this.formOpen = true
    this.requestUpdate()
  }

  private closeForm() {
    this.formOpen = false
    this.editingProviderId = undefined
    this.form = emptyForm()
    this.requestUpdate()
  }

  private updateForm<K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) {
    this.form = { ...this.form, [key]: value }
    this.requestUpdate()
  }

  private updateModelField(index: number, key: keyof ModelForm, value: string | number | boolean) {
    const models = this.form.models.map((model, i) =>
      i === index ? { ...model, [key]: value } : model,
    )
    this.form = { ...this.form, models }
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

  private buildModel(modelForm: ModelForm): AnyModel {
    const name = this.form.name.trim()
    const baseUrl = this.form.baseUrl.trim()
    const isReasoningModel = modelForm.reasoning === true
    const isDeepSeek = baseUrl.includes('api.deepseek.com')

    return normalizeModelForProvider({
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
                    reasoningEffortMap: {
                      minimal: 'high',
                      low: 'high',
                      medium: 'high',
                      high: 'high',
                      xhigh: 'max',
                    } as Record<string, string>,
                  }
                : {}),
            }
          : undefined,
    } satisfies AnyModel)
  }

  private async saveModel() {
    const name = this.form.name.trim()
    const baseUrl = this.form.baseUrl.trim()

    if (!name || !baseUrl) {
      alert(t('fillProviderBaseUrlModel'))
      return
    }

    // Filter out models with empty IDs
    const filledModels = this.form.models.filter((model) => model.modelId.trim())

    if (filledModels.length === 0) {
      alert(t('atLeastOneModel'))
      return
    }

    // Check for duplicate model IDs
    const ids = filledModels.map((model) => model.modelId.trim())
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      alert(t('duplicateModelId'))
      return
    }

    const models = filledModels.map((modelForm) => this.buildModel(modelForm))
    const apiKey = this.form.apiKey.trim()
    const oldProvider = this.editingProviderId
      ? this.providers.find((provider) => provider.id === this.editingProviderId)
      : undefined

    const provider: CustomProvider = {
      id: this.editingProviderId ?? crypto.randomUUID(),
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
      console.error('Failed to save custom model:', error)
      alert(t('saveCustomModelFailed'))
    }
  }

  private async deleteProvider(provider: CustomProvider) {
    if (!confirm(t('confirmDeleteProvider', { name: provider.name }))) return

    try {
      const storage = getAppStorage()
      await storage.customProviders.delete(provider.id)
      await storage.providerKeys.delete(provider.name)
      await this.loadProviders()
    } catch (error) {
      console.error('Failed to delete custom provider:', error)
      alert(t('deleteFailed'))
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

  private renderModelRow(model: ModelForm, index: number): TemplateResult {
    return html`
      <div class="rounded-md border border-border p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-muted-foreground">${t('modelIndex', { index: index + 1 })}</span>
          ${this.form.models.length > 1
            ? html`
                <button
                  class="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-destructive hover:bg-secondary"
                  type="button"
                  @click=${() => this.removeModelRow(index)}
                >
                  ✕
                </button>
              `
            : ''}
        </div>
        <div class="grid gap-3">
          <label class="grid gap-1 text-xs">
            <span class="text-muted-foreground">${t('modelId')}</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              .value=${model.modelId}
              @input=${(event: Event) =>
                this.updateModelField(index, 'modelId', (event.target as HTMLInputElement).value)}
              placeholder=${t('modelIdPlaceholder')}
            />
          </label>
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
          <label class="mt-3 flex items-center gap-2 text-xs">
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
      </div>
    `
  }

  private renderForm(): TemplateResult {
    return html`
      <div class="rounded-lg border border-border p-4">
        <div class="mb-4 text-sm font-semibold text-foreground">
          ${this.editingProviderId ? t('editCustomModel') : t('addCustomModel')}
        </div>

        <div class="grid gap-4">
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
            <span class="text-foreground">${t('protocolType')}</span>
            <select
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.form.protocol}
              @change=${(event: Event) =>
                this.updateForm('protocol', (event.target as HTMLSelectElement).value as ProviderProtocol)}
            >
              <option value="openai-completions">OpenAI Compatible / Chat Completions</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
            <span class="text-xs text-muted-foreground">
              ${t('protocolHelp')}
            </span>
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
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.form.apiKey}
              type="password"
              @input=${(event: Event) => this.updateForm('apiKey', (event.target as HTMLInputElement).value)}
              placeholder=${t('apiKeyPlaceholder')}
            />
          </label>

          <div class="grid gap-3">
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
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-md px-3 py-2 text-sm hover:bg-secondary" type="button" @click=${() => this.closeForm()}>
            ${t('cancel')}
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
            <h3 class="mb-2 text-sm font-semibold text-foreground">${t('customModelsTitle')}</h3>
            <p class="text-sm text-muted-foreground">${t('customModelsDescription')}</p>
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

export function createCustomProvidersOnlyTab() {
  return document.createElement(tagName) as CustomProvidersOnlyTab
}
