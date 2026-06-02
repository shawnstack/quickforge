import { streamSimple } from '@earendil-works/pi-ai'
import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore } from '../storage.mjs'
import { logger } from '../utils/logger.mjs'
import {
  createCustomAgentProfile,
  deleteCustomAgentProfile,
  getAgentProfile,
  listAgentProfiles,
  listAvailableAgentTools,
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

async function generateAgentProfileWithAi(instruction, model, thinkingLevel = 'off') {
  const text = String(instruction || '').trim()
  if (!text) throw requestError('Please describe the agent you want to create')
  if (!model) throw requestError('Please configure a default model first')

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
    const stream = streamSimple(
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

export async function handleAgentProfilesApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean)

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles') {
    sendJson(res, 200, { agents: await listAgentProfiles({ includeDisabled: true }) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/agent-profiles/available-tools') {
    sendJson(res, 200, { tools: listAvailableAgentTools() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-profiles/ai-fill') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { agent: await generateAgentProfileWithAi(body?.instruction, body?.model, body?.thinkingLevel) })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/agent-profiles') {
    const body = await readJsonBody(req)
    sendJson(res, 200, { agent: await createCustomAgentProfile(body || {}) })
    return
  }

  if (parts[0] === 'api' && parts[1] === 'agent-profiles' && parts[2]) {
    const id = decodeSegment(parts[2])

    if (req.method === 'GET') {
      const agent = await getAgentProfile(id)
      if (!agent) throw requestError('Agent not found', 404)
      sendJson(res, 200, { agent })
      return
    }

    if (req.method === 'PATCH' || req.method === 'PUT') {
      const current = await getAgentProfile(id)
      if (current?.builtin) throw requestError('Built-in agents cannot be modified', 403)
      const body = await readJsonBody(req)
      sendJson(res, 200, { agent: await updateCustomAgentProfile(id, body || {}) })
      return
    }

    if (req.method === 'DELETE') {
      const current = await getAgentProfile(id)
      if (current?.builtin) throw requestError('Built-in agents cannot be deleted', 403)
      await deleteCustomAgentProfile(id)
      sendJson(res, 200, { ok: true })
      return
    }
  }

  throw requestError('Not found', 404)
}
