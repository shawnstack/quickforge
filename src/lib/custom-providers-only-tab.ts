import {
  getAppStorage,
  SettingsTab,
  type CustomProvider,
  type CustomProviderType,
} from '@mariozechner/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import type { Api, Model } from '@mariozechner/pi-ai'
import { t } from '@/lib/i18n'
import { DEFAULT_CONNECTION, type ConnectionForm } from '@/lib/pi-chat'

type ProviderProtocol = Extract<CustomProviderType, 'openai-completions' | 'anthropic-messages'>
type AnyModel = Model<Api>
type ProviderForm = ConnectionForm & { providerId?: string; protocol: ProviderProtocol }

const emptyForm = (): ProviderForm => ({
  name: DEFAULT_CONNECTION.name,
  baseUrl: DEFAULT_CONNECTION.baseUrl,
  apiKey: '',
  modelId: DEFAULT_CONNECTION.modelId,
  contextWindow: DEFAULT_CONNECTION.contextWindow,
  maxTokens: DEFAULT_CONNECTION.maxTokens,
  protocol: 'openai-completions',
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
    const model = provider.models?.[0]
    const apiKey = (await getAppStorage().providerKeys.get(provider.name)) ?? provider.apiKey ?? ''

    this.editingProviderId = provider.id
    this.form = {
      providerId: provider.id,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      modelId: model?.id ?? '',
      protocol: provider.type === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions',
      contextWindow: model?.contextWindow ?? DEFAULT_CONNECTION.contextWindow,
      maxTokens: model?.maxTokens ?? DEFAULT_CONNECTION.maxTokens,
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

  private buildModel(name: string, baseUrl: string, modelId: string): AnyModel {
    return {
      id: modelId,
      name: `${modelId} (${name})`,
      api: this.form.protocol,
      provider: name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(this.form.contextWindow) || DEFAULT_CONNECTION.contextWindow,
      maxTokens: Number(this.form.maxTokens) || DEFAULT_CONNECTION.maxTokens,
      compat:
        this.form.protocol === 'openai-completions'
          ? {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: false,
              supportsUsageInStreaming: false,
              supportsStrictMode: false,
              maxTokensField: 'max_tokens',
            }
          : undefined,
    } satisfies AnyModel
  }

  private async saveModel() {
    const name = this.form.name.trim()
    const baseUrl = this.form.baseUrl.trim()
    const modelId = this.form.modelId.trim()

    if (!name || !baseUrl || !modelId) {
      alert(t('fillProviderBaseUrlModel'))
      return
    }

    const model = this.buildModel(name, baseUrl, modelId)
    const apiKey = this.form.apiKey.trim()
    const oldProvider = this.editingProviderId
      ? this.providers.find((provider) => provider.id === this.editingProviderId)
      : undefined

    const provider: CustomProvider = {
      id: this.editingProviderId ?? crypto.randomUUID(),
      name,
      type: this.form.protocol,
      baseUrl: model.baseUrl,
      apiKey: apiKey || undefined,
      models: [model],
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
    const model = provider.models?.[0]
    const modelCount = provider.models?.length ?? 0

    return html`
      <div class="rounded-lg border border-border p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-foreground">${provider.name}</div>
            <div class="mt-1 break-all text-xs text-muted-foreground">${provider.baseUrl}</div>
            <div class="mt-2 text-xs text-muted-foreground">
              ${t('providerProtocol')}: ${provider.type === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Compatible'}
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              ${t('model')}: ${model?.id ?? t('noModelAdded')}${modelCount > 1 ? ` ${t('andMoreModels', { count: modelCount })}` : ''}
            </div>
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
              @change=${(event: Event) => this.updateForm('protocol', (event.target as HTMLSelectElement).value as ProviderProtocol)}
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
              placeholder=${this.form.protocol === 'anthropic-messages' ? 'e.g., https://api.anthropic.com' : 'e.g., http://localhost:4000/v1'}
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

          <label class="grid gap-1.5 text-sm">
            <span class="text-foreground">${t('modelId')}</span>
            <input
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
              .value=${this.form.modelId}
              @input=${(event: Event) => this.updateForm('modelId', (event.target as HTMLInputElement).value)}
              placeholder=${t('modelIdPlaceholder')}
            />
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm">
              <span class="text-foreground">${t('contextWindow')}</span>
              <input
                class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                .value=${String(this.form.contextWindow)}
                type="number"
                @input=${(event: Event) =>
                  this.updateForm('contextWindow', Number((event.target as HTMLInputElement).value))}
              />
            </label>

            <label class="grid gap-1.5 text-sm">
              <span class="text-foreground">${t('maxTokens')}</span>
              <input
                class="rounded-md border border-input bg-background px-3 py-2 text-sm"
                .value=${String(this.form.maxTokens)}
                type="number"
                @input=${(event: Event) => this.updateForm('maxTokens', Number((event.target as HTMLInputElement).value))}
              />
            </label>
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button class="rounded-md px-3 py-2 text-sm hover:bg-secondary" type="button" @click=${() => this.closeForm()}>
            ${t('cancel')}
          </button>
          <button class="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" type="button" @click=${() => this.saveModel()}>
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

const tagName = 'fastcode-custom-providers-only-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, CustomProvidersOnlyTab)
}

export function createCustomProvidersOnlyTab() {
  return document.createElement(tagName) as CustomProvidersOnlyTab
}
