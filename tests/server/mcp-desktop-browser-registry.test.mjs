import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * 桌面浏览器 MCP 的服务端链路端到端：env → 内置配置 → registry 连接 → 工具定义（含 annotations）→ 审批判定 → 工具调用。
 * 链路里真正影响安全的是 isReadOnlyMcpTool：审批层靠它豁免只读工具的逐次确认。
 * 注解若在 config → registry 的某一跳被丢掉，豁免会静默失效（弹窗变多，用户会去开完全访问），
 * 所以这里用真实连接覆盖，而不是只做源码字符串断言。
 */

const mocks = vi.hoisted(() => ({ stores: new Map() }))
vi.mock('../../server/storage.mjs', () => ({
  readStore: vi.fn(async (name) => structuredClone(mocks.stores.get(name) ?? {})),
  atomicUpdate: vi.fn(async (name, updater) => {
    const next = await updater(structuredClone(mocks.stores.get(name) ?? {}))
    mocks.stores.set(name, structuredClone(next))
    return structuredClone(next)
  }),
}))

const { createDesktopBrowserMcpServer } = await import('../../desktop/browser/mcp-server.mjs')
const registry = await import('../../server/mcp/registry.mjs')

const TOKEN = 'registry-token'

function createFakeHost() {
  const calls = []
  return {
    calls,
    async execute(name, args) {
      calls.push({ name, args })
      if (name === 'snapshot') return { ok: true, text: '- button - Go [ref=e1@g2]', generation: 2, nodeCount: 1, truncated: false }
      if (name === 'navigate') return { ok: false, message: 'Blocked by the desktop browser policy: private address 127.0.0.1' }
      return { ok: true, message: name + ' ok' }
    },
  }
}

const host = createFakeHost()
let runtime = null

beforeAll(async () => {
  runtime = await createDesktopBrowserMcpServer({ host, token: TOKEN })
  vi.stubEnv('QUICKFORGE_DESKTOP_BROWSER_URL', runtime.url)
  vi.stubEnv('QUICKFORGE_DESKTOP_BROWSER_TOKEN', TOKEN)
})

afterAll(async () => {
  await registry.shutdownMcpConnections()
  await runtime?.close()
  vi.unstubAllEnvs()
})

describe('desktop browser MCP registry wiring', () => {
  it('exposes the built-in server tools under the canonical MCP naming', async () => {
    const definitions = await registry.createMcpToolDefinitions()
    const byName = Object.fromEntries(definitions.map((definition) => [definition.name, definition]))
    expect(Object.keys(byName).length).toBe(9)
    const snapshot = byName['mcp__desktop-browser__snapshot']
    expect(snapshot).toBeTruthy()
    expect(snapshot.description).toContain('[MCP:desktop-browser]')
    expect(snapshot.parameters).toMatchObject({ type: 'object' })
    expect(snapshot.mcp).toEqual({ serverName: 'desktop-browser', toolName: 'snapshot' })
    expect(snapshot.annotations).toMatchObject({ readOnlyHint: true })
    expect(registry.isMcpToolName('mcp__desktop-browser__snapshot')).toBe(true)
  })

  it('drives the approval exemption from live annotations', async () => {
    for (const readOnly of ['snapshot', 'screenshot', 'wait_for']) {
      expect(registry.isReadOnlyMcpTool('mcp__desktop-browser__' + readOnly)).toBe(true)
    }
    for (const mutating of ['navigate', 'click', 'type', 'press_key', 'scroll', 'evaluate']) {
      expect(registry.isReadOnlyMcpTool('mcp__desktop-browser__' + mutating)).toBe(false)
    }
    expect(registry.isReadOnlyMcpTool('mcp__nope__snapshot')).toBe(false)
    expect(registry.isReadOnlyMcpTool('read_file')).toBe(false)
  })

  it('returns snapshot text and policy rejections through the registry call path', async () => {
    const snapshot = await registry.callMcpTool('mcp__desktop-browser__snapshot', {})
    expect(snapshot.isError).toBe(false)
    expect(snapshot.content).toContain('- button - Go [ref=e1@g2]')
    expect(snapshot.content).toContain('generation=g2')
    expect(snapshot.details).toMatchObject({ mcp: true, server: 'desktop-browser', tool: 'snapshot' })
    const blocked = await registry.callMcpTool('mcp__desktop-browser__navigate', { url: 'http://127.0.0.1:5177' })
    expect(blocked.isError).toBe(true)
    expect(blocked.content).toContain('Blocked by the desktop browser policy')
    expect(host.calls.map((call) => call.name)).toEqual(['snapshot', 'navigate'])
  })
})
