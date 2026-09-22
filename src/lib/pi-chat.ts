import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model, OpenAICompletionsCompat } from '@earendil-works/pi-ai'
import {
  AppStorage,
  CustomProvidersStore,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
  type CustomProvider,
  type StorageBackend,
} from '@/storage'
import { HttpStorageBackend } from '@/lib/http-storage-backend'
import { clearModelListCache } from '@/lib/model-list-cache'
import { mergeModelGroups } from '@/lib/model-aggregation'
import { filterSelectableModels } from '@/lib/model-visibility'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { chooseNewSessionModel, chooseStartupModel } from '@/lib/startup-model'
import { loadModelCatalog, type ModelReference } from '@/lib/model-reference'
import { modelFromStoredPreference, storedModelPreference } from '@/lib/model-preference'
import type { AgentAccessMode } from '@/lib/types'
import { agentAccessModeToYoloMode, normalizeAgentAccessMode } from '@/lib/types'

const ACTIVE_MODEL_SETTING_KEY = 'active-model'
const AGENT_ACCESS_MODE_SETTING_KEY = 'agent-access-mode'
const AGENT_ACCESS_MODE_PROJECT_PREFIX = 'agent-access-mode-project:'
const YOLO_MODE_SETTING_KEY = 'yolo-mode'
const YOLO_MODE_PROJECT_PREFIX = 'yolo-mode-project:'
const DEFAULT_OPTIONS_SETTING_KEY = 'default-options'

export { isModelSelectable } from '@/lib/model-visibility'

type ConnectionForm = {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  modelId: string
  contextWindow: number
  maxTokens: number
  /** Whether the model supports thinking/reasoning (DeepSeek V4, Qwen, etc.). */
  reasoning?: boolean
  /** Whether the model supports image input. Disabled models omit images before sending. */
  supportsImages?: boolean
}

type StoreBundle = {
  settings: SettingsStore
  providerKeys: ProviderKeysStore
  sessions: SessionsStore
  customProviders: CustomProvidersStore
}

type DefaultOptions = {
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
  maxTokens: 32768,
  supportsImages: true,
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
  }
}

const deepSeekThinkingLevelMap = {
  low: 'high',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
} as const

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
    thinkingLevelMap: {
      ...openAiModel.thinkingLevelMap,
      ...deepSeekThinkingLevelMap,
    },
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
  const input: ('text' | 'image')[] = form.supportsImages === true ? ['text', 'image'] : ['text']

  const model = {
    id: modelId,
    name: `${modelId} (${provider})`,
    api: 'openai-completions',
    provider,
    baseUrl,
    reasoning: isReasoningModel,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(form.contextWindow) || DEFAULT_CONNECTION.contextWindow,
    maxTokens: Number(form.maxTokens) || DEFAULT_CONNECTION.maxTokens,
    thinkingLevelMap: isDeepSeekThinking ? deepSeekThinkingLevelMap : undefined,
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
  } satisfies Model<'openai-completions'>

  return normalizeModelForProvider(model)
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

type InitializePiStorageOptions = { blockedStores?: Iterable<string> }

// 幂等守卫：全局 AppStorage 只由首次成功调用创建并 setAppStorage。
// 后续懒加载调用点（AgentProfilesPage / GitCommitPushDialog /
// ScheduledTasksPage 等）复用首个实例，不再重建 4 Store+backend，
// 也不再重复 setAppStorage——否则会静默顶掉外部安装的特化实例
// （如 SharedConversationPage 的 installSharedPageStorage），并让
// 各处缓存的 store 引用与全局实例脱钩（provider-keys-cache 依赖此语义）。
// 首次失败不缓存：服务暂不可用时，后续调用仍可重试。
let initializedStorage: AppStorage | null = null
let initializedOptionsKey: string | null = null
let initializeStorageInFlight: Promise<AppStorage> | null = null

function initializeOptionsKey(options: InitializePiStorageOptions): string {
  return [...new Set(options.blockedStores ?? [])].sort().join(',')
}

export async function initializePiStorage(options: InitializePiStorageOptions = {}): Promise<AppStorage> {
  if (initializedStorage) {
    // 首建实例优先（first-writer-wins）：静默按新 options 重建等于复活
    // 被覆盖的全局状态 bug，故仅告警并返回首个实例。
    if (initializeOptionsKey(options) !== initializedOptionsKey) {
      logger.warn('initializePiStorage was called again with different options; returning the first initialized instance.')
    }
    return initializedStorage
  }
  if (initializeStorageInFlight) return initializeStorageInFlight

  const pending = (async () => {
    try {
      const stores = createStores()
      const backend = await createStorageBackend(options.blockedStores)

      attachBackend(stores, backend)

      const storage = new AppStorage(stores.settings, stores.providerKeys, stores.sessions, stores.customProviders, backend)
      setAppStorage(storage)
      initializedStorage = storage
      initializedOptionsKey = initializeOptionsKey(options)

      return storage
    } finally {
      initializeStorageInFlight = null
    }
  })()
  initializeStorageInFlight = pending
  return pending
}

type StoredDefaultOptions = {
  modelRef?: ModelReference
  modelSnapshot?: Model<Api>
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
}

export async function saveActiveModel(storage: AppStorage, model: Model<Api>) {
  const preference = storedModelPreference(normalizeModelForProvider(model))
  await storage.settings.set(ACTIVE_MODEL_SETTING_KEY, preference)
}

export function defaultThinkingLevelForModel(model?: Model<Api>): ThinkingLevel {
  return model?.reasoning ? 'high' : 'off'
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

export async function saveDefaultOptions(storage: AppStorage, options: DefaultOptions) {
  const preference = options.model
    ? storedModelPreference(normalizeModelForProvider(options.model))
    : {}
  await storage.settings.set(DEFAULT_OPTIONS_SETTING_KEY, {
    ...preference,
    thinkingLevel: isThinkingLevel(options.thinkingLevel) ? options.thinkingLevel : undefined,
  })
}

export async function loadDefaultOptions(storage: AppStorage): Promise<DefaultOptions> {
  const options = await storage.settings.get<StoredDefaultOptions>(DEFAULT_OPTIONS_SETTING_KEY)
  if (!options || typeof options !== 'object') return {}

  const model = options.modelSnapshot
    ? normalizeModelForProvider(modelFromStoredPreference(options)!)
    : options.model
      ? normalizeModelForProvider(options.model)
      : undefined
  return {
    model,
    thinkingLevel: isThinkingLevel(options.thinkingLevel) ? options.thinkingLevel : undefined,
  }
}

export async function loadActiveModel(storage: AppStorage): Promise<Model<Api> | null> {
  const stored = await storage.settings.get<unknown>(ACTIVE_MODEL_SETTING_KEY)
  const model = modelFromStoredPreference(stored)
  return model ? normalizeModelForProvider(model) : null
}

function sameBaseUrl(a?: string, b?: string) {
  return (a ?? '').trim().replace(/\/$/, '') === (b ?? '').trim().replace(/\/$/, '')
}

function isUsableModel(model: unknown): model is Model<Api> {
  const candidate = model as Partial<Model<Api>> | undefined
  return Boolean(candidate?.id && candidate.provider && candidate.api && candidate.baseUrl)
}

function configuredModelsFromProviders(providers: CustomProvider[]): Model<Api>[] {
  return providers
    .flatMap((provider) => provider.models ?? [])
    .filter(isUsableModel)
    .map((model) => normalizeModelForProvider(model))
}

export async function getConfiguredModels(storage: AppStorage): Promise<Model<Api>[]> {
  try {
    const catalog = await loadModelCatalog()
    if (catalog.length) return catalog
  } catch (error) {
    logger.warn('Failed to load model catalog, falling back to local provider store:', error)
  }
  const providers = await storage.customProviders.getAll()
  return configuredModelsFromProviders(providers)
}

export async function getSelectableConfiguredModels(storage: AppStorage): Promise<Model<Api>[]> {
  return filterSelectableModels(await getConfiguredModels(storage))
}

export function mergeAvailableModels(...groups: ReadonlyArray<ReadonlyArray<Model<Api>>>): Model<Api>[] {
  return mergeModelGroups(normalizeModelForProvider, isUsableModel, ...groups)
}

export async function loadInitialConfiguredModel(
  storage: AppStorage,
  additionalModels: Model<Api>[] = [],
  preferredModel?: Model<Api>,
): Promise<Model<Api> | null> {
  const configuredModels = mergeAvailableModels(await getSelectableConfiguredModels(storage), additionalModels)
  if (configuredModels.length === 0) return null

  const savedModel = await loadActiveModel(storage)
  return chooseStartupModel(configuredModels, preferredModel, savedModel)
}

function findConfiguredModel(storage: AppStorage, model: Model<Api>) {
  return getConfiguredModels(storage).then((models) => models.find((candidate) => (
    candidate.id === model.id
    && candidate.api === model.api
    && candidate.provider === model.provider
    && sameBaseUrl(candidate.baseUrl, model.baseUrl)
  )))
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

export async function resolveNewSessionModel(
  storage: AppStorage | null,
  model: Model<Api>,
): Promise<Model<Api>> {
  if (!storage) return normalizeModelForProvider(model)

  const configuredModels = await getSelectableConfiguredModels(storage)
  const resolvedModel = chooseNewSessionModel(model, configuredModels)
  if (resolvedModel) return resolvedModel

  throw new Error('No available model can be used to create a new session.')
}

export async function saveAgentAccessMode(storage: AppStorage, mode: AgentAccessMode, projectId?: string) {
  const normalized = normalizeAgentAccessMode(mode)
  const key = projectId ? `${AGENT_ACCESS_MODE_PROJECT_PREFIX}${projectId}` : AGENT_ACCESS_MODE_SETTING_KEY
  await storage.settings.set(key, normalized)

  // Keep the legacy setting in sync so older QuickForge versions and persisted
  // sessions continue to interpret the selected permission mode correctly.
  const legacyKey = projectId ? `${YOLO_MODE_PROJECT_PREFIX}${projectId}` : YOLO_MODE_SETTING_KEY
  await storage.settings.set(legacyKey, agentAccessModeToYoloMode(normalized))
}

export async function loadAgentAccessMode(storage: AppStorage, projectId?: string): Promise<AgentAccessMode> {
  if (projectId) {
    const projectKey = `${AGENT_ACCESS_MODE_PROJECT_PREFIX}${projectId}`
    const projectSaved = await storage.settings.get<unknown>(projectKey)
    if (projectSaved !== null && projectSaved !== undefined) {
      return normalizeAgentAccessMode(projectSaved)
    }

    const legacyProjectKey = `${YOLO_MODE_PROJECT_PREFIX}${projectId}`
    const legacyProjectSaved = await storage.settings.get<unknown>(legacyProjectKey)
    if (legacyProjectSaved !== null && legacyProjectSaved !== undefined) {
      return normalizeAgentAccessMode(legacyProjectSaved)
    }
    // Fall back to global default
  }

  const saved = await storage.settings.get<unknown>(AGENT_ACCESS_MODE_SETTING_KEY)
  if (saved !== null && saved !== undefined) return normalizeAgentAccessMode(saved)

  const legacySaved = await storage.settings.get<unknown>(YOLO_MODE_SETTING_KEY)
  if (legacySaved !== null && legacySaved !== undefined) return normalizeAgentAccessMode(legacySaved)

  await saveAgentAccessMode(storage, 'default')
  return 'default'
}

export async function saveConnectionProfile(
  storage: AppStorage,
  form: ConnectionForm,
  model: Model<'openai-completions'>,
) {
  const id = form.id || randomId()
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

  clearModelListCache()
  return id
}

