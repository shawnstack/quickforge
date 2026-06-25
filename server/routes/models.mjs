import { streamSimple } from '@earendil-works/pi-ai'
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
  const stream = streamSimple(
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
      maxRetryDelayMs: 30000,
    },
  )
  await stream.result()
  return { ok: true }
}

export async function handleModelsApi(req, res, url) {
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

  throw requestError('Not found', 404)
}
