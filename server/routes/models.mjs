import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { AI_TEST_CONNECTION_TOTAL_TIMEOUT_MS } from '../ai-provider-options.mjs'
import { listModelCatalog } from '../model-catalog.mjs'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import { readStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

async function getApiKey(provider) {
  try {
    const keys = await readStore('provider-keys')
    return keys?.[provider] || undefined
  } catch {
    return undefined
  }
}

// Send a minimal one-token request to verify the endpoint is reachable and the
// API key is valid. Returns { ok: true } on success; throws on failure.
async function probeModelConnection(model, apiKeyOverride) {
  const apiKey = apiKeyOverride || (await getApiKey(model?.provider))
  const stream = streamSimpleWithAiHttpLogging(
    model,
    {
      systemPrompt: 'You are a connectivity test. Reply with a single word.',
      messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }],
      tools: [],
    },
    {
      apiKey,
      maxTokens: 16,
      temperature: 0,
      // Keep reasoning off so thinking-capable models don't require extra tokens.
      reasoning: undefined,
      maxRetries: 0,
      maxRetryDelayMs: 30000,
      totalTimeoutMs: AI_TEST_CONNECTION_TOTAL_TIMEOUT_MS,
    },
  )
  const message = await stream.result()
  if (message?.stopReason === 'error' || message?.stopReason === 'aborted') {
    throw new Error(message.errorMessage || `Model request ${message.stopReason}`)
  }
  return { ok: true }
}

const PROVIDER_PROBE_TIMEOUT_MS = 15_000

function readProviderProbeBody(body) {
  const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
  const protocol = body?.protocol === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions'
  const apiKey =
    typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined
  const headers = {}
  if (body?.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) {
    for (const [key, value] of Object.entries(body.headers)) {
      if (typeof value === 'string' && value.trim()) headers[key] = value.trim()
    }
  }
  return { baseUrl, protocol, apiKey, headers }
}

// Provider-level probe: list models from the server's /models endpoint.
// Works for OpenAI-compatible services and the Anthropic Messages API; does not
// require any locally configured model (unlike /api/models/test-connection).
async function fetchProviderModelIds({ baseUrl, protocol, apiKey, headers }) {
  const base = baseUrl.replace(/\/+$/, '')
  const requestHeaders = { accept: 'application/json', ...headers }
  if (protocol === 'anthropic-messages') {
    if (apiKey) requestHeaders['x-api-key'] = apiKey
    requestHeaders['anthropic-version'] = requestHeaders['anthropic-version'] || '2023-06-01'
  } else if (apiKey) {
    requestHeaders.authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(`${base}/models`, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
  }
  const payload = await response.json().catch(() => null)
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  const ids = []
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : entry?.id
    if (typeof id === 'string' && id.trim()) ids.push(id.trim())
  }
  return ids
}

export async function handleModelsApi(req, res, url, context = {}) {
  if (req.method === 'GET' && url.pathname === '/api/models/catalog') {
    sendJson(res, 200, { models: await listModelCatalog({ context }) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/models/test-connection') {
    const body = await readJsonBody(req)
    const model = body?.model
    const apiKeyOverride =
      typeof body?.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined

    if (!model || !model.id || !model.baseUrl) {
      throw requestError('model and baseUrl are required')
    }

    try {
      const result = await probeModelConnection(model, apiKeyOverride)
      sendJson(res, 200, result)
    } catch (error) {
      logger.warn('Model connection test failed:', error?.message || error)
      // Return 200 with { ok:false } so the client can parse success/failure uniformly.
      sendJson(res, 200, { ok: false, error: error?.message || String(error) })
    }
    return
  }

  if (
    (req.method === 'POST' && url.pathname === '/api/models/provider-test') ||
    (req.method === 'POST' && url.pathname === '/api/models/provider-discover')
  ) {
    const discover = url.pathname === '/api/models/provider-discover'
    const body = readProviderProbeBody(await readJsonBody(req))
    if (!body.baseUrl) throw requestError('baseUrl is required')

    try {
      const models = await fetchProviderModelIds(body)
      sendJson(res, 200, discover ? { ok: true, models } : { ok: true })
    } catch (error) {
      logger.warn(`Provider ${discover ? 'discover' : 'test'} failed:`, error?.message || error)
      sendJson(res, 200, { ok: false, error: error?.message || String(error) })
    }
    return
  }

  throw requestError('Not found', 404)
}
