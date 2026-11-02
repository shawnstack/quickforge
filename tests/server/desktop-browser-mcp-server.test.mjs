import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createDesktopBrowserMcpServer } from '../../desktop/browser/mcp-server.mjs'

const TOKEN = 'test-token'

function createFakeHost() {
  const calls = []
  return {
    calls,
    async execute(name, args) {
      calls.push({ name, args })
      if (name === 'snapshot') return { ok: true, text: '- button - Go [ref=e1@g4]', generation: 4, nodeCount: 1, truncated: false }
      if (name === 'navigate') return { ok: false, message: 'Blocked by the desktop browser policy' }
      if (name === 'screenshot') return { ok: true, message: 'Saved screenshot.', path: '/tmp/shot.png' }
      return { ok: true, message: name + ' ok' }
    },
  }
}

async function connect(host) {
  const runtime = await createDesktopBrowserMcpServer({ host, token: TOKEN })
  const client = new Client({ name: 'quickforge-test', version: '1.0.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(runtime.url), {
    requestInit: { headers: { authorization: 'Bearer ' + TOKEN } },
  })
  await client.connect(transport)
  return { runtime, client }
}

describe('desktop browser MCP server', () => {
  const disposers = []

  afterEach(async () => {
    while (disposers.length) {
      const dispose = disposers.pop()
      await dispose().catch(() => {})
    }
  })

  it('publishes the tool set with read-only hints', async () => {
    const { client, runtime } = await connect(createFakeHost())
    disposers.push(async () => { await client.close(); await runtime.close() })
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
    expect(Object.keys(byName).sort()).toEqual(['click', 'evaluate', 'navigate', 'press_key', 'screenshot', 'scroll', 'snapshot', 'type', 'wait_for'])
    expect(byName.snapshot.annotations.readOnlyHint).toBe(true)
    expect(byName.screenshot.annotations.readOnlyHint).toBe(true)
    expect(byName.wait_for.annotations.readOnlyHint).toBe(true)
    expect(byName.click.annotations.readOnlyHint).toBe(false)
    expect(byName.evaluate.annotations.destructiveHint).toBe(true)
  })

  it('forwards calls and formats snapshots', async () => {
    const host = createFakeHost()
    const { client, runtime } = await connect(host)
    disposers.push(async () => { await client.close(); await runtime.close() })
    const result = await client.callTool({ name: 'snapshot', arguments: {} })
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('- button - Go [ref=e1@g4]')
    expect(result.content[0].text).toContain('generation=g4')
    expect(host.calls).toEqual([{ name: 'snapshot', args: {} }])
  })

  it('marks policy rejections as errors and appends screenshot paths', async () => {
    const host = createFakeHost()
    const { client, runtime } = await connect(host)
    disposers.push(async () => { await client.close(); await runtime.close() })
    const blocked = await client.callTool({ name: 'navigate', arguments: { url: 'http://127.0.0.1:5177' } })
    expect(blocked.isError).toBe(true)
    expect(blocked.content[0].text).toContain('Blocked by the desktop browser policy')
    const shot = await client.callTool({ name: 'screenshot', arguments: {} })
    expect(shot.content[0].text).toContain('path: /tmp/shot.png')
  })

  it('rejects requests without the bearer token', async () => {
    const host = createFakeHost()
    const runtime = await createDesktopBrowserMcpServer({ host, token: TOKEN })
    disposers.push(() => runtime.close())
    const response = await fetch(runtime.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })
    expect(response.status).toBe(401)
    expect(host.calls).toEqual([])
  })

  it('refuses GET in stateless mode', async () => {
    const host = createFakeHost()
    const runtime = await createDesktopBrowserMcpServer({ host, token: TOKEN })
    disposers.push(() => runtime.close())
    const response = await fetch(runtime.url, { method: 'GET', headers: { authorization: 'Bearer ' + TOKEN } })
    expect(response.status).toBe(405)
  })

  it('rejects unknown tool names', async () => {
    const host = createFakeHost()
    const { client, runtime } = await connect(host)
    disposers.push(async () => { await client.close(); await runtime.close() })
    const result = await client.callTool({ name: 'rm_rf', arguments: {} })
    expect(result.isError).toBe(true)
    expect(host.calls).toEqual([])
  })
})
