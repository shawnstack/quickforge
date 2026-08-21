/**
 * Slash menu catalog client.
 *
 * Loads the skill and agent-profile entries shown in the composer "/" menu
 * (groups: skills + subagents). Both endpoints are fetched in parallel; any
 * failure, non-200 response, or malformed payload degrades silently to a
 * commands-only menu (null result) without blocking the composer.
 */

export type SlashCatalogSkill = {
  name: string
  description?: string
}

export type SlashCatalogAgent = {
  name: string
  label?: string
  description?: string
}

export type SlashCatalog = {
  skills: SlashCatalogSkill[]
  agents: SlashCatalogAgent[]
}

// Module-level cache keyed by projectId ("" when absent). Only successful
// catalogs are cached; failures stay uncached so the next slash-menu open can
// retry, and a different projectId simply fetches under its own key.
const catalogCache = new Map<string, SlashCatalog>()

async function fetchJsonPayload(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response.json()
}

function normalizeSkills(payload: unknown): SlashCatalogSkill[] | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as { skills?: unknown }).skills
  if (!Array.isArray(raw)) return null
  const skills: SlashCatalogSkill[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (typeof record.name !== 'string' || !record.name) continue
    skills.push({
      name: record.name,
      description: typeof record.description === 'string' ? record.description : undefined,
    })
  }
  return skills
}

function normalizeAgents(payload: unknown): SlashCatalogAgent[] | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = (payload as { agents?: unknown }).agents
  if (!Array.isArray(raw)) return null
  const agents: SlashCatalogAgent[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    // Only profiles explicitly enabled as subagents join the slash menu.
    if (record.enabledAsSubagent !== true) continue
    if (typeof record.name !== 'string' || !record.name) continue
    agents.push({
      name: record.name,
      label: typeof record.label === 'string' ? record.label : undefined,
      description: typeof record.description === 'string' ? record.description : undefined,
    })
  }
  return agents
}

export async function fetchSlashCatalog(projectId?: string): Promise<SlashCatalog | null> {
  const cacheKey = projectId ?? ''
  const cached = catalogCache.get(cacheKey)
  if (cached) return cached
  try {
    const skillsUrl = projectId
      ? `/api/skills?available=true&projectId=${encodeURIComponent(projectId)}`
      : '/api/skills?available=true'
    const agentsUrl = projectId
      ? `/api/agent-profiles?projectId=${encodeURIComponent(projectId)}`
      : '/api/agent-profiles'
    const [skillsPayload, agentsPayload] = await Promise.all([
      fetchJsonPayload(skillsUrl),
      fetchJsonPayload(agentsUrl),
    ])
    const skills = normalizeSkills(skillsPayload)
    const agents = normalizeAgents(agentsPayload)
    if (!skills || !agents) return null
    const catalog: SlashCatalog = { skills, agents }
    catalogCache.set(cacheKey, catalog)
    return catalog
  } catch {
    return null
  }
}

export function __resetSlashCatalogCacheForTests() {
  catalogCache.clear()
}
