import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const routeMocks = vi.hoisted(() => ({
  workspaceRoot: '',
  refreshAllSessionTools: vi.fn(async () => 0),
}))

vi.mock('../../server/agent-manager.mjs', () => ({
  refreshAllSessionTools: routeMocks.refreshAllSessionTools,
}))

vi.mock('../../server/project-config.mjs', () => ({
  readProjectConfig: vi.fn(async () => ({
    activeProjectId: 'plugin-test-project',
    projects: [{ id: 'plugin-test-project' }],
  })),
  projectContextFromId: vi.fn(() => ({
    id: 'plugin-test-project',
    workspaceRoot: routeMocks.workspaceRoot,
  })),
}))

const tempDirs = []
let previousDataDir
let testRoot
let workspaceRoot
let pluginDir
let trackerPath
let sourceRevision

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

async function readTracker() {
  try {
    const content = await fs.readFile(trackerPath, 'utf8')
    return content.trim().split('\n').filter(Boolean)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function writePlugin(version, { dispose = false } = {}) {
  const trackerLiteral = JSON.stringify(trackerPath)
  const source = [
    "import { appendFileSync } from 'node:fs'",
    `const trackerPath = ${trackerLiteral}`,
    `appendFileSync(trackerPath, 'module:${version}\\n')`,
    'export async function createPlugin() {',
    `  appendFileSync(trackerPath, 'create:${version}\\n')`,
    '  return {',
    '    tools: {',
    `      version() { return ${JSON.stringify(version)} },`,
    '    },',
    dispose
      ? `    async dispose() { appendFileSync(trackerPath, 'dispose:${version}\\n') },`
      : '',
    '  }',
    '}',
    '',
  ].filter(Boolean).join('\n')

  const entryPath = path.join(pluginDir, 'index.mjs')
  await fs.writeFile(entryPath, source)
  sourceRevision += 1
  const modifiedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, sourceRevision))
  await fs.utimes(entryPath, modifiedAt, modifiedAt)
}

async function importModules() {
  const registry = await import('../../server/plugins/registry.mjs')
  const routes = await import('../../server/routes/plugins.mjs')
  return { registry, routes }
}

async function requestPlugins(routes, method, pathname) {
  const response = mockResponse()
  await routes.handlePluginsApi(
    { method },
    response,
    new URL(`http://localhost${pathname}`),
  )
  return response
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-plugin-lifecycle-'))
  tempDirs.push(testRoot)
  workspaceRoot = path.join(testRoot, 'workspace')
  pluginDir = path.join(workspaceRoot, '.quickforge', 'plugins', 'lifecycle-test')
  trackerPath = path.join(testRoot, 'tracker.log')
  sourceRevision = 0
  await fs.mkdir(pluginDir, { recursive: true })
  await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({
    name: 'lifecycle-test',
    displayName: 'Lifecycle Test',
    version: '1.0.0',
    apiVersion: 1,
    enabledByDefault: true,
    main: 'index.mjs',
    contributes: {
      tools: [{
        name: 'version',
        description: 'Returns the fixture version',
        parameters: { type: 'object', properties: {} },
      }],
    },
  }, null, 2))

  previousDataDir = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = path.join(testRoot, 'data')
  routeMocks.workspaceRoot = workspaceRoot
  routeMocks.refreshAllSessionTools.mockClear()
  vi.resetModules()
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.QUICKFORGE_DATA_DIR
  else process.env.QUICKFORGE_DATA_DIR = previousDataDir
  vi.resetModules()
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('plugin lifecycle', () => {
  it('does not recreate plugin instances for repeated status GET requests', async () => {
    await writePlugin('v1')
    const { routes } = await importModules()

    expect((await requestPlugins(routes, 'GET', '/api/plugins')).status).toBe(200)
    expect((await requestPlugins(routes, 'GET', '/api/plugins')).status).toBe(200)

    expect(await readTracker()).toEqual([
      'module:v1',
      'create:v1',
    ])
  })

  it('loads changed plugin code once for a single explicit reload', async () => {
    await writePlugin('v1')
    const { registry, routes } = await importModules()
    await requestPlugins(routes, 'GET', '/api/plugins')

    await writePlugin('v2')
    const response = await requestPlugins(routes, 'POST', '/api/plugins/reload')
    const result = await registry.callPluginTool('plugin__lifecycle-test__version', {}, { workspaceRoot })

    expect(response.status).toBe(200)
    expect(routeMocks.refreshAllSessionTools).toHaveBeenCalledOnce()
    expect(result.content).toBe('v2')
    expect((await readTracker()).filter((line) => line.startsWith('create:'))).toEqual([
      'create:v1',
      'create:v2',
    ])
  })

  it('reuses the same ESM module when explicit reload finds an unchanged entry file', async () => {
    await writePlugin('v1')
    const { routes } = await importModules()
    await requestPlugins(routes, 'GET', '/api/plugins')

    await requestPlugins(routes, 'POST', '/api/plugins/reload')
    await requestPlugins(routes, 'POST', '/api/plugins/reload')

    const events = await readTracker()
    expect(events.filter((line) => line === 'module:v1')).toHaveLength(1)
    expect(events.filter((line) => line === 'create:v1')).toHaveLength(3)
  })

  it('keeps the previous instance when changed plugin code fails to load', async () => {
    await writePlugin('v1', { dispose: true })
    const { registry } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    const entryPath = path.join(pluginDir, 'index.mjs')
    await fs.writeFile(entryPath, 'export const broken = ;\n')
    await expect(registry.refreshPlugins({ workspaceRoot })).resolves.toBeTruthy()

    await expect(registry.callPluginTool('plugin__lifecycle-test__version', {}, { workspaceRoot }))
      .resolves.toMatchObject({ content: 'v1' })
    expect((await readTracker()).filter((line) => line === 'dispose:v1')).toHaveLength(0)
  })

  it('disposes the previous instance after configuration invalidates the cache', async () => {
    await writePlugin('v1', { dispose: true })
    const { registry } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await registry.setPluginConfig('lifecycle-test', { mode: 'changed' })
    await registry.refreshPlugins({ workspaceRoot })

    expect((await readTracker()).filter((line) => line === 'dispose:v1')).toHaveLength(1)
  })

  it('disposes replaced instances and remains compatible with plugins without dispose', async () => {
    await writePlugin('v1', { dispose: true })
    const { registry } = await importModules()
    await registry.refreshPlugins({ workspaceRoot })

    await writePlugin('v2')
    await expect(registry.refreshPlugins({ workspaceRoot })).resolves.toBeTruthy()
    await expect(registry.refreshPlugins({ workspaceRoot })).resolves.toBeTruthy()

    const events = await readTracker()
    expect(events.filter((line) => line === 'dispose:v1')).toHaveLength(1)
    await expect(registry.callPluginTool('plugin__lifecycle-test__version', {}, { workspaceRoot }))
      .resolves.toMatchObject({ content: 'v2' })
  })
})
