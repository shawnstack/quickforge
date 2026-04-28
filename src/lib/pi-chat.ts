import type { Api, Model } from '@mariozechner/pi-ai'
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

type StoreBundle = {
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

function createIndexedDbBackend(stores: StoreBundle) {
  return new IndexedDBStorageBackend({
    dbName: 'fastcode-ai-chat',
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

async function migrateIndexedDbToLocalFiles(target: StorageBackend, stores: StoreBundle) {
  const alreadyMigrated = await target.get<boolean>('settings', INDEXEDDB_MIGRATION_SETTING_KEY)
  if (alreadyMigrated) return

  const indexedDbStores = createStores()
  const indexedDbBackend = createIndexedDbBackend(indexedDbStores)

  try {
    for (const store of getStoreConfigs(stores)) {
      await copyStoreIfMissing(indexedDbBackend, target, store.name)
    }
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

  return createIndexedDbBackend(stores)
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
  await storage.settings.set(ACTIVE_MODEL_SETTING_KEY, model)
}

export async function loadActiveModel(storage: AppStorage): Promise<Model<Api> | null> {
  const model = await storage.settings.get<Model<Api>>(ACTIVE_MODEL_SETTING_KEY)
  if (!model || typeof model !== 'object') return null
  if (!model.id || !model.provider || !model.api || !model.baseUrl) return null
  return model
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
