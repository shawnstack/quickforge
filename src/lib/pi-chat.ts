import type { ThinkingLevel } from '@mariozechner/pi-agent-core'
import type { Api, Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai'
import {
  AppStorage,
  CustomProvidersStore,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  type CustomProvider,
  type StorageBackend,
} from '@mariozechner/pi-web-ui'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { logger } from '@/lib/logger'

const ACTIVE_MODEL_SETTING_KEY = 'active-model'
const YOLO_MODE_SETTING_KEY = 'yolo-mode'
const YOLO_MODE_PROJECT_PREFIX = 'yolo-mode-project:'
const DEFAULT_OPTIONS_SETTING_KEY = 'default-options'

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

export type DefaultOptions = {
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
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

function attachBackend(stores: StoreBundle, backend: StorageBackend) {
  stores.settings.setBackend(backend)
  stores.providerKeys.setBackend(backend)
  stores.sessions.setBackend(backend)
  stores.customProviders.setBackend(backend)
}

async function createStorageBackend(options?: ConstructorParameters<typeof HttpStorageBackend>[1]): Promise<StorageBackend> {
  if (!(await HttpStorageBackend.isAvailable())) {
    throw new Error('QuickForge local service is unavailable.')
  }

  return new HttpStorageBackend('', options)
}

export async function initializePiStorage(options: { blockedStores?: Iterable<string> } = {}) {
  const stores = createStores()
  const backend = await createStorageBackend(options.blockedStores)

  attachBackend(stores, backend)

  const storage = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend)
  setAppStorage(storage)

  return storage
}

export async function saveActiveModel(storage: AppStorage, model: Model<Api>) {
  await storage.settings.set(ACTIVE_MODEL_SETTING_KEY, normalizeModelForProvider(model))
}

export function defaultThinkingLevelForModel(model?: Model<Api>): ThinkingLevel {
  return model?.reasoning ? 'medium' : 'off'
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

export async function saveDefaultOptions(storage: AppStorage, options: DefaultOptions) {
  await storage.settings.set(DEFAULT_OPTIONS_SETTING_KEY, {
    model: options.model ? normalizeModelForProvider(options.model) : undefined,
    thinkingLevel: isThinkingLevel(options.thinkingLevel) ? options.thinkingLevel : undefined,
  })
}

export async function loadDefaultOptions(storage: AppStorage): Promise<DefaultOptions> {
  const options = await storage.settings.get<DefaultOptions>(DEFAULT_OPTIONS_SETTING_KEY)
  if (!options || typeof options !== 'object') return {}

  return {
    model: options.model ? normalizeModelForProvider(options.model) : undefined,
    thinkingLevel: isThinkingLevel(options.thinkingLevel) ? options.thinkingLevel : undefined,
  }
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

function sameConfiguredModel(a: Model<Api>, b: Model<Api>) {
  return a.id === b.id && a.provider === b.provider && a.api === b.api && sameBaseUrl(a.baseUrl, b.baseUrl)
}

function isUsableModel(model: unknown): model is Model<Api> {
  const candidate = model as Partial<Model<Api>> | undefined
  return Boolean(candidate?.id && candidate.provider && candidate.api && candidate.baseUrl)
}

export async function getConfiguredModels(storage: AppStorage): Promise<Model<Api>[]> {
  const providers = await storage.customProviders.getAll()
  return providers
    .flatMap((provider) => provider.models ?? [])
    .filter(isUsableModel)
    .map((model) => normalizeModelForProvider(model))
}

export async function loadInitialConfiguredModel(storage: AppStorage): Promise<Model<Api> | null> {
  const configuredModels = await getConfiguredModels(storage)
  if (configuredModels.length === 0) return null

  const savedModel = await loadActiveModel(storage)
  if (savedModel) {
    const matched = configuredModels.find((model) => sameConfiguredModel(model, savedModel))
    if (matched) return matched
  }

  return configuredModels[0]
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
    logger.warn('Failed to resolve configured model:', error)
  }

  return normalizeModelForProvider(model)
}

export async function saveYoloMode(storage: AppStorage, enabled: boolean, projectId?: string) {
  const key = projectId ? `${YOLO_MODE_PROJECT_PREFIX}${projectId}` : YOLO_MODE_SETTING_KEY
  await storage.settings.set(key, enabled)
}

export async function loadYoloMode(storage: AppStorage, projectId?: string): Promise<boolean> {
  if (projectId) {
    const projectKey = `${YOLO_MODE_PROJECT_PREFIX}${projectId}`
    const projectSaved = await storage.settings.get<unknown>(projectKey)
    if (projectSaved !== null && projectSaved !== undefined) {
      return projectSaved === true || projectSaved === 'true'
    }
    // Fall back to global default
  }
  const saved = await storage.settings.get<unknown>(YOLO_MODE_SETTING_KEY)
  if (saved === null || saved === undefined) {
    await saveYoloMode(storage, true)
    return true
  }
  return saved === true || saved === 'true'
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

