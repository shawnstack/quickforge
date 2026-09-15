import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { atomicUpdate } from '../../server/storage.mjs'

const mocks = vi.hoisted(() => ({ stores: new Map() }))
vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async (name) => structuredClone(mocks.stores.get(name) ?? {})),
  atomicUpdate: vi.fn(async (name, updater) => {
    const next = await updater(structuredClone(mocks.stores.get(name) ?? {}))
    mocks.stores.set(name, structuredClone(next))
    return structuredClone(next)
  }),
}))
const { deleteMcpServer, normalizeMcpServerConfig, normalizeMcpServers, readMcpServers, setMcpServerEnabled, upsertMcpServer, writeMcpServers } = await import('../../server/mcp/config.mjs')
beforeEach(() => { mocks.stores.clear(); vi.mocked(atomicUpdate).mockClear() })
const stdioServer = (overrides = {}) => ({ name: 'docs', command: 'npx', ...overrides })
const httpServer = (overrides = {}) => ({ name: 'web', transport: 'http', url: 'https://example.com/mcp', ...overrides })
const withMetadata = (servers) => servers.map((server) => server.name === 'playwright' ? { ...server, builtin: true } : server)
const preset = { name: 'playwright', enabled: false, transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], url: '', cwd: '', env: {}, updatedAt: expect.any(String) }
const otherServers = (count) => Array.from({ length: count }, (_, i) => normalizeMcpServerConfig(stdioServer({ name: `srv-${i}` })))

describe('Playwright MCP preset', () => {
  it('derives a disabled builtin npx preset without writing, with independent args', async () => {
    expect(await readMcpServers()).toEqual([{ ...preset, builtin: true }])
    expect(mocks.stores.has('mcp')).toBe(false)
    const stored = { mcpServers: [normalizeMcpServerConfig(stdioServer())], otherSetting: 'keep' }
    mocks.stores.set('mcp', structuredClone(stored))
    const servers = await readMcpServers()
    expect(servers).toEqual([{ ...preset, builtin: true }, ...stored.mcpServers])
    servers[0].args.push('--headless')
    expect(await readMcpServers()).toEqual([{ ...preset, builtin: true }, ...stored.mcpServers])
    expect(mocks.stores.get('mcp')).toEqual(stored)
    expect(atomicUpdate).not.toHaveBeenCalled()
  })
  it.each([true, false])('atomically materializes first toggle to %s without metadata in store', async (enabled) => {
    const other = normalizeMcpServerConfig(stdioServer())
    mocks.stores.set('mcp', { mcpServers: [other], otherSetting: 'keep' })
    const servers = await setMcpServerEnabled(' Playwright ', enabled)
    expect(atomicUpdate).toHaveBeenCalledTimes(1)
    expect(servers).toEqual([{ ...preset, enabled }, other])
    expect(mocks.stores.get('mcp')).toEqual({ mcpServers: servers, otherSetting: 'keep' })
    expect(await readMcpServers()).toEqual(withMetadata(servers))
    const toggled = await setMcpServerEnabled('playwright', !enabled)
    expect(toggled).toEqual([{ ...preset, enabled: !enabled }, other])
    expect(mocks.stores.get('mcp').mcpServers).toEqual(toggled)
  })
  it.each([
    stdioServer({ name: ' Playwright ', command: 'custom-node', args: ['custom-cli'], cwd: 'custom/work', env: { CUSTOM: 'yes' }, url: 'https://example.com/info', enabled: true }),
    stdioServer({ name: 'playwright', command: 'custom-disabled', args: ['--headless'], env: { CUSTOM: 'no' }, enabled: false }),
    httpServer({ name: 'PLAYWRIGHT', headers: { 'X-Custom': 'value' }, enabled: true }),
    httpServer({ name: 'playwright', transport: 'sse', env: { 'X-Custom': 'value' }, enabled: false }),
  ])('preserves custom configuration and order: $command $transport $enabled', async (configured) => {
    const raw = { ...configured, updatedAt: '2024-01-01T00:00:00.000Z' }
    const expected = normalizeMcpServerConfig(raw)
    const other = normalizeMcpServerConfig(stdioServer())
    mocks.stores.set('mcp', { mcpServers: [other, raw] })
    expect(await readMcpServers()).toEqual([other, { ...expected, builtin: true }])
    expect(mocks.stores.get('mcp').mcpServers).toEqual([other, raw])
    const toggled = await setMcpServerEnabled('playwright', !expected.enabled)
    expect(toggled).toEqual([other, { ...expected, enabled: !expected.enabled, updatedAt: expect.any(String) }])
    expect(mocks.stores.get('mcp').mcpServers).toEqual(toggled)
    expect(await readMcpServers()).toEqual(withMetadata(toggled))
  })
  it.each(['playwright', ' PLAYWRIGHT '])('rejects deletion of absent and configured builtin %s without writing', async (name) => {
    await expect(deleteMcpServer(name)).rejects.toMatchObject({ statusCode: 409, message: 'Built-in MCP server cannot be deleted: playwright' })
    expect(atomicUpdate).not.toHaveBeenCalled()
    expect(mocks.stores.size).toBe(0)
    const stored = { mcpServers: [stdioServer(), stdioServer({ name: 'playwright', command: 'custom', builtin: false })], otherSetting: 'keep' }
    mocks.stores.set('mcp', stored)
    const snapshot = structuredClone(stored)
    await expect(deleteMcpServer(name)).rejects.toMatchObject({ statusCode: 409 })
    expect(atomicUpdate).not.toHaveBeenCalled()
    expect(mocks.stores.get('mcp')).toBe(stored)
    expect(stored).toEqual(snapshot)
  })
  it('does not trust or persist client builtin metadata and still permits editing', async () => {
    const custom = await upsertMcpServer(stdioServer({ name: 'playwright', command: 'custom', builtin: false }))
    expect(custom[0]).not.toHaveProperty('builtin')
    expect((await readMcpServers())[0]).toMatchObject({ builtin: true, command: 'custom' })
    await upsertMcpServer(stdioServer({ builtin: true }))
    expect((await readMcpServers()).find((s) => s.name === 'docs')).not.toHaveProperty('builtin')
    await deleteMcpServer('docs')
    const changed = await upsertMcpServer(httpServer({ name: 'playwright', enabled: false }))
    expect(await readMcpServers()).toEqual(withMetadata(changed))
    expect(mocks.stores.get('mcp').mcpServers[0]).not.toHaveProperty('builtin')
  })
  it('retains bulk replace semantics and a disabled builtin when omitted', async () => {
    await setMcpServerEnabled('playwright', true)
    const replaced = await writeMcpServers([stdioServer(), httpServer({ name: 'playwright', enabled: false })])
    expect(replaced.map((s) => s.name)).toEqual(['docs', 'playwright'])
    expect(replaced[1]).toMatchObject({ transport: 'http', enabled: false })
    expect(await readMcpServers()).toEqual(withMetadata(replaced))
    const without = await writeMcpServers([httpServer()])
    expect(mocks.stores.get('mcp').mcpServers).toEqual(without)
    expect(await readMcpServers()).toEqual([{ ...preset, builtin: true }, ...without])
    expect(await writeMcpServers([])).toEqual([])
    expect(await readMcpServers()).toEqual([{ ...preset, builtin: true }])
    expect(mocks.stores.get('mcp').mcpServers).toEqual([])
  })
  const actions = [
    ['enable', () => setMcpServerEnabled('playwright', true)],
    ['disable', () => setMcpServerEnabled('playwright', false)],
    ['upsert', () => upsertMcpServer({ ...preset, updatedAt: '2024-01-01', enabled: true })],
  ]
  it.each(actions)('rejects first %s at 50 without mutating other services', async (_, act) => {
    const stored = { mcpServers: otherServers(50), otherSetting: 'keep' }
    const snapshot = structuredClone(stored)
    mocks.stores.set('mcp', stored)
    await expect(act()).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.stores.get('mcp')).toBe(stored)
    expect(stored).toEqual(snapshot)
  })
  it.each(actions)('allows first %s at 49 and preserves every other service', async (_, act) => {
    const others = otherServers(49)
    mocks.stores.set('mcp', { mcpServers: others })
    const saved = await act()
    expect(saved).toHaveLength(50)
    expect(saved.filter((s) => s.name !== 'playwright')).toEqual(others)
    expect(mocks.stores.get('mcp').mcpServers).toEqual(saved)
    expect(await readMcpServers()).toEqual(withMetadata(saved))
  })
  it.each(actions)('permits existing builtin %s at capacity', async (_, act) => {
    const others = otherServers(49)
    const existing = normalizeMcpServerConfig(stdioServer({ name: 'playwright', command: 'custom' }))
    mocks.stores.set('mcp', { mcpServers: [...others, existing] })
    const saved = await act()
    expect(saved).toHaveLength(50)
    expect(saved.slice(0, 49)).toEqual(others)
    expect(mocks.stores.get('mcp').mcpServers).toEqual(saved)
  })
  it('does not change ordinary server capacity normalization semantics', async () => {
    const others = otherServers(50)
    mocks.stores.set('mcp', { mcpServers: others })
    expect(await upsertMcpServer(stdioServer({ name: 'extra' }))).toEqual(others)
  })
})

describe('normalizeMcpServerConfig', () => {
  it('fills stdio defaults and a valid timestamp', () => {
    const server = normalizeMcpServerConfig(stdioServer())
    expect(server).toEqual({ name: 'docs', enabled: true, transport: 'stdio', url: '', command: 'npx', args: [], cwd: '', env: {}, updatedAt: expect.any(String) })
    expect(Number.isNaN(Date.parse(server.updatedAt))).toBe(false)
  })
  it('validates objects and names with 400 errors', () => {
    for (const v of [null, undefined, 'docs', 42, [], '']) expect(() => normalizeMcpServerConfig(v)).toThrow('MCP server config must be an object')
    for (const name of ['my_server', 'my.server', '-docs', 'docs-', 'do--cs', '']) expect(() => normalizeMcpServerConfig(stdioServer({ name }))).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(normalizeMcpServerConfig({ command: 'npx' }, ' Docs ').name).toBe('docs')
    expect(normalizeMcpServerConfig(stdioServer({ name: ' DOCS ' })).name).toBe('docs')
  })
  it('supports legacy type and rejects invalid transport and urls', () => {
    expect(normalizeMcpServerConfig({ name: 'web', type: 'http', url: 'https://x.dev' }).transport).toBe('http')
    expect(() => normalizeMcpServerConfig(stdioServer({ transport: 'grpc' }))).toThrow('MCP transport must be stdio, sse, or http')
    for (const url of [undefined, '', 'ftp://example.com', 'not-a-url', 'file:///tmp']) expect(() => normalizeMcpServerConfig(httpServer({ url }))).toThrow(expect.objectContaining({ statusCode: 400 }))
    expect(normalizeMcpServerConfig(httpServer({ command: 'node', args: ['x'], headers: { 'X-Token': ' abc ' } }))).toMatchObject({ command: '', args: [], cwd: '', env: { 'X-Token': 'abc' } })
  })
  it('requires and trims stdio command', () => {
    expect(() => normalizeMcpServerConfig(stdioServer({ command: '   ' }))).toThrow('command is required')
    expect(normalizeMcpServerConfig(stdioServer({ command: ' node ' })).command).toBe('node')
  })
  it('validates args shape and count and trims each argument', () => {
    for (const args of [undefined, null, '']) expect(normalizeMcpServerConfig(stdioServer({ args })).args).toEqual([])
    expect(normalizeMcpServerConfig(stdioServer({ args: [' -y ', 'docs'] })).args).toEqual(['-y', 'docs'])
    expect(() => normalizeMcpServerConfig(stdioServer({ args: 'nope' }))).toThrow('args must be an array')
    expect(() => normalizeMcpServerConfig(stdioServer({ args: Array(101).fill('x') }))).toThrow('args has too many entries')
  })
  it('normalizes env and validates keys and shape', () => {
    for (const env of [undefined, null, '']) expect(normalizeMcpServerConfig(stdioServer({ env })).env).toEqual({})
    expect(normalizeMcpServerConfig(stdioServer({ env: { API_KEY: ' abc ', EMPTY: 42 } })).env).toEqual({ API_KEY: 'abc', EMPTY: '' })
    expect(() => normalizeMcpServerConfig(stdioServer({ env: ['A'] }))).toThrow('env must be an object')
    for (const key of ['1BAD', 'has space', 'a-b']) expect(() => normalizeMcpServerConfig(stdioServer({ env: { [key]: 'x' } }))).toThrow('Invalid environment variable name')
    expect(() => normalizeMcpServerConfig(httpServer({ headers: { 'Bad Header': 'x' } }))).toThrow('Invalid HTTP header name')
  })
  it('normalizes cwd and preserves timestamps and enabled semantics', () => {
    expect(normalizeMcpServerConfig(stdioServer({ cwd: 'rel/dir' })).cwd).toBe(path.resolve('rel/dir'))
    const absolute = path.resolve(path.sep, 'opt', 'work')
    expect(normalizeMcpServerConfig(stdioServer({ cwd: absolute })).cwd).toBe(absolute)
    expect(normalizeMcpServerConfig(stdioServer({ updatedAt: '2024-01-01', enabled: false }))).toMatchObject({ updatedAt: '2024-01-01', enabled: false })
    expect(normalizeMcpServerConfig(stdioServer({ enabled: 0 })).enabled).toBe(true)
  })
})

describe('normalizeMcpServers', () => {
  it('accepts arrays and maps, defaults invalid shapes to empty', () => {
    expect(normalizeMcpServers([stdioServer()])).toHaveLength(1)
    expect(normalizeMcpServers({ docs: { command: 'npx' } })[0]).toMatchObject({ name: 'docs', command: 'npx' })
    for (const value of [null, undefined, 42, 'docs']) expect(normalizeMcpServers(value)).toEqual([])
  })
  it('deduplicates first wins, caps at 50 and propagates entry errors', () => {
    expect(normalizeMcpServers([stdioServer({ command: 'first' }), stdioServer({ command: 'second' })])).toEqual([expect.objectContaining({ command: 'first' })])
    const servers = normalizeMcpServers(otherServers(55))
    expect(servers).toHaveLength(50)
    expect(servers[49].name).toBe('srv-49')
    expect(() => normalizeMcpServers([stdioServer(), stdioServer({ name: 'my_server' })])).toThrow('MCP server name must be')
  })
})

describe('ordinary MCP store CRUD', () => {
  it('reads normalized persisted entries without changing them', async () => {
    mocks.stores.set('mcp', { mcpServers: [stdioServer(), httpServer()] })
    expect((await readMcpServers()).filter((s) => s.name !== 'playwright')).toEqual(normalizeMcpServers([stdioServer(), httpServer()]).map((s) => ({ ...s, updatedAt: expect.any(String) })))
  })
  it('writes normalized entries with refreshed timestamps', async () => {
    const saved = await writeMcpServers([stdioServer({ updatedAt: '2000-01-01' })])
    expect(saved).toHaveLength(1)
    expect(saved[0].updatedAt).not.toBe('2000-01-01')
    expect(mocks.stores.get('mcp').mcpServers).toEqual(saved)
  })
  it('appends and replaces in place', async () => {
    await upsertMcpServer(stdioServer())
    await upsertMcpServer(httpServer())
    const saved = await upsertMcpServer(stdioServer({ command: 'node' }))
    expect(saved.map((s) => s.name)).toEqual(['docs', 'web'])
    expect(saved[0].command).toBe('node')
    expect((await readMcpServers()).filter((s) => s.name !== 'playwright')).toEqual(saved)
  })
  it('deletes ordinary names, is idempotent and validates names', async () => {
    await upsertMcpServer(stdioServer())
    await upsertMcpServer(httpServer())
    expect((await deleteMcpServer('docs')).map((s) => s.name)).toEqual(['web'])
    expect((await deleteMcpServer('ghost')).map((s) => s.name)).toEqual(['web'])
    await expect(deleteMcpServer('BAD_NAME')).rejects.toMatchObject({ statusCode: 400 })
  })
  it('toggles persisted enabled and timestamp and rejects unknown names', async () => {
    await upsertMcpServer(stdioServer())
    const before = mocks.stores.get('mcp').mcpServers[0].updatedAt
    const saved = await setMcpServerEnabled('docs', false)
    expect(saved[0]).toMatchObject({ name: 'docs', enabled: false })
    expect(Date.parse(saved[0].updatedAt)).toBeGreaterThanOrEqual(Date.parse(before))
    expect((await setMcpServerEnabled('docs', true))[0].enabled).toBe(true)
    await expect(setMcpServerEnabled('missing', true)).rejects.toMatchObject({ statusCode: 404 })
  })
})
