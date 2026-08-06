import { getCloudRuntime } from './cloud/runtime.mjs'
import { isManagedCloudModel } from './cloud/models.mjs'
import { readStore } from './storage.mjs'
import { isTailscaleAddress } from './utils/network.mjs'

export const MODEL_REFERENCE_VERSION = 1

function requestError(message, statusCode = 400, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  if (code) {
    error.code = code
    error.errorCode = code
  }
  return error
}

function normalizedBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function isUsableModel(model) {
  return Boolean(model && typeof model === 'object' && model.id && model.provider && model.api && model.baseUrl)
}

function sameModel(left, right) {
  return Boolean(left && right
    && left.id === right.id
    && left.provider === right.provider
    && left.api === right.api
    && normalizedBaseUrl(left.baseUrl) === normalizedBaseUrl(right.baseUrl))
}

function publicModel(model, modelRef) {
  const result = {
    ...model,
    quickforgeModelRef: modelRef,
  }
  delete result.apiKey
  delete result.key
  delete result.headers
  return result
}

async function configuredProviders() {
  const store = await readStore('custom-providers').catch(() => ({}))
  return Array.isArray(store) ? store : Object.values(store || {})
}

function configuredEntries(providers) {
  return providers.flatMap((provider) => {
    const providerId = String(provider?.id || '').trim()
    return (Array.isArray(provider?.models) ? provider.models : [])
      .filter(isUsableModel)
      .map((model) => ({ provider, providerId, model }))
  })
}

export function cloudAllowedForContext(context = {}) {
  if (context.allowCloud === false) return false
  if (context.allowCloud === true || context.source === 'acp' || context.source === 'scheduled') return true
  if (context.isLocalRequest !== false) return true
  return context.remoteAuthorized === true && isTailscaleAddress(context.remoteAddress)
}

export function modelReferenceFromSnapshot(model, providers = []) {
  if (!model || typeof model !== 'object') return null
  if (isManagedCloudModel(model)) {
    const catalogId = String(model.quickforgeCatalogId || model.id || '').trim()
    return catalogId ? { version: MODEL_REFERENCE_VERSION, source: 'cloud', catalogId } : null
  }

  const matched = configuredEntries(providers).find((entry) => sameModel(entry.model, model))
  if (matched?.providerId) {
    return {
      version: MODEL_REFERENCE_VERSION,
      source: 'custom',
      providerId: matched.providerId,
      modelId: matched.model.id,
    }
  }

  if (model.provider && model.id) {
    return {
      version: MODEL_REFERENCE_VERSION,
      source: 'legacy-custom',
      provider: String(model.provider),
      modelId: String(model.id),
      ...(model.api ? { api: String(model.api) } : {}),
      ...(model.baseUrl ? { baseUrl: String(model.baseUrl) } : {}),
    }
  }
  return null
}

export function normalizeModelReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = String(value.source || '').trim()
  if (source === 'cloud') {
    const catalogId = String(value.catalogId || value.quickforgeCatalogId || value.modelId || '').trim()
    return catalogId ? { version: MODEL_REFERENCE_VERSION, source: 'cloud', catalogId } : null
  }
  if (source === 'custom') {
    const providerId = String(value.providerId || '').trim()
    const modelId = String(value.modelId || value.id || '').trim()
    return providerId && modelId
      ? { version: MODEL_REFERENCE_VERSION, source: 'custom', providerId, modelId }
      : null
  }
  if (source === 'legacy-custom') {
    const provider = String(value.provider || '').trim()
    const modelId = String(value.modelId || value.id || '').trim()
    return provider && modelId
      ? {
          version: MODEL_REFERENCE_VERSION,
          source: 'legacy-custom',
          provider,
          modelId,
          ...(value.api ? { api: String(value.api) } : {}),
          ...(value.baseUrl ? { baseUrl: String(value.baseUrl) } : {}),
        }
      : null
  }
  return null
}

async function listCloudModels(context, { refresh = false } = {}) {
  if (!cloudAllowedForContext(context)) return []
  try {
    const runtime = await getCloudRuntime()
    if (!runtime?.enabled) return []
    const models = await runtime.models.list(undefined, { refresh })
    return models.filter((model) => model?.quickforgeCatalogId)
  } catch {
    return []
  }
}

export async function listModelCatalog({
  context = {},
  includeHidden = false,
  currentModel = null,
  refreshCloud = false,
} = {}) {
  const providers = await configuredProviders()
  const custom = configuredEntries(providers)
    .filter(({ model }) => includeHidden || model.quickforgeHidden !== true || sameModel(model, currentModel))
    .map(({ providerId, model }) => publicModel(model, {
      version: MODEL_REFERENCE_VERSION,
      source: 'custom',
      providerId,
      modelId: model.id,
    }))
  if (currentModel) {
    const currentIndex = custom.findIndex((model) => sameModel(model, currentModel))
    if (currentIndex > 0 && custom[currentIndex].quickforgeHidden === true) {
      custom.unshift(custom.splice(currentIndex, 1)[0])
    }
  }
  const cloud = (await listCloudModels(context, { refresh: refreshCloud }))
    .map((model) => publicModel(model, {
      version: MODEL_REFERENCE_VERSION,
      source: 'cloud',
      catalogId: model.quickforgeCatalogId,
    }))

  if (currentModel && ![...custom, ...cloud].some((model) => sameModel(model, currentModel))) {
    const ref = modelReferenceFromSnapshot(currentModel, providers)
    if (ref) return [publicModel(currentModel, ref), ...custom, ...cloud]
  }
  return [...custom, ...cloud]
}

async function resolveCloud(ref, context) {
  if (!cloudAllowedForContext(context)) {
    throw requestError('QuickForge Cloud is not available from this client.', 403, 'cloud_access_denied')
  }
  const runtime = await getCloudRuntime()
  if (!runtime?.enabled) throw requestError('QuickForge Cloud is not configured.', 503, 'cloud_not_configured')
  return (await runtime.models.resolve({
    provider: 'quickforge-cloud',
    quickforgeModelSource: 'cloud',
    quickforgeCatalogId: ref.catalogId,
  })).publicModel
}

function findCustomByReference(ref, entries) {
  if (ref.source === 'custom') {
    return entries.find(({ providerId, model }) => providerId === ref.providerId && model.id === ref.modelId)?.model
  }
  if (ref.source === 'legacy-custom') {
    return entries.find(({ model }) => model.provider === ref.provider
      && model.id === ref.modelId
      && (!ref.api || model.api === ref.api)
      && (!ref.baseUrl || normalizedBaseUrl(model.baseUrl) === normalizedBaseUrl(ref.baseUrl)))?.model
  }
  return null
}

export async function resolveModelBinding(input, {
  context = {},
  currentModel = null,
  allowCurrentHidden = false,
  forExecution = false,
  legacySnapshot = null,
} = {}) {
  const providers = await configuredProviders()
  const entries = configuredEntries(providers)
  const explicitRef = normalizeModelReference(input?.modelRef || input?.quickforgeModelRef || input)
  const snapshot = input?.model && typeof input.model === 'object'
    ? input.model
    : (!explicitRef && input && typeof input === 'object' && input.id ? input : legacySnapshot)
  const ref = explicitRef || modelReferenceFromSnapshot(snapshot, providers)
  if (!ref) throw requestError('A valid model reference is required.', 400, 'invalid_model_reference')

  if (ref.source === 'cloud') {
    const model = await resolveCloud(ref, context)
    return { model, modelRef: ref }
  }

  const configured = findCustomByReference(ref, entries)
  if (configured) {
    const hidden = configured.quickforgeHidden === true
    if (hidden && !forExecution && !(allowCurrentHidden && sameModel(configured, currentModel))) {
      throw requestError('Selected model is not available for new selection.', 400, 'model_not_selectable')
    }
    const canonicalRef = modelReferenceFromSnapshot(configured, providers)
    return { model: configured, modelRef: canonicalRef }
  }

  throw requestError('Selected model is not configured in QuickForge.', 400, 'model_not_configured')
}

export async function resolveImplicitModelPreference(value, context = {}) {
  let stored = value
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored) } catch { stored = null }
  }
  const ref = normalizeModelReference(stored?.modelRef || stored?.quickforgeModelRef)
  const snapshot = stored?.modelSnapshot || stored?.model || (stored?.id ? stored : null)
  const catalog = await listModelCatalog({ context })
  if (ref) {
    const matched = catalog.find((model) => {
      const candidate = normalizeModelReference(model.quickforgeModelRef)
      if (!candidate || candidate.source !== ref.source) return false
      if (ref.source === 'cloud') return candidate.catalogId === ref.catalogId
      if (ref.source === 'custom') return candidate.providerId === ref.providerId && candidate.modelId === ref.modelId
      return false
    })
    if (matched) return matched
  }
  if (snapshot) {
    const matched = catalog.find((model) => sameModel(model, snapshot))
    if (matched) return matched
  }
  return catalog[0] || null
}

export async function modelBindingFromModel(model) {
  const providers = await configuredProviders()
  return { model, modelRef: modelReferenceFromSnapshot(model, providers) }
}
