import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetSlashCatalogCacheForTests, fetchSlashCatalog } from '../../src/lib/slash-catalog'

// ---------------------------------------------------------------------------
// Fetch mock. Responses are routed by URL so the two parallel requests inside
// fetchSlashCatalog can be simulated with plain stubs (node env, no DOM).
// ---------------------------------------------------------------------------

type Route = { url: string; ok?: boolean; payload?: unknown }

const routeResponse = (url: string, routes: Route[]) => {
  const route = routes.find((r) => url === r.url || url.startsWith(`${r.url}&`) || url.startsWith(`${r.url}?`))
  if (!route) throw new Error(`unexpected fetch url: ${url}`)
  if (route.ok === false) return { ok: false, json: async () => ({}) }
  return { ok: true, json: async () => route.payload }
}

const skillsPayload = {
  available: true,
  skills: [
    { name: 'skill-creator', description: 'Create and evaluate agent skills' },
    { name: 'patch-release', description: 'Run the patch release flow' },
  ],
}

const agentsPayload = {
  agents: [
    { name: 'explore', label: 'Read-only research', description: 'Locate files', enabledAsSubagent: true },
    { name: 'hidden-one', label: 'Disabled', description: 'Not a subagent', enabledAsSubagent: false },
    { name: 'general', label: 'General', enabledAsSubagent: true },
  ],
}

const defaultRoutes = (): Route[] => [
  { url: '/api/skills', payload: skillsPayload },
  { url: '/api/agent-profiles', payload: agentsPayload },
]

describe('fetchSlashCatalog', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetSlashCatalogCacheForTests()
    const routes = defaultRoutes()
    fetchMock = vi.fn(async (url: string) => routeResponse(url, routes))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const fetchUrls = () => fetchMock.mock.calls.map(([url]) => String(url))

  it('maps skills and filters agents to enabledAsSubagent only', async () => {
    const catalog = await fetchSlashCatalog()

    expect(catalog).not.toBeNull()
    expect(catalog!.skills).toEqual([
      { name: 'skill-creator', description: 'Create and evaluate agent skills' },
      { name: 'patch-release', description: 'Run the patch release flow' },
    ])
    expect(catalog!.agents).toEqual([
      { name: 'explore', label: 'Read-only research', description: 'Locate files' },
      { name: 'general', label: 'General', description: undefined },
    ])
  })

  it('appends encoded projectId to both endpoints when provided', async () => {
    await fetchSlashCatalog('my proj')

    const urls = fetchUrls()
    expect(urls).toContain('/api/skills?available=true&projectId=my%20proj')
    expect(urls).toContain('/api/agent-profiles?projectId=my%20proj')
  })

  it('omits projectId params entirely when absent', async () => {
    await fetchSlashCatalog()

    const urls = fetchUrls()
    expect(urls).toContain('/api/skills?available=true')
    expect(urls).toContain('/api/agent-profiles')
    expect(urls.every((url) => !url.includes('projectId'))).toBe(true)
  })

  it('returns null when one endpoint responds non-200', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      routeResponse(url, [
        { url: '/api/skills', ok: false },
        { url: '/api/agent-profiles', payload: agentsPayload },
      ]))

    await expect(fetchSlashCatalog()).resolves.toBeNull()
  })

  it('returns null when one endpoint rejects', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/agent-profiles')) throw new Error('network down')
      return routeResponse(String(url), [{ url: '/api/skills', payload: skillsPayload }])
    })

    await expect(fetchSlashCatalog()).resolves.toBeNull()
  })

  it('returns null when a payload shape is invalid', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      routeResponse(String(url), [
        { url: '/api/skills', payload: { available: true, skills: 'not-a-list' } },
        { url: '/api/agent-profiles', payload: agentsPayload },
      ]))

    await expect(fetchSlashCatalog()).resolves.toBeNull()
  })

  it('caches successful results per projectId without refetching', async () => {
    await fetchSlashCatalog('p1')
    await fetchSlashCatalog('p1')
    await fetchSlashCatalog('p1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache failures and refetches on the next call', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    await expect(fetchSlashCatalog('p1')).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await expect(fetchSlashCatalog('p1')).resolves.not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('refetches when the projectId changes', async () => {
    await fetchSlashCatalog('p1')
    await fetchSlashCatalog('p2')
    await fetchSlashCatalog('p1')

    // p1 is cached from the first call; p2 fetches both endpoints fresh.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchUrls()).toContain('/api/skills?available=true&projectId=p2')
    expect(fetchUrls()).toContain('/api/agent-profiles?projectId=p2')
  })
})
