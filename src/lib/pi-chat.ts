import type { Api, Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai'
import {
  AppStorage,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  type CustomProvider,
  type StorageBackend,
} from '@mariozechner/pi-web-ui'
import { HttpStorageBackend } from '@/lib/http-storage-backend'

const ACTIVE_MODEL_SETTING_KEY = 'active-model'
const YOLO_MODE_SETTING_KEY = 'yolo-mode'
const INDEXEDDB_MIGRATION_SETTING_KEY = 'indexeddb-migrated-to-local-files-v1'
const INDEXEDDB_DB_NAME = 'quickforge-ai-chat'
const LEGACY_INDEXEDDB_DB_NAME = 'fastcode-ai-chat'

export type ConnectionForm = {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  contextWindow: number
  maxTokens: number
  /** Whether the model supports thinking/reasoning (DeepSeek V4, Qwen, etc.). */
  reasoning?: boolean
}

export type StoreBundle = {
  settings: SettingsStore
  providerKeys: ProviderKeysStore
  sessions: SessionsStore
  customProviders: CustomProvidersStore
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

function isDeepSeekThinkingModelInfo(modelId: string, baseUrl: string, provider = '') {
  const normalizedModelId = modelId.toLowerCase()
  const normalizedBaseUrl = baseUrl.toLowerCase()
  const normalizedProvider = provider.toLowerCase()
  return (
    normalizedModelId.includes('deepseek-v4') &&
    (normalizedProvider.includes('deepseek') ||
      normalizedBaseUrl.includes('api.deepseek.com') ||
      normalizedBaseUrl.includes('deepseek.com'))
  )
}

function deepSeekThinkingCompat(): OpenAICompletionsCompat {
  return {
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: 'deepseek',
    reasoningEffortMap: {
      low: 'high',
      medium: 'high',
      high: 'high',
      xhigh: 'max',
    },
  }
}

function inferCustomThinkingFormat(provider: string, baseUrl: string): NonNullable<OpenAICompletionsCompat['thinkingFormat']> {
  const normalizedProvider = provider.toLowerCase()
  const normalizedBaseUrl = baseUrl.toLowerCase()

  if (
    normalizedProvider.includes('deepseek') ||
    normalizedBaseUrl.includes('api.deepseek.com') ||
    normalizedBaseUrl.includes('deepseek.com')
  ) {
    return 'deepseek'
  }

  if (normalizedBaseUrl.includes('openrouter.ai')) return 'openrouter'

  if (
    normalizedProvider === 'zai' ||
    normalizedBaseUrl.includes('bigmodel.cn') ||
    normalizedBaseUrl.includes('z.ai')
  ) {
    return 'zai'
  }

  // Provider names in QuickForge are user-facing labels.  A custom proxy can be
  // named "OpenRouter" while still expecting the OpenAI-compatible
  // `reasoning_effort` parameter.  Pin the default to OpenAI format so pi-ai's
  // provider-name auto-detection does not accidentally switch such proxies to
  // OpenRouter's nested `reasoning: { effort }` request shape.
  return 'openai'
}

function normalizeOpenAICompat(model: Model<'openai-completions'>): Model<'openai-completions'> {
  const compat: OpenAICompletionsCompat = {
    ...model.compat,
    ...(model.reasoning === true && model.compat?.supportsReasoningEffort === undefined
      ? { supportsReasoningEffort: true }
      : {}),
    thinkingFormat: model.compat?.thinkingFormat ?? inferCustomThinkingFormat(model.provider, model.baseUrl),
  }

  return {
    ...model,
    compat,
  }
}

export function normalizeModelForProvider<TApi extends Api>(model: Model<TApi>): Model<TApi> {
  if (model.api !== 'openai-completions') return model

  const openAiModel = normalizeOpenAICompat(model as unknown as Model<'openai-completions'>)
  if (!isDeepSeekThinkingModelInfo(openAiModel.id, openAiModel.baseUrl, openAiModel.provider)) {
    return openAiModel as unknown as Model<TApi>
  }

  return {
    ...openAiModel,
    reasoning: true,
    compat: {
      ...openAiModel.compat,
      supportsReasoningEffort: true,
      ...deepSeekThinkingCompat(),
    },
  } as unknown as Model<TApi>
}

export function buildConnectionModel(form: ConnectionForm): Model<'openai-completions'> {
  const baseUrl = form.baseUrl.trim().replace(/\/$/, '')
  const modelId = form.modelId.trim()
  const provider = form.name.trim()
  const isDeepSeekThinking = isDeepSeekThinkingModelInfo(modelId, baseUrl, provider)
  const isReasoningModel = form.reasoning === true || isDeepSeekThinking

  return normalizeModelForProvider({
    id: modelId,
    name: `${modelId} (${provider})`,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: isReasoningModel,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(form.contextWindow) || DEFAULT_CONNECTION.contextWindow,
    maxTokens: Number(form.maxTokens) || DEFAULT_CONNECTION.maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: isReasoningModel,
      supportsUsageInStreaming: false,
      supportsStrictMode: false,
      maxTokensField: 'max_tokens',
      // DeepSeek V4 requires reasoning_content on assistant messages in tool-call rounds
      ...(isDeepSeekThinking ? deepSeekThinkingCompat() : {}),
    },
  })
}

function createStores(): StoreBundle {
  return {
    settings: new SettingsStore(),
    providerKeys: new ProviderKeysStore(),
    sessions: new SessionsStore(),
    customProviders: new CustomProvidersStore(),
  }
}

function getStoreConfigs(stores: StoreBundle) {
  return [
    stores.settings.getConfig(),
    stores.providerKeys.getConfig(),
    stores.sessions.getConfig(),
    SessionsStore.getMetadataConfig(),
    stores.customProviders.getConfig(),
  ]
}

function attachBackend(stores: StoreBundle, backend: StorageBackend) {
  stores.settings.setBackend(backend)
  stores.providerKeys.setBackend(backend)
  stores.sessions.setBackend(backend)
  stores.customProviders.setBackend(backend)
}

function createIndexedDbBackend(stores: StoreBundle, dbName = INDEXEDDB_DB_NAME) {
  return new IndexedDBStorageBackend({
    dbName,
    version: 1,
    stores: getStoreConfigs(stores),
  })
}

async function copyStoreIfMissing(source: StorageBackend, target: StorageBackend, storeName: string) {
  const keys = await source.keys(storeName)
  for (const key of keys) {
    if (await target.has(storeName, key)) continue
    const value = await source.get(storeName, key)
    if (value !== null) await target.set(storeName, key, value)
  }
}

async function migrateIndexedDbStores(target: StorageBackend, stores: StoreBundle, dbName: string) {
  const indexedDbStores = createStores()
  const indexedDbBackend = createIndexedDbBackend(indexedDbStores, dbName)

  for (const store of getStoreConfigs(stores)) {
    await copyStoreIfMissing(indexedDbBackend, target, store.name)
  }
}

async function migrateLegacyIndexedDb(target: StorageBackend, stores: StoreBundle) {
  try {
    await migrateIndexedDbStores(target, stores, LEGACY_INDEXEDDB_DB_NAME)
  } catch (error) {
    console.warn('Failed to migrate legacy IndexedDB data:', error)
  }
}

async function migrateIndexedDbToLocalFiles(target: StorageBackend, stores: StoreBundle) {
  const alreadyMigrated = await target.get<boolean>('settings', INDEXEDDB_MIGRATION_SETTING_KEY)
  if (alreadyMigrated) return

  try {
    await migrateIndexedDbStores(target, stores, INDEXEDDB_DB_NAME)
    await migrateLegacyIndexedDb(target, stores)
    await target.set('settings', INDEXEDDB_MIGRATION_SETTING_KEY, true)
  } catch (error) {
    console.warn('Failed to migrate IndexedDB data to local files:', error)
  }
}

async function createStorageBackend(stores: StoreBundle): Promise<StorageBackend> {
  if (await HttpStorageBackend.isAvailable()) {
    const backend = new HttpStorageBackend()
    await migrateIndexedDbToLocalFiles(backend, stores)
    return backend
  }

  const backend = createIndexedDbBackend(stores)
  await migrateLegacyIndexedDb(backend, stores)
  return backend
}

export async function initializePiStorage() {
  const stores = createStores()
  const backend = await createStorageBackend(stores)

  attachBackend(stores, backend)

  const storage = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend)
  setAppStorage(storage)

  const existing = await stores.customProviders.get(DEFAULT_CONNECTION.id!)
  if (!existing) {
    await saveConnectionProfile(storage, DEFAULT_CONNECTION, buildConnectionModel(DEFAULT_CONNECTION))
  }

  return storage
}

export async function saveActiveModel(storage: AppStorage, model: Model<Api>) {
  await storage.settings.set(ACTIVE_MODEL_SETTING_KEY, normalizeModelForProvider(model))
}

export async function loadActiveModel(storage: AppStorage): Promise<Model<Api> | null> {
  const model = await storage.settings.get<Model<Api>>(ACTIVE_MODEL_SETTING_KEY)
  if (!model || typeof model !== 'object') return null
  if (!model.id || !model.provider || !model.api || !model.baseUrl) return null
  return normalizeModelForProvider(model)
}

function sameBaseUrl(a?: string, b?: string) {
  return (a ?? '').trim().replace(/\/$/, '') === (b ?? '').trim().replace(/\/$/, '')
}

function findConfiguredModel(storage: AppStorage, model: Model<Api>) {
  return storage.customProviders.getAll().then((providers) => {
    for (const provider of providers) {
      const matched = (provider.models ?? []).find((candidate) => {
        return (
          candidate.id === model.id &&
          candidate.api === model.api &&
          candidate.provider === model.provider &&
          sameBaseUrl(candidate.baseUrl, model.baseUrl)
        )
      })
      if (matched) return matched as Model<Api>
    }
    return undefined
  })
}

/**
 * Resolve a persisted model snapshot against the current custom-model settings.
 *
 * Sessions store a full model object. Older sessions may therefore keep stale
 * capabilities (notably `reasoning: false`) even after the user marks the same
 * model as a reasoning model in settings. Prefer the current configured model
 * when it matches, falling back to built-in normalization for legacy DeepSeek
 * V4 profiles that predate the reasoning flag.
 */
export async function resolveConfiguredModel(storage: AppStorage, model: Model<Api>): Promise<Model<Api>> {
  try {
    const configured = await findConfiguredModel(storage, model)
    if (configured) {
      return configured.reasoning === true ? normalizeModelForProvider(configured) : configured
    }
  } catch (error) {
    console.warn('Failed to resolve configured model:', error)
  }

  return normalizeModelForProvider(model)
}

export async function saveYoloMode(storage: AppStorage, enabled: boolean) {
  await storage.settings.set(YOLO_MODE_SETTING_KEY, enabled)
}

export async function loadYoloMode(storage: AppStorage): Promise<boolean> {
  return (await storage.settings.get<boolean>(YOLO_MODE_SETTING_KEY)) === true
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

