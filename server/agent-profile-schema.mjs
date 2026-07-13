export const AGENT_PROFILE_TOOL_NAMES = ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command']
export const AGENT_PROFILE_MODEL_INHERIT = { mode: 'inherit' }
export const AGENT_PROFILE_THINKING_LEVELS = ['inherit', 'off', 'low', 'medium', 'high', 'xhigh']

const agentProfileThinkingLevels = new Set(AGENT_PROFILE_THINKING_LEVELS)

export const CAPABILITY_POLICIES = {
  'readonly-research': {
    readonly: true,
    allowedTools: ['read_file', 'grep_files', 'run_command'],
  },
  'safe-validation': {
    readonly: true,
    allowedTools: ['read_file', 'grep_files', 'run_command'],
  },
  'review-only': {
    readonly: true,
    allowedTools: ['read_file', 'grep_files'],
  },
  'docs-edit': {
    readonly: false,
    allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file'],
    pathScope: ['docs/**', 'README.md', 'CHANGELOG.md'],
  },
  'code-edit': {
    readonly: false,
    allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'],
  },
}

const policyNames = new Set(Object.keys(CAPABILITY_POLICIES))
const allowedToolNames = new Set(AGENT_PROFILE_TOOL_NAMES)

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sameBaseUrl(a, b) {
  return String(a || '').trim().replace(/\/$/, '') === String(b || '').trim().replace(/\/$/, '')
}

function readModelField(value, ...keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  for (const key of keys) {
    const text = normalizeString(value[key])
    if (text) return text
  }
  return undefined
}

export function inferCapabilityPolicy(allowedTools = []) {
  if (allowedTools.some((toolName) => toolName === 'write_file' || toolName === 'edit_file')) return 'code-edit'
  if (allowedTools.includes('run_command')) return 'readonly-research'
  return 'review-only'
}

export function normalizeCapabilityPolicy(value, allowedTools = []) {
  const policy = normalizeString(value)?.toLowerCase()
  if (policy && policyNames.has(policy)) return policy
  return inferCapabilityPolicy(allowedTools)
}

export function validateAgentProfileTools(allowedTools = [], capabilityPolicy = inferCapabilityPolicy(allowedTools)) {
  const policy = CAPABILITY_POLICIES[capabilityPolicy]
  if (!policy) throw requestError(`Unsupported capability policy: ${capabilityPolicy}`)
  const allowedByPolicy = new Set(policy.allowedTools)
  for (const toolName of allowedTools) {
    if (!allowedToolNames.has(toolName)) throw requestError(`Unsupported tool for custom agent: ${toolName}`)
    if (!allowedByPolicy.has(toolName)) throw requestError(`Tool ${toolName} is not allowed by capability policy ${capabilityPolicy}`)
  }
  return true
}

export function applyCapabilityPolicy(allowedTools = [], capabilityPolicy = inferCapabilityPolicy(allowedTools)) {
  const policy = CAPABILITY_POLICIES[capabilityPolicy] || CAPABILITY_POLICIES['review-only']
  const allowedByPolicy = new Set(policy.allowedTools)
  return allowedTools.filter((toolName) => allowedByPolicy.has(toolName))
}

export function normalizeModelReference(input, metadata = {}) {
  const modelValue = input === undefined ? metadata.model : input
  const flatMode = normalizeString(metadata['model-mode'] ?? metadata.modelMode)?.toLowerCase()
  const flatProvider = normalizeString(metadata['model-provider'] ?? metadata.modelProvider ?? metadata.provider)
  const flatModelId = normalizeString(metadata['model-id'] ?? metadata.model_id ?? metadata.modelId)
  const flatApi = normalizeString(metadata['model-api'] ?? metadata.modelApi ?? metadata.api)
  const flatBaseUrl = normalizeString(metadata['model-base-url'] ?? metadata.modelBaseUrl ?? metadata.baseUrl)

  if (flatMode === 'fixed' || flatProvider || flatModelId) {
    return {
      mode: 'fixed',
      provider: flatProvider,
      modelId: flatModelId,
      api: flatApi,
      baseUrl: flatBaseUrl,
    }
  }

  if (modelValue === undefined || modelValue === null || modelValue === '') return { ...AGENT_PROFILE_MODEL_INHERIT }
  if (typeof modelValue === 'string') {
    const normalized = modelValue.trim().toLowerCase()
    if (!normalized || normalized === 'inherit' || normalized === 'parent' || normalized === 'default') return { ...AGENT_PROFILE_MODEL_INHERIT }
    const colon = modelValue.indexOf(':')
    if (colon > 0) {
      return {
        mode: 'fixed',
        provider: modelValue.slice(0, colon).trim(),
        modelId: modelValue.slice(colon + 1).trim(),
      }
    }
    return { ...AGENT_PROFILE_MODEL_INHERIT }
  }
  if (!modelValue || typeof modelValue !== 'object' || Array.isArray(modelValue)) return { ...AGENT_PROFILE_MODEL_INHERIT }

  const mode = normalizeString(modelValue.mode)?.toLowerCase()
  if (!mode || mode === 'inherit' || mode === 'parent' || mode === 'default') return { ...AGENT_PROFILE_MODEL_INHERIT }
  if (mode !== 'fixed') return { ...AGENT_PROFILE_MODEL_INHERIT }

  return {
    mode: 'fixed',
    provider: readModelField(modelValue, 'provider'),
    modelId: readModelField(modelValue, 'modelId', 'model-id', 'model_id', 'id', 'model'),
    api: readModelField(modelValue, 'api'),
    baseUrl: readModelField(modelValue, 'baseUrl', 'base-url', 'base_url'),
  }
}

export function validateModelReference(modelRef) {
  const ref = modelRef || AGENT_PROFILE_MODEL_INHERIT
  if (ref.mode !== 'fixed') return { ...AGENT_PROFILE_MODEL_INHERIT }
  if (!ref.provider || !ref.modelId) throw requestError('Fixed agent model requires provider and modelId')
  return {
    mode: 'fixed',
    provider: ref.provider,
    modelId: ref.modelId,
    api: ref.api,
    baseUrl: ref.baseUrl,
  }
}

export function normalizeAgentProfileThinkingLevel(value, fallback = 'inherit') {
  const normalized = normalizeString(value)?.toLowerCase() || fallback
  if (!agentProfileThinkingLevels.has(normalized)) {
    throw requestError(`Unsupported agent thinking level: ${normalized}`)
  }
  return normalized
}

export function resolveAgentProfileThinkingLevel(profile, inheritedThinkingLevel, model) {
  const configured = normalizeAgentProfileThinkingLevel(profile?.thinkingLevel)
  const requested = configured === 'inherit'
    ? normalizeAgentProfileThinkingLevel(inheritedThinkingLevel || 'off', 'off')
    : configured
  return model?.reasoning === true ? requested : 'off'
}

export function modelReferenceSnapshot(modelRef) {
  const ref = modelRef || AGENT_PROFILE_MODEL_INHERIT
  if (ref.mode !== 'fixed') return { ...AGENT_PROFILE_MODEL_INHERIT }
  return {
    mode: 'fixed',
    provider: ref.provider,
    modelId: ref.modelId,
    ...(ref.api ? { api: ref.api } : {}),
    ...(ref.baseUrl ? { baseUrl: ref.baseUrl } : {}),
  }
}

export async function resolveAgentProfileModel(profile, parentModel, readStore) {
  const ref = profile?.model || AGENT_PROFILE_MODEL_INHERIT
  if (!ref || ref.mode !== 'fixed') {
    if (!parentModel) throw requestError('No active model is configured for the parent session.')
    return { model: parentModel, info: { ...modelReferenceSnapshot(ref), inherited: true } }
  }

  const validRef = validateModelReference(ref)
  const store = await readStore('custom-providers').catch(() => ({}))
  const providers = Array.isArray(store) ? store : Object.values(store || {})
  const configuredModels = providers
    .flatMap((provider) => Array.isArray(provider?.models) ? provider.models : [])
    .filter((model) => model && typeof model === 'object')
  const model = configuredModels.find((candidate) => (
    candidate.provider === validRef.provider &&
    candidate.id === validRef.modelId &&
    (!validRef.api || candidate.api === validRef.api) &&
    (!validRef.baseUrl || sameBaseUrl(candidate.baseUrl, validRef.baseUrl))
  ))
  if (!model) {
    throw requestError(`Agent profile ${profile?.name || ''} requested model ${validRef.provider}/${validRef.modelId}, but it is not configured.`)
  }
  return { model, info: { ...modelReferenceSnapshot(validRef), inherited: false } }
}
