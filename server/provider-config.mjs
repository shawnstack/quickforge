import { readStore } from './storage.mjs'

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function providersFromStore(store) {
  return Array.isArray(store)
    ? store
    : Object.entries(store || {}).map(([id, provider]) => (
        provider && typeof provider === 'object' ? { id, ...provider } : provider
      ))
}

function isOpenRouterProvider(provider) {
  if (!provider || typeof provider !== 'object') return false
  const id = String(provider.id || '').trim().toLowerCase()
  const name = String(provider.name || '').trim().toLowerCase()
  if (id === 'openrouter' || name === 'openrouter') return true

  try {
    return new URL(String(provider.baseUrl || '')).hostname.toLowerCase() === 'openrouter.ai'
  } catch {
    return false
  }
}

function normalizeHeaders(provider) {
  const source = provider?.headers || provider?.models?.find((model) => model?.headers)?.headers
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined
  const headers = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && key.trim()) headers[key.trim()] = value
  }
  return Object.keys(headers).length ? headers : undefined
}

function findProviderKey(keys, providerName) {
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return undefined
  if (typeof keys[providerName] === 'string' && keys[providerName].trim()) return keys[providerName].trim()

  const wanted = String(providerName || '').trim().toLowerCase()
  for (const [key, value] of Object.entries(keys)) {
    const normalized = key.trim().toLowerCase()
    if ((normalized === wanted || normalized === 'openrouter') && typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

export async function resolveOpenRouterConfig(runtime = {}) {
  const read = runtime.readStore || readStore
  const [providerStore, providerKeys] = await Promise.all([
    read('custom-providers'),
    read('provider-keys'),
  ])
  const provider = providersFromStore(providerStore).find(isOpenRouterProvider)
  if (!provider) throw requestError('OpenRouter provider is not configured')

  const providerName = String(provider.name || provider.id || 'openrouter').trim()
  const apiKey = findProviderKey(providerKeys, providerName)
  if (!apiKey) throw requestError('OpenRouter API key is not configured')

  const baseUrl = typeof provider.baseUrl === 'string' && provider.baseUrl.trim()
    ? provider.baseUrl.trim().replace(/\/$/, '')
    : DEFAULT_OPENROUTER_BASE_URL

  return {
    apiKey,
    baseUrl,
    headers: normalizeHeaders(provider),
  }
}
