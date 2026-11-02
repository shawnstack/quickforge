import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stores: new Map() }))
vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async (name) => structuredClone(mocks.stores.get(name) ?? {})),
  atomicUpdate: vi.fn(async (name, updater) => {
    const next = await updater(structuredClone(mocks.stores.get(name) ?? {}))
    mocks.stores.set(name, structuredClone(next))
    return structuredClone(next)
  }),
}))

const { deleteMcpServer, readMcpServers, setMcpServerEnabled, upsertMcpServer } = await import('../../server/mcp/config.mjs')

const DESKTOP_URL = 'QUICKFORGE_DESKTOP_BROWSER_URL'
const DESKTOP_TOKEN = 'QUICKFORGE_DESKTOP_BROWSER_TOKEN'

function stubRuntime(url, token) {
  if (url) vi.stubEnv(DESKTOP_URL, url)
  if (token) vi.stubEnv(DESKTOP_TOKEN, token)
}

beforeEach(() => {
  mocks.stores.clear()
  vi.stubEnv(DESKTOP_URL, '')
  vi.stubEnv(DESKTOP_TOKEN, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('desktop browser MCP server registration', () => {
  it('is derived from the desktop runtime environment and never written to disk', async () => {
    stubRuntime('http://127.0.0.1:4321/mcp', 'secret-token')

    const servers = await readMcpServers()
    const desktop = servers.find((server) => server.name === 'desktop-browser')

    expect(desktop).toMatchObject({
      name: 'desktop-browser',
      enabled: true,
      transport: 'http',
      url: 'http://127.0.0.1:4321/mcp',
      builtin: true,
    })
    expect(desktop.env).toEqual({ authorization: 'Bearer secret-token' })
    expect(mocks.stores.has('mcp')).toBe(false)
  })

  it('is absent on web/cli where the bridge does not exist', async () => {
    const servers = await readMcpServers()
    expect(servers.some((server) => server.name === 'desktop-browser')).toBe(false)
    expect(servers.map((server) => server.name)).toEqual(['playwright'])
  })

  it('drops a stale persisted entry once the runtime is gone', async () => {
    mocks.stores.set('mcp', {
      mcpServers: [{ name: 'desktop-browser', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: true }],
    })
    const servers = await readMcpServers()
    expect(servers.some((server) => server.name === 'desktop-browser')).toBe(false)
  })

  it('persists only the enabled flag and rebuilds endpoint/token from the environment', async () => {
    stubRuntime('http://127.0.0.1:1111/mcp', 'token-one')

    await setMcpServerEnabled('desktop-browser', false)
    const stored = mocks.stores.get('mcp').mcpServers.find((server) => server.name === 'desktop-browser')
    expect(stored).toMatchObject({ name: 'desktop-browser', enabled: false, env: {} })
    expect(JSON.stringify(mocks.stores.get('mcp'))).not.toContain('token-one')

    stubRuntime('http://127.0.0.1:2222/mcp', 'token-two')
    const servers = await readMcpServers()
    const desktop = servers.find((server) => server.name === 'desktop-browser')
    expect(desktop.url).toBe('http://127.0.0.1:2222/mcp')
    expect(desktop.env.authorization).toBe('Bearer token-two')
    expect(desktop.enabled).toBe(false)
  })

  it('cannot be deleted or edited through the MCP settings routes', async () => {
    await expect(deleteMcpServer('desktop-browser')).rejects.toMatchObject({ statusCode: 409 })
    await expect(upsertMcpServer({ name: 'desktop-browser', transport: 'http', url: 'https://evil.example/mcp' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })
})
