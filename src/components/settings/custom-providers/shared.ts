import type { Api, Model } from '@earendil-works/pi-ai'
import type { CustomProvider, CustomProviderType } from '@/storage'
import { DEFAULT_CONNECTION, normalizeModelForProvider } from '@/lib/pi-chat'

export type ProviderProtocol = Extract<CustomProviderType, 'openai-completions' | 'anthropic-messages'>
export type AnyModel = Model<Api> & { quickforgeHidden?: boolean }

export type HeaderRow = { key: string; value: string }

export type PresetKey = 'openai' | 'deepseek' | 'glm' | 'ollama' | 'litellm' | 'custom'

// Preset values that get filled into the connection layer. Labels for the
// picker come from i18n; these are the concrete provider/model values.
export const PROVIDER_PRESETS: Record<Exclude<PresetKey, 'custom'>, {
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  modelId: string
  supportsImages?: boolean
}> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-completions', modelId: 'gpt-4o', supportsImages: true },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-completions', modelId: 'deepseek-chat' },
  glm: { name: 'Zhipu GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-completions', modelId: 'glm-4-plus' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai-completions', modelId: 'llama3.1' },
  litellm: { name: DEFAULT_CONNECTION.name, baseUrl: DEFAULT_CONNECTION.baseUrl, protocol: 'openai-completions', modelId: DEFAULT_CONNECTION.modelId, supportsImages: DEFAULT_CONNECTION.supportsImages },
}

export type ConnectionDraft = {
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  headerRows: HeaderRow[]
}

export type ModelDraft = {
  modelId: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  supportsImages: boolean
  visibleInSelectors: boolean
}

export const emptyModelDraft = (): ModelDraft => ({
  modelId: '',
  contextWindow: DEFAULT_CONNECTION.contextWindow,
  maxTokens: DEFAULT_CONNECTION.maxTokens,
  reasoning: true,
  supportsImages: false,
  visibleInSelectors: true,
})

export function protocolOfProvider(provider: CustomProvider): ProviderProtocol {
  return provider.type === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions'
}

/** 行内/徽标用的协议短标签，避免窄列里长文案换行。 */
export function protocolShortLabel(provider: CustomProvider): string {
  return protocolOfProvider(provider) === 'anthropic-messages' ? 'Anthropic' : 'OpenAI'
}

export function connectionDraftOf(provider: CustomProvider): ConnectionDraft {
  const headers = provider.models?.[0]?.headers ?? {}
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    protocol: protocolOfProvider(provider),
    headerRows: Object.entries(headers).map(([key, value]) => ({ key, value: String(value) })),
  }
}

export function modelDraftOf(model: AnyModel): ModelDraft {
  return {
    modelId: model.id,
    contextWindow: model.contextWindow ?? DEFAULT_CONNECTION.contextWindow,
    maxTokens: model.maxTokens ?? DEFAULT_CONNECTION.maxTokens,
    reasoning: model.reasoning === true,
    supportsImages: model.input?.includes('image') === true,
    visibleInSelectors: model.quickforgeHidden !== true,
  }
}

export function headersFromRows(rows: HeaderRow[]): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    const value = row.value.trim()
    if (key && value) {
      headers[key] = value
    }
  }
  return headers
}

export function buildModelFromDrafts(
  connection: { name: string; baseUrl: string; protocol: ProviderProtocol },
  modelForm: ModelDraft,
  headers: Record<string, string>,
): AnyModel {
  const name = connection.name.trim()
  const baseUrl = connection.baseUrl.trim()
  const isReasoningModel = modelForm.reasoning === true
  const supportsImages = modelForm.supportsImages === true
  const input: ('text' | 'image')[] = supportsImages ? ['text', 'image'] : ['text']
  const isDeepSeek = baseUrl.includes('api.deepseek.com')

  const model = {
    id: modelForm.modelId,
    name: `${modelForm.modelId} (${name})`,
    api: connection.protocol,
    provider: name,
    baseUrl: baseUrl.replace(/\/$/, ''),
    reasoning: isReasoningModel,
    input,
    quickforgeHidden: modelForm.visibleInSelectors ? undefined : true,
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
      connection.protocol === 'openai-completions'
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
