import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const routeMocks = vi.hoisted(() => ({
  workspaceRoot: '',
  refreshAllSessionTools: vi.fn(async () => 0),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  refreshAllSessionTools: routeMocks.refreshAllSessionTools,
}))

vi.mock('../../../server/project-config.mjs', () => ({
  readProjectConfig: vi.fn(async () => ({
    activeProjectId: 'plugin-ui-project',
    projects: [{ id: 'plugin-ui-project' }],
  })),
  projectContextFromId: vi.fn(() => ({
    id: 'plugin-ui-project',
    workspaceRoot: routeMocks.workspaceRoot,
  })),
}))

const PLUGIN_SOURCE = [
  "import { appendFileSync } from 'node:fs'",
  'export function createPlugin() {',
  '  return {',
  '    ui: {',
  '      getSlots(slotName) {',
  "        if (process.env.QF_UI_TEST_TRACKER) appendFileSync(process.env.QF_UI_TEST_TRACKER, slotName + '\\n')",
  "        if (slotName === 'session.header') return [{ type: 'badge', label: 'dynamic', tone: 'accent' }]",
  '        return undefined',
  '      },',
  '      async handle(action, payload, info) {',
  "        if (action === 'ping') {",
  '          const pings = Number(info.kv.pings || 0) + 1',
  "          return { state: { pings }, toast: { level: 'info', message: 'pong' } }",
  '        }',
  "        if (action === 'rerender') return { slots: { 'composer.actions': [{ type: 'badge', label: 'new' }] } }",
  "        if (action === 'oversize') return { slots: { 'composer.actions': Array.from({ length: 40 }, () => ({ type: 'divider' })) } }",
  "        if (action === 'slow') return new Promise(() => {})",
  "        if (action === 'boom') throw new Error('kaboom')",
  '        return {}',
  '      },',
  '    },',
  '  }',
  '}',
  '',
].join('\n')

const tempDirs = []
const PLUGIN_UI_ACTION_TIMEOUT_MS = 5000
let previousDataDir
let previousTracker
let trackerPath
let testRoot
let workspaceRoot
let pluginDir
let noPermDir

function mockResponse() {
  return {
    status: null,
    body: null,
    headers: null,
    raw: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers || null
    },
    end(body) {
      if (typeof body === 'string' && body.trim().startsWith('{')) this.body = JSON.parse(body)
      else this.raw = body ?? null
    },
    setHeader() {},
  }
}

async function importModules() {
  const registry = await import('../../../server/plugins/registry.mjs')
  const routes = await import('../../../server/routes/plugins.mjs')
  const storage = await import('../../../server/storage.mjs')
  return { registry, routes, storage }
}

async function callRoute(routes, { method, pathname, body, context = { isLocalRequest: true } }) {
  const response = mockResponse()
  const request = {
    method,
    [Symbol.asyncIterator]: async function* iterate() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body))
    },
  }
  await routes.handlePluginsApi(request, response, new URL(`http://localhost${pathname}`), context)
  return response
}

function pluginManifest(overrides = {}) {
  return {
    name: 'ui-test',
    displayName: 'UI Test',
    version: '1.0.0',
    apiVersion: 2,
    enabledByDefault: true,
    main: 'index.mjs',
    permissions: ['ui:composer', 'ui:session', 'ui:sidebar'],
    contributes: {
      ui: {
        slots: {
          'composer.actions': [
            { type: 'button', label: 'Ping', onClick: { action: 'ping' } },
          ],
          'session.header': [
            { type: 'badge', label: 'static', tone: 'neutral' },
          ],
        },
        actions: ['ping', 'rerender', 'oversize', 'slow', 'boom'],
        panels: [{ id: 'main', title: 'Main panel', entry: 'panel/index.html' }],
      },
    },
    ...overrides,
  }
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-plugin-ui-'))
  tempDirs.push(testRoot)
  workspaceRoot = path.join(testRoot, 'workspace')
  pluginDir = path.join(workspaceRoot, '.quickforge', 'plugins', 'ui-test')
  noPermDir = path.join(workspaceRoot, '.quickforge', 'plugins', 'ui-noperm')

  await fs.mkdir(path.join(pluginDir, 'panel'), { recursive: true })
  await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(pluginManifest(), null, 2))
  await fs.writeFile(path.join(pluginDir, 'index.mjs'), PLUGIN_SOURCE)
  await fs.writeFile(path.join(pluginDir, 'panel', 'index.html'), '<!doctype html><title>panel</title>')
  await fs.writeFile(path.join(pluginDir, 'panel', 'app.exe'), 'nope')

  await fs.mkdir(noPermDir, { recursive: true })
  await fs.writeFile(path.join(noPermDir, 'plugin.json'), JSON.stringify(pluginManifest({
    name: 'ui-noperm',
    permissions: [],
  }), null, 2))
  await fs.writeFile(path.join(noPermDir, 'index.mjs'), PLUGIN_SOURCE)

  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = path.join(testRoot, 'data')
  previousTracker = process.env.QF_UI_TEST_TRACKER
  trackerPath = path.join(testRoot, 'ui-calls.log')
  process.env.QF_UI_TEST_TRACKER = trackerPath
  routeMocks.workspaceRoot = workspaceRoot
  vi.resetModules()
})

afterEach(async () => {
  vi.useRealTimers()
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  if (previousTracker === undefined) delete process.env.QF_UI_TEST_TRACKER
  else process.env.QF_UI_TEST_TRACKER = previousTracker
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('GET /api/plugins/ui', () => {
  it('merges static nodes, dynamic getSlots output and panel URLs', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    const response = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    expect(response.status).toBe(200)
    const composerNodes = response.body.slots['composer.actions'].filter((entry) => entry.plugin === 'ui-test')
    expect(composerNodes).toEqual([{
      plugin: 'ui-test',
      nodes: [expect.objectContaining({ type: 'button', label: 'Ping' })],
    }])
    // getSlots overrides the static session.header contribution for a slot the
    // plugin declared (a plugin can never appear in an undeclared slot).
    const headerNodes = response.body.slots['session.header'].filter((entry) => entry.plugin === 'ui-test')
    expect(headerNodes).toEqual([{
      plugin: 'ui-test',
      nodes: [expect.objectContaining({ type: 'badge', label: 'dynamic' })],
    }])

    const entry = response.body.plugins.find((plugin) => plugin.name === 'ui-test')
    expect(entry.panels).toEqual([
      { id: 'main', title: 'Main panel', width: 420, url: '/api/plugins/ui-test/assets/panel/index.html' },
    ])
    expect(entry.permissions).toEqual(['ui:composer', 'ui:session'])
  })

  it('caches getSlots output for cold loads and drops it when the catalog refreshes', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })
    await fs.writeFile(trackerPath, '')

    const readCalls = async () => (await fs.readFile(trackerPath, 'utf8')).split('\n').filter(Boolean)

    await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    const afterFirst = (await readCalls()).length
    expect(afterFirst).toBeGreaterThan(0)

    // Second cold load inside the TTL must be served from the snapshot cache.
    await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    expect(await readCalls()).toHaveLength(afterFirst)

    // Reload builds new plugin instances, so the cache must be dropped.
    await callRoute(routes, { method: 'POST', pathname: '/api/plugins/reload' })
    await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    expect(await readCalls()).toHaveLength(afterFirst * 2)
  })

  it('serves fresh KV state even when the slot snapshot is cached', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'ping' },
    })

    const first = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    const second = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    const stateOf = (response) => response.body.plugins.find((plugin) => plugin.name === 'ui-test').state
    expect(stateOf(first)).toEqual({ pings: 1 })
    expect(stateOf(second)).toEqual({ pings: 1 })
  })

  it('keeps static nodes when getSlots throws', async () => {
    const { registry, routes } = await importModules()
    await fs.writeFile(path.join(pluginDir, 'index.mjs'), [
      'export function createPlugin() {',
      '  return { ui: { getSlots() { throw new Error("nope") } } }',
      '}',
      '',
    ].join('\n'))
    await registry.refreshPlugins({ workspaceRoot })

    const response = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui' })
    expect(response.body.slots['composer.actions'][0].nodes[0]).toMatchObject({ label: 'Ping' })
  })
})

describe('POST /api/plugins/:name/ui', () => {
  it('requires an authenticated app client', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'ping' },
      context: {},
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('runs a declared action, writes state and returns a toast', async () => {
    const { registry, routes, storage } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    const response = await callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'ping' },
    })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ state: { pings: 1 }, toast: { level: 'info', message: 'pong' } })

    const store = await storage.readStore('plugins')
    expect(store.kv['ui-test']).toEqual({ pings: 1 })
  })

  it('rejects undeclared actions', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'not-declared' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects unknown slots and slots the plugin does not contribute', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'nope.nope', action: 'ping' },
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'sidebar.footer', action: 'ping' },
    })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('denies a slot whose permission is not declared', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-noperm/ui',
      body: { slot: 'composer.actions', action: 'ping' },
    })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('validates returned slot nodes and drops oversized payloads', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    const rerendered = await callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'rerender' },
    })
    expect(rerendered.body.slots['composer.actions']).toEqual([{ type: 'badge', label: 'new' }])

    const oversized = await callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'oversize' },
    })
    // The invalid replacement is dropped, the action still succeeds.
    expect(oversized.body).toEqual({})
  })

  it('surfaces plugin errors as 500 and records an audit entry', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'boom' },
    })).rejects.toMatchObject({ statusCode: 500 })

    const response = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/audit?plugin=ui-test' })
    expect(response.body.entries[0]).toMatchObject({ plugin: 'ui-test', action: 'boom', outcome: 'error' })
  })

  it('times out a hung action with 504', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'POST',
      pathname: '/api/plugins/ui-test/ui',
      body: { slot: 'composer.actions', action: 'slow' },
    })).rejects.toMatchObject({ statusCode: 504 })
  }, 20000)
})

describe('GET /api/plugins/:name/assets/*', () => {
  it('serves a declared panel asset', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    const response = await callRoute(routes, { method: 'GET', pathname: '/api/plugins/ui-test/assets/panel/index.html' })
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(String(response.raw)).toContain('<title>panel</title>')
  })

  it('refuses traversal and non-whitelisted extensions', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-test/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd.html',
    })).rejects.toMatchObject({ statusCode: 400 })

    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-test/assets/panel/app.exe',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('never lists directories or serves the plugin manifest', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    // No extension -> not a whitelisted static type -> treated as missing.
    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-test/assets/panel',
    })).rejects.toMatchObject({ statusCode: 404 })

    // Trailing slash resolves to the plugin dir itself: refused, not listed.
    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-test/assets/',
    })).rejects.toMatchObject({ statusCode: 400 })

    // A whitelisted extension that simply is not on disk is still a 404.
    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-test/assets/panel/missing.html',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('serves nothing for a plugin without panels', async () => {
    const { registry, routes } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await expect(callRoute(routes, {
      method: 'GET',
      pathname: '/api/plugins/ui-noperm/assets/panel/index.html',
    })).rejects.toMatchObject({ statusCode: 404 })
  })
})
