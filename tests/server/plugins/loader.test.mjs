import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadPlugin } from '../../../server/plugins/loader.mjs'

let testRoot
const pluginDirs = []

function manifestFor(dir, { main = 'index.mjs' } = {}) {
  return {
    name: 'demo-plugin',
    displayName: 'Demo Plugin',
    version: '1.2.3',
    dir,
    main,
  }
}

async function makePluginDir(name, source) {
  const dir = path.join(testRoot, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'index.mjs'), source)
  pluginDirs.push(dir)
  return dir
}

beforeAll(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-plugin-loader-'))
})

afterAll(async () => {
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe('loadPlugin factory resolution', () => {
  it('loads a createPlugin factory and injects the plugin manifest context', async () => {
    const dir = await makePluginDir('context-plugin', [
      'let seen = null',
      'export function createPlugin(context) {',
      '  seen = context',
      '  return {',
      '    tools: {',
      '      "plugin-info"() {',
      '        return JSON.stringify({',
      '          name: seen.plugin.name,',
      '          displayName: seen.plugin.displayName,',
      '          version: seen.plugin.version,',
      '          dir: seen.plugin.dir,',
      '          marker: seen.marker,',
      '        })',
      '      },',
      '    },',
      '  }',
      '}',
      '',
    ].join('\n'))
    const marker = { label: 'context-marker' }

    const plugin = await loadPlugin(manifestFor(dir), { marker })
    const result = await plugin.callTool('plugin-info')
    const info = JSON.parse(result.content)

    expect(info).toEqual({
      name: 'demo-plugin',
      displayName: 'Demo Plugin',
      version: '1.2.3',
      dir,
      marker,
    })
  })

  it('falls back to the default export factory', async () => {
    const dir = await makePluginDir('default-factory', [
      'export default function createDefaultPlugin() {',
      '  return { tools: { ping() { return "pong" } } }',
      '}',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await expect(plugin.callTool('ping')).resolves.toMatchObject({ content: 'pong' })
  })

  it('rejects modules without a factory function', async () => {
    const dir = await makePluginDir('no-factory', [
      'export const nothing = true',
      '',
    ].join('\n'))

    await expect(loadPlugin(manifestFor(dir)))
      .rejects.toThrow('Plugin demo-plugin must export createPlugin(context) or a default factory function.')
  })

  it('rejects factories that do not return an object', async () => {
    const dir = await makePluginDir('non-object-factory', [
      'export function createPlugin() { return "not-an-object" }',
      '',
    ].join('\n'))

    await expect(loadPlugin(manifestFor(dir)))
      .rejects.toThrow('Plugin demo-plugin factory must return an object.')
  })
})

describe('loadPlugin callTool normalization', () => {
  it('rejects tool calls without a matching handler', async () => {
    const dir = await makePluginDir('missing-handler', [
      'export function createPlugin() { return { tools: {} } }',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await expect(plugin.callTool('boom')).rejects.toThrow('Plugin demo-plugin did not provide handler for tool boom.')
  })

  it('normalizes the four supported tool result shapes', async () => {
    const dir = await makePluginDir('result-shapes', [
      'export function createPlugin() {',
      '  return {',
      '    tools: {',
      '      text() { return "plain string" },',
      '      parts() { return { content: [{ type: "text", text: "line-a" }, "line-b", { type: "image", data: "zz" }] } },',
      '      "content-string"() { return { content: "wrapped" } },',
      '      "content-null"() { return { content: null } },',
      '      object() { return { foo: "bar", n: 1 } },',
      '    },',
      '  }',
      '}',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await expect(plugin.callTool('text')).resolves.toMatchObject({ content: 'plain string' })
    await expect(plugin.callTool('parts')).resolves.toMatchObject({
      content: 'line-a\nline-b\n{"type":"image","data":"zz"}',
    })
    await expect(plugin.callTool('content-string')).resolves.toMatchObject({ content: 'wrapped' })
    await expect(plugin.callTool('content-null')).resolves.toMatchObject({ content: '' })
    await expect(plugin.callTool('object')).resolves.toMatchObject({
      content: JSON.stringify({ foo: 'bar', n: 1 }, null, 2),
    })
  })

  it('passes through plain-object details and booleanizes isError', async () => {
    const dir = await makePluginDir('details-plugin', [
      'export function createPlugin() {',
      '  return {',
      '    tools: {',
      '      details() { return { content: "with details", details: { depth: 2 }, isError: 1 } },',
      '      "bad-details"() { return { content: "x", details: "not-an-object" } },',
      '      "no-error"() { return { content: "y" } },',
      '      "falsey-error"() { return { content: "z", isError: 0 } },',
      '    },',
      '  }',
      '}',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await expect(plugin.callTool('details')).resolves.toMatchObject({
      details: { depth: 2 },
      isError: true,
    })
    await expect(plugin.callTool('bad-details')).resolves.toMatchObject({
      details: undefined,
      isError: false,
    })
    await expect(plugin.callTool('no-error')).resolves.toMatchObject({ isError: false })
    await expect(plugin.callTool('falsey-error')).resolves.toMatchObject({ isError: false })
  })
})

describe('loadPlugin lifecycle', () => {
  it('forwards dispose to plugins that provide one', async () => {
    const trackerPath = path.join(testRoot, 'dispose-tracker.log')
    const dir = await makePluginDir('disposable', [
      "import { appendFileSync } from 'node:fs'",
      `const trackerPath = ${JSON.stringify(trackerPath)}`,
      'export function createPlugin() {',
      '  return {',
      '    tools: { ping() { return "ok" } },',
      "    async dispose() { appendFileSync(trackerPath, 'disposed\\n') },",
      '  }',
      '}',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await plugin.dispose()
    await expect(fs.readFile(trackerPath, 'utf8')).resolves.toBe('disposed\n')
  })

  it('allows dispose on plugins without a dispose hook', async () => {
    const dir = await makePluginDir('non-disposable', [
      'export function createPlugin() { return { tools: { ping() { return "ok" } } } }',
      '',
    ].join('\n'))

    const plugin = await loadPlugin(manifestFor(dir))
    await expect(plugin.dispose()).resolves.toBeUndefined()
  })

  it('re-imports the module when the plugin source changes', async () => {
    const versionPlugin = (version) => [
      'export function createPlugin() {',
      `  return { tools: { version() { return ${JSON.stringify(version)} } } }`,
      '}',
      '',
    ].join('\n')
    const dir = path.join(testRoot, 'reloadable')
    await fs.mkdir(dir, { recursive: true })
    pluginDirs.push(dir)

    await fs.writeFile(path.join(dir, 'index.mjs'), versionPlugin('v1'))
    const first = await loadPlugin(manifestFor(dir))
    await expect(first.callTool('version')).resolves.toMatchObject({ content: 'v1' })

    await fs.writeFile(path.join(dir, 'index.mjs'), versionPlugin('v2'))
    const second = await loadPlugin(manifestFor(dir))
    await expect(second.callTool('version')).resolves.toMatchObject({ content: 'v2' })
    await expect(first.callTool('version')).resolves.toMatchObject({ content: 'v1' })

    expect(second).not.toBe(first)
  })
})
