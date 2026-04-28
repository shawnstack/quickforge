import type { Model } from '@mariozechner/pi-ai'
import {
  AppStorage,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  type CustomProvider,
} from '@mariozechner/pi-web-ui'

export type ConnectionForm = {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  contextWindow: number
  maxTokens: number
}

export type ConnectionProfile = {
  id: string
  providerName: string
  model: Model<'openai-completions'>
  apiKey?: string
}

export const DEFAULT_CONNECTION: ConnectionForm = {
  id: 'default-litellm-anthropic',
  name: 'LiteLLM Anthropic',
  baseUrl: 'http://localhost:4000/v1',
  apiKey: '',
  modelId: 'anthropic/claude-sonnet-4',
  contextWindow: 200000,
  maxTokens: 8192,
}

export function buildConnectionModel(form: ConnectionForm): Model<'openai-completions'> {
  return {
    id: form.modelId.trim(),
    name: `${form.modelId.trim()} (${form.name.trim()})`,
    api: 'openai-completions',
    provider: form.name.trim(),
    baseUrl: form.baseUrl.trim().replace(/\/$/, ''),
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(form.contextWindow) || DEFAULT_CONNECTION.contextWindow,
    maxTokens: Number(form.maxTokens) || DEFAULT_CONNECTION.maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
    },
  }
}

export async function initializePiStorage() {
  const settings = new SettingsStore()
  const providerKeys = new ProviderKeysStore()
  const sessions = new SessionsStore()
  const customProviders = new CustomProvidersStore()

  const backend = new IndexedDBStorageBackend({
    dbName: 'fastcode-ai-chat',
    version: 1,
    stores: [
      settings.getConfig(),
      providerKeys.getConfig(),
      sessions.getConfig(),
      SessionsStore.getMetadataConfig(),
      customProviders.getConfig(),
    ],
  })

  settings.setBackend(backend)
  providerKeys.setBackend(backend)
  sessions.setBackend(backend)
  customProviders.setBackend(backend)

  const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend)
  setAppStorage(storage)

  const existing = await customProviders.get(DEFAULT_CONNECTION.id!)
  if (!existing) {
    await saveConnectionProfile(storage, DEFAULT_CONNECTION, buildConnectionModel(DEFAULT_CONNECTION))
  }

  return storage
}

export async function saveConnectionProfile(
  storage: AppStorage,
  form: ConnectionForm,
  model: Model<'openai-completions'>,
) {
  const id = form.id || crypto.randomUUID()
  const provider: CustomProvider = {
    id,
    name: form.name.trim(),
    type: 'openai-completions',
    baseUrl: model.baseUrl,
    apiKey: form.apiKey.trim() || undefined,
    models: [model],
  }

  await storage.customProviders.set(provider)

  if (form.apiKey.trim()) {
    await storage.providerKeys.set(model.provider, form.apiKey.trim())
  }

  return id
}

export async function modelToConnectionForm(
  model: Model<'openai-completions'>,
  keyResolver: (provider: string) => Promise<string>,
  id?: string,
): Promise<ConnectionForm> {
  return {
    id,
    name: model.provider,
    baseUrl: model.baseUrl,
    apiKey: await keyResolver(model.provider),
    modelId: model.id,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  }
}
