import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  servers: [],
  clients: [],
  transports: [],
  connectBehavior: 'success',
  connectControls: new Map(),
  listToolsBehavior: 'success',
  callToolBehavior: 'success',
}))

function pendingUntilAbort(options) {
  return new Promise((_, reject) => {
    options?.signal?.addEventListener('abort', () => {
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
}

class MockClient {
  constructor() {
    this.connect = vi.fn((transport) => {
      this.transport = transport
      if (mocks.connectBehavior === 'pending') return new Promise(() => {})
      if (mocks.connectBehavior === 'controlled') {
        return new Promise((resolve, reject) => {
          mocks.connectControls.set(transport.options.command, { resolve, reject })
        })
      }
      return Promise.resolve()
    })
    this.listTools = vi.fn((_params, options) => {
      if (mocks.listToolsBehavior === 'pending') return pendingUntilAbort(options)
      return Promise.resolve({
        tools: [{
          name: 'echo',
          title: 'Echo',
          description: 'Echo input',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        }],
      })
    })
    this.callTool = vi.fn((_params, _resultSchema, options) => {
      if (mocks.callToolBehavior === 'pending') return pendingUntilAbort(options)
      return Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { echoed: true },
      })
    })
    mocks.clients.push(this)
  }
}

class MockTransport {
  static closeDelayMs = 0

  constructor(options) {
    this.options = options
    this.stderr = { on: vi.fn() }
    this.close = vi.fn(async () => {
      if (MockTransport.closeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, MockTransport.closeDelayMs))
      }
      this.onclose?.()
    })
    mocks.transports.push(this)
  }
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: MockTransport }))
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: MockTransport }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: MockTransport }))
vi.mock('../../server/mcp/config.mjs', () => ({
  readMcpServers: vi.fn(async () => mocks.servers),
}))

function enabledServer(name = 'demo') {
  return {
    name,
    enabled: true,
    transport: 'stdio',
    command: `mock-mcp-${name}`,
    args: [],
    cwd: '',
    env: {},
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  mocks.servers = [enabledServer()]
  mocks.clients.length = 0
  mocks.transports.length = 0
  mocks.connectBehavior = 'success'
  mocks.connectControls.clear()
  mocks.listToolsBehavior = 'success'
  mocks.callToolBehavior = 'success'
  MockTransport.closeDelayMs = 0
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.resetModules()
})

afterEach(async () => {
  try {
    const registry = await import('../../server/mcp/registry.mjs')
    await registry.shutdownMcpConnections()
  } finally {
    vi.useRealTimers()
    vi.resetModules()
  }
})

describe('MCP registry lifecycle', () => {
  it('closes the transport when connect times out', async () => {
    mocks.connectBehavior = 'pending'
    const registry = await import('../../server/mcp/registry.mjs')

    const refresh = registry.refreshMcpConnections()
    await vi.advanceTimersByTimeAsync(15_000)
    await refresh

    expect(mocks.transports).toHaveLength(1)
    expect(mocks.transports[0].close).toHaveBeenCalledOnce()
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'error' }),
    ])
  })

  it('closes the connected transport when tool discovery times out', async () => {
    mocks.listToolsBehavior = 'pending'
    const registry = await import('../../server/mcp/registry.mjs')

    const refresh = registry.refreshMcpConnections()
    await vi.advanceTimersByTimeAsync(15_000)
    await refresh

    expect(mocks.clients[0].connect).toHaveBeenCalledOnce()
    expect(mocks.clients[0].listTools).toHaveBeenCalledOnce()
    expect(mocks.transports[0].close).toHaveBeenCalledOnce()
  })

  it('starts enabled server connections in parallel, isolates failures, and keeps definition order', async () => {
    mocks.servers = [enabledServer('first'), enabledServer('failing'), enabledServer('second')]
    mocks.connectBehavior = 'controlled'
    const registry = await import('../../server/mcp/registry.mjs')

    const definitionsPromise = registry.createMcpToolDefinitions()
    await vi.advanceTimersByTimeAsync(0)

    expect([...mocks.connectControls.keys()]).toEqual([
      'mock-mcp-first',
      'mock-mcp-failing',
      'mock-mcp-second',
    ])
    expect(mocks.clients).toHaveLength(3)

    mocks.connectControls.get('mock-mcp-second').resolve()
    mocks.connectControls.get('mock-mcp-failing').reject(new Error('connection failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.clients[2].listTools).toHaveBeenCalledOnce()
    expect(mocks.clients[0].listTools).not.toHaveBeenCalled()

    mocks.connectControls.get('mock-mcp-first').resolve()
    await expect(definitionsPromise).resolves.toEqual([
      expect.objectContaining({ name: 'mcp__first__echo' }),
      expect.objectContaining({ name: 'mcp__second__echo' }),
    ])
  })

  it('keeps successful tool discovery and call results unchanged', async () => {
    const registry = await import('../../server/mcp/registry.mjs')

    const definitions = await registry.createMcpToolDefinitions()
    const result = await registry.callMcpTool('mcp__demo__echo', { text: 'hello' })

    expect(definitions).toEqual([
      expect.objectContaining({
        name: 'mcp__demo__echo',
        label: 'Echo',
        description: '[MCP:demo] Echo input',
      }),
    ])
    expect(result).toEqual({
      isError: false,
      content: 'ok',
      details: {
        mcp: true,
        server: 'demo',
        tool: 'echo',
        structuredContent: { echoed: true },
      },
    })
    expect(mocks.transports[0].close).not.toHaveBeenCalled()
  })

  it('cancels a timed out tool call and rebuilds the connection on the next call', async () => {
    const registry = await import('../../server/mcp/registry.mjs')
    await registry.refreshMcpConnections()
    mocks.callToolBehavior = 'pending'
    MockTransport.closeDelayMs = 100

    const call = registry.callMcpTool('mcp__demo__echo', { payload: 'large input' })
    const rejection = expect(call).rejects.toThrow('MCP tool mcp__demo__echo timed out')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.transports[0].close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    await rejection

    mocks.callToolBehavior = 'success'
    MockTransport.closeDelayMs = 0
    await expect(registry.callMcpTool('mcp__demo__echo', {})).resolves.toMatchObject({ content: 'ok' })
    expect(mocks.clients).toHaveLength(2)
  })

  it('still supports reconnecting, disabling, and deleting servers', async () => {
    const registry = await import('../../server/mcp/registry.mjs')
    await registry.refreshMcpConnections()

    await registry.reconnectMcpServer('demo')
    expect(mocks.transports[0].close).toHaveBeenCalledOnce()
    expect(mocks.clients).toHaveLength(2)

    mocks.servers = [{ ...enabledServer(), enabled: false }]
    await registry.refreshMcpConnections()
    expect(mocks.transports[1].close).toHaveBeenCalledOnce()
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'disabled' }),
    ])

    mocks.servers = []
    await registry.refreshMcpConnections()
    await expect(registry.getMcpStatus()).resolves.toEqual([])
  })

  it('returns a cached snapshot immediately when waitForConnections is false, then converges in the background', async () => {
    // Date is faked here so the 30s error retry cooldown can elapse deterministically.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const registry = await import('../../server/mcp/registry.mjs')

    // Seed an error connection past its retry cooldown.
    mocks.connectBehavior = 'pending'
    const seed = registry.refreshMcpConnections()
    await vi.advanceTimersByTimeAsync(15_000)
    await seed
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'error' }),
    ])
    await vi.advanceTimersByTimeAsync(30_000)

    // Snapshot mode returns immediately without waiting for the retry connect.
    mocks.connectBehavior = 'controlled'
    const snapshot = await registry.createMcpToolDefinitions({ waitForConnections: false })
    expect(snapshot).toEqual([])

    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.connectControls.has('mock-mcp-demo')).toBe(true)

    // The fire-and-forget background refresh completes and exposes the tool.
    mocks.connectControls.get('mock-mcp-demo').resolve()
    await vi.advanceTimersByTimeAsync(0)
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'connected', toolCount: 1 }),
    ])
    await expect(registry.createMcpToolDefinitions()).resolves.toEqual([
      expect.objectContaining({ name: 'mcp__demo__echo' }),
    ])
  })

  it('reconnects disconnected servers only when reconnectDisconnected is requested', async () => {
    const registry = await import('../../server/mcp/registry.mjs')
    await registry.refreshMcpConnections()
    expect(mocks.clients).toHaveLength(1)

    // Simulate a server-side transport close (no error status).
    mocks.transports[0].onclose()
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'disconnected' }),
    ])
    expect(mocks.clients).toHaveLength(1)

    await registry.refreshMcpConnections({ reconnectDisconnected: true })
    expect(mocks.transports[0].close).toHaveBeenCalledOnce()
    expect(mocks.clients).toHaveLength(2)
    await expect(registry.getMcpStatus()).resolves.toEqual([
      expect.objectContaining({ name: 'demo', status: 'connected' }),
    ])
  })

  it('notifies toolset subscribers only when the connected toolset changes', async () => {
    const registry = await import('../../server/mcp/registry.mjs')
    const listener = vi.fn()
    const unsubscribe = registry.subscribeMcpToolsetChanged(listener)

    await registry.refreshMcpConnections()
    expect(listener).toHaveBeenCalledTimes(1) // baseline is null → first refresh notifies

    await registry.refreshMcpConnections()
    expect(listener).toHaveBeenCalledTimes(1) // unchanged toolset → no notify

    mocks.servers = []
    await registry.refreshMcpConnections()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    mocks.servers = [enabledServer()]
    await registry.refreshMcpConnections()
    expect(listener).toHaveBeenCalledTimes(2) // no subscribers → baseline-only update
  })
})
