import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMcpApi } from '../../../server/routes/mcp.mjs'

const mocks = vi.hoisted(() => ({
  refreshAllSessionTools: vi.fn(),
  normalizeMcpServerConfig: vi.fn(),
  normalizeMcpServers: vi.fn(),
  readMcpServers: vi.fn(),
  writeMcpServers: vi.fn(),
  upsertMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  refreshMcpConnections: vi.fn(),
  reconnectMcpServer: vi.fn(),
  getMcpStatus: vi.fn(),
  createMcpToolDefinitions: vi.fn(),
  isMcpToolName: vi.fn(),
  subscribeMcpToolsetChanged: vi.fn(),
  callMcpTool: vi.fn(),
  shutdownMcpConnections: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  refreshAllSessionTools: mocks.refreshAllSessionTools,
}))

vi.mock('../../../server/mcp/config.mjs', () => ({
  normalizeMcpServerConfig: mocks.normalizeMcpServerConfig,
  normalizeMcpServers: mocks.normalizeMcpServers,
  readMcpServers: mocks.readMcpServers,
  writeMcpServers: mocks.writeMcpServers,
  upsertMcpServer: mocks.upsertMcpServer,
  deleteMcpServer: mocks.deleteMcpServer,
  setMcpServerEnabled: mocks.setMcpServerEnabled,
}))

vi.mock('../../../server/mcp/registry.mjs', () => ({
  refreshMcpConnections: mocks.refreshMcpConnections,
  reconnectMcpServer: mocks.reconnectMcpServer,
  getMcpStatus: mocks.getMcpStatus,
  createMcpToolDefinitions: mocks.createMcpToolDefinitions,
  isMcpToolName: mocks.isMcpToolName,
  subscribeMcpToolsetChanged: mocks.subscribeMcpToolsetChanged,
  callMcpTool: mocks.callMcpTool,
  shutdownMcpConnections: mocks.shutdownMcpConnections,
}))

function jsonRequest(method, value) {
  const request = Readable.from([Buffer.from(JSON.stringify(value))])
  request.method = method
  request.headers = {}
  return request
}

function emptyRequest(method) {
  const request = Readable.from([])
  request.method = method
  request.headers = {}
  return request
}

function mockResponse() {
  return {
    status: null,
    body: null,
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

async function api(method, pathname, body) {
  const response = mockResponse()
  await handleMcpApi(
    body === undefined ? emptyRequest(method) : jsonRequest(method, body),
    response,
    new URL(`http://localhost${pathname}`),
  )
  return response
}

describe('mcp route', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.normalizeMcpServers.mockImplementation((value) => (Array.isArray(value) ? value : []))
    mocks.getMcpStatus.mockResolvedValue([{ name: 'srv', connected: true }])
    mocks.refreshMcpConnections.mockResolvedValue(undefined)
    mocks.refreshAllSessionTools.mockResolvedValue(2)
    mocks.upsertMcpServer.mockImplementation(async (server) => server)
    mocks.readMcpServers.mockResolvedValue([{ name: 'saved' }])
    mocks.reconnectMcpServer.mockResolvedValue(undefined)
    mocks.deleteMcpServer.mockResolvedValue(undefined)
    mocks.setMcpServerEnabled.mockResolvedValue(undefined)
    mocks.writeMcpServers.mockResolvedValue(undefined)
  })

  it('returns the wrapped mcp status without refreshing connections', async () => {
    const response = await api('GET', '/api/mcp/servers')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ servers: [{ name: 'srv', connected: true }] })
    expect(mocks.refreshMcpConnections).not.toHaveBeenCalled()
    expect(mocks.refreshAllSessionTools).not.toHaveBeenCalled()
  })

  it('upserts body.server and responds with the refreshed payload', async () => {
    const server = { name: 'docs', command: 'npx' }
    const response = await api('PUT', '/api/mcp/servers', { server })

    expect(mocks.upsertMcpServer).toHaveBeenCalledWith(server)
    expect(mocks.refreshMcpConnections).toHaveBeenCalledTimes(1)
    expect(mocks.refreshAllSessionTools).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      servers: [{ name: 'srv', connected: true }],
      refreshedSessions: 2,
      saved: server,
    })
  })

  it('upserts a bare body when no server wrapper is provided', async () => {
    const bare = { name: 'bare', command: 'npx' }
    const response = await api('PUT', '/api/mcp/servers', bare)

    expect(mocks.upsertMcpServer).toHaveBeenCalledWith(bare)
    expect(response.body.saved).toEqual(bare)
  })

  it('merges config imports by upserting each server', async () => {
    const servers = [{ name: 'one' }, { name: 'two' }]
    const response = await api('PUT', '/api/mcp/config', { servers })

    expect(mocks.normalizeMcpServers).toHaveBeenCalledWith(servers)
    expect(mocks.upsertMcpServer).toHaveBeenCalledTimes(2)
    expect(mocks.upsertMcpServer).toHaveBeenNthCalledWith(1, { name: 'one' })
    expect(mocks.upsertMcpServer).toHaveBeenNthCalledWith(2, { name: 'two' })
    expect(mocks.writeMcpServers).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(response.body.refreshedSessions).toBe(2)
  })

  it('replaces the whole config when mode is replace', async () => {
    const servers = [{ name: 'only' }]
    const response = await api('PUT', '/api/mcp/config', { servers, mode: 'replace' })

    expect(mocks.writeMcpServers).toHaveBeenCalledTimes(1)
    expect(mocks.writeMcpServers).toHaveBeenCalledWith(servers)
    expect(mocks.upsertMcpServer).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('accepts the mcpServers field name for config imports', async () => {
    const mcpServers = [{ name: 'legacy' }]
    await api('PUT', '/api/mcp/config', { mcpServers })

    expect(mocks.normalizeMcpServers).toHaveBeenCalledWith(mcpServers)
    expect(mocks.upsertMcpServer).toHaveBeenCalledWith({ name: 'legacy' })
  })

  it('decodes server names and only enables on strict true', async () => {
    await api('PUT', '/api/mcp/servers/name%20one/enabled', { enabled: true })
    expect(mocks.setMcpServerEnabled).toHaveBeenCalledWith('name one', true)

    await api('PUT', '/api/mcp/servers/name%20one/enabled', { enabled: 'true' })
    expect(mocks.setMcpServerEnabled).toHaveBeenLastCalledWith('name one', false)
  })

  it('reconnects a decoded server name', async () => {
    const response = await api('POST', '/api/mcp/reconnect/my%20server')
    expect(mocks.reconnectMcpServer).toHaveBeenCalledWith('my server')
    expect(mocks.refreshMcpConnections).toHaveBeenCalledTimes(1)
    expect(response.status).toBe(200)
    expect(response.body.servers).toEqual([{ name: 'srv', connected: true }])
  })

  it('deletes a decoded server name', async () => {
    const response = await api('DELETE', '/api/mcp/servers/old-one')
    expect(mocks.deleteMcpServer).toHaveBeenCalledWith('old-one')
    expect(response.status).toBe(200)
    expect(response.body.refreshedSessions).toBe(2)
  })

  it('propagates builtin deletion refusal without refreshing connections or sessions', async () => {
    const error = Object.assign(new Error('Built-in MCP server cannot be deleted: playwright'), { statusCode: 409 })
    mocks.deleteMcpServer.mockRejectedValueOnce(error)
    await expect(api('DELETE', '/api/mcp/servers/playwright')).rejects.toBe(error)
    expect(mocks.refreshMcpConnections).not.toHaveBeenCalled()
    expect(mocks.refreshAllSessionTools).not.toHaveBeenCalled()
  })

  it('returns the raw stored config', async () => {
    const response = await api('GET', '/api/mcp/config')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ servers: [{ name: 'saved' }] })
    expect(mocks.readMcpServers).toHaveBeenCalledTimes(1)
  })

  it('falls through to 404 for unmatched routes', async () => {
    await expect(api('GET', '/api/mcp/unknown')).rejects.toMatchObject({ statusCode: 404 })
  })
})
