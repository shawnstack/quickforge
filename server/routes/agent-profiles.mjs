import { streamSimpleWithAiHttpLogging } from '../ai-http-logger.mjs'
import { DEFAULT_AI_MAX_RETRIES } from '../ai-provider-options.mjs'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'
import { resolveModelBinding } from '../model-catalog.mjs'

function profileModelReference(model) {
  if (!model || model.mode !== 'fixed') return null
  if (model.source === 'cloud') return { version: 1, source: 'cloud', catalogId: model.catalogId || model.modelId }
  if (model.source === 'custom') return { version: 1, source: 'custom', providerId: model.providerId, modelId: model.modelId }
  return {
    version: 1,
    source: 'legacy-custom',
    provider: model.provider,
    modelId: model.modelId,
    ...(model.api ? { api: model.api } : {}),
    ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
  }
}

async function canonicalizeProfileModel(body, current, context) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'model')) return body
  const model = body.model
  if (!model || model.mode !== 'fixed') return body
  if (current?.model && JSON.stringify(current.model) === JSON.stringify(model)) return body
  const binding = await resolveModelBinding({ modelRef: profileModelReference(model) }, { context })
  const ref = binding.modelRef
  return {
    ...body,
    model: ref.source === 'cloud'
      ? { mode: 'fixed', source: 'cloud', catalogId: ref.catalogId }
      : { mode: 'fixed', source: 'custom', providerId: ref.providerId, modelId: ref.modelId },
  }
}
import {
  agentProfileSnapshot,
  createCustomAgentProfile,
  deleteCustomAgentProfile,
  getAgentProfile,
  listAgentProfiles,
  listAvailableAgentTools,
  updateBuiltinAgentOverrides,
  updateCustomAgentProfile,
} from '../agent-profiles.mjs'

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeAiJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

async function getApiKey(provider) {
  try {
    const keys = await readStore('provider-keys')
    return keys?.[provider] || undefined
  } catch {
    return undefined
  }
}

function normalizeGeneratedName(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40)
  const normalized = /^[a-z][a-z0-9_-]{1,39}$/.test(raw) && raw !== 'general' && raw !== 'explore' ? raw : ''
  if (!normalized) throw requestError('AI did not generate a valid agent name', 502)
  return normalized
}

function normalizeGeneratedAgentProfile(value) {
  const name = normalizeGeneratedName(value?.name)
  const label = String(value?.label || '').trim().slice(0, 80)
  const description = String(value?.description || '').trim().slice(0, 500)
  const systemPrompt = String(value?.systemPrompt || '').trim()
  if (!label) throw requestError('AI did not generate a display name', 502)
  if (!systemPrompt) throw requestError('AI did not generate a system prompt', 502)
  return { name, label, description, systemPrompt }
}

async function generateAgentProfileWithAi(instruction, modelInput, thinkingLevel = 'off', context = {}) {
  const text = String(instruction || '').trim()
  if (!text) throw requestError('Please describe the agent you want to create')
  if (!modelInput) throw requestError('Please configure a default model first')
  const { model } = await resolveModelBinding(
    modelInput?.modelRef || modelInput?.model ? modelInput : { model: modelInput },
    { context, legacySnapshot: modelInput?.model || modelInput },
  )

  const systemPrompt = `You are a QuickForge Agent Profile generator.
Generate only the basic definition fields for a custom Agent Profile from the user's request.

Return JSON only. Do not use Markdown. Do not explain.

Required JSON shape:
{
  "name": "lowercase identifier, starts with a letter, 2-40 chars, only lowercase letters, numbers, underscores, hyphens",
  "label": "short display name",
  "description": "one concise sentence describing the agent purpose",
  "systemPrompt": "complete system prompt with role, scope, workflow, boundaries, and output expectations"
}

Rules:
- Do not include allowedTools, maxRuntimeMs, maxToolCalls, enabledAsSubagent, or any other fields.
- name must be English-like lowercase ASCII and must not be general or explore.
- systemPrompt should be specific and actionable.
- If the user requests Chinese, write label, description, and systemPrompt in Chinese; otherwise match the user's language.`

  try {
    const stream = streamSimpleWithAiHttpLogging(
      model,
      {
        systemPrompt,
        messages: [{ role: 'user', content: text, timestamp: Date.now() }],
        tools: [],
      },
      {
        apiKey: await getApiKey(model.provider),
        maxTokens: 1600,
        temperature: 0,
        reasoning: thinkingLevel === 'off' ? undefined : thinkingLevel,
        maxRetries: DEFAULT_AI_MAX_RETRIES,
        maxRetryDelayMs: 60000,
      },
    )
    const message = await stream.result()
    const content = Array.isArray(message.content)
      ? message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n')
      : ''
    const parsed = normalizeAiJson(content)
    if (!parsed) throw requestError('AI did not return valid JSON', 502)
    return normalizeGeneratedAgentProfile(parsed)
  } catch (error) {
    if (error?.statusCode) throw error
    logger.warn('AI agent profile generation failed:', error?.message || error)
    throw requestError(`AI generation failed: ${error?.message || 'check model configuration and API key'}`, 502)
  }
}

export async function handleAgentProfilesApi(req, res, url, context = {}) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles') {
    const agents = await listAgentProfiles({ includeDisabled: true })
    sendJson(res, 200, { agents: agents.map(agentProfileSnapshot) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles/available-tools') {
    sendJson(res, 200, { tools: listAvailableAgentTools() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-profiles/ai-fill') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { agent: await generateAgentProfileWithAi(body?.instruction, body?.modelRef ? body : body?.model, body?.thinkingLevel, context) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-profiles') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { agent: await createCustomAgentProfile(await canonicalizeProfileModel(body || {}, null, context)) })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'agent-profiles' && parts[2]) {
    const id = decodeSegment(parts[2])

    if (req.method === 'GET') {
      const agent = await getAgentProfile(id)
      if (!agent) throw requestError('Agent not found', 404)
      sendJson(res, 200, { agent: agentProfileSnapshot(agent) })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const current = await getAgentProfile(id)
      const body = await readJsonBody(req)
      if (current?.builtin) {
        const allowedKeys = ['model', 'thinkingLevel']
        const keys = Object.keys(body || {})
        if (keys.length === 0 || keys.some((key) => !allowedKeys.includes(key))) {
          throw requestError('Built-in agents only allow model and thinkingLevel updates', 403)
        }
        sendJson(res, 200, { agent: agentProfileSnapshot(await updateBuiltinAgentOverrides(id, await canonicalizeProfileModel(body, current, context))) })
        return
      }
      if (current?.readonly) throw requestError('Read-only agents cannot be modified from the API', 403)
      sendJson(res, 200, { agent: await updateCustomAgentProfile(id, await canonicalizeProfileModel(body || {}, current, context)) })
      return
    }

    if (req.method === 'DELETE') {
      const current = await getAgentProfile(id)
      if (current?.builtin) throw requestError('Built-in agents cannot be deleted', 403)
      if (current?.readonly) throw requestError('Read-only agents cannot be deleted from the API', 403)
      await deleteCustomAgentProfile(id)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  throw requestError('Not found', 404)
}
