import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isPluginToolName,
  normalizePluginManifest,
  parseQuickForgePluginToolName,
  quickForgePluginToolName,
} from '../../../server/plugins/manifest.mjs'

const pluginDir = path.resolve(os.tmpdir(), 'qf-manifest-demo')

function rawManifest(overrides = {}, contributes = {}) {
  return { name: 'demo', contributes, ...overrides }
}

describe('normalizePluginManifest input validation', () => {
  it('rejects manifests that are not plain objects', () => {
    for (const raw of [null, undefined, 'demo', 42, [], () => {}]) {
      expect(() => normalizePluginManifest(raw, pluginDir)).toThrow('plugin.json must contain an object.')
    }
  })

  it('rejects invalid plugin names', () => {
    for (const name of ['', 'Demo', '-demo', '_demo', 'has space', 'a'.repeat(65)]) {
      expect(() => normalizePluginManifest(rawManifest({ name }), pluginDir)).toThrow(/Invalid plugin name/)
    }
  })

  it('rejects unsupported apiVersion values', () => {
    for (const apiVersion of [2, '2', 1.5, 'x']) {
      expect(() => normalizePluginManifest(rawManifest({ apiVersion }), pluginDir))
        .toThrow('Unsupported plugin apiVersion')
    }
  })

  it('falls back to the current API version for falsy apiVersion values', () => {
    for (const apiVersion of [undefined, null, 0, '']) {
      expect(normalizePluginManifest(rawManifest({ apiVersion }), pluginDir).apiVersion).toBe(1)
    }
  })

  it('coerces numeric-string apiVersion and defaults to the current API version', () => {
    expect(normalizePluginManifest(rawManifest({ apiVersion: '1' }), pluginDir).apiVersion).toBe(1)
    expect(normalizePluginManifest(rawManifest({}), pluginDir).apiVersion).toBe(1)
  })
})

describe('normalizePluginManifest defaults', () => {
  it('applies manifest defaults and exposes resolved paths', () => {
    const manifest = normalizePluginManifest(rawManifest(), pluginDir)
    expect(manifest).toMatchObject({
      name: 'demo',
      displayName: 'demo',
      version: '0.0.0',
      description: '',
      apiVersion: 1,
      quickforgeVersion: '',
      enabledByDefault: false,
      main: 'index.mjs',
      permissions: [],
      contributes: { tools: [], skills: [], commands: [], settings: null },
      dir: pluginDir,
    })
    expect(manifest.manifestPath).toBe(path.join(pluginDir, 'plugin.json'))
  })

  it('falls back to title for displayName and only treats strict true as enabledByDefault', () => {
    const manifest = normalizePluginManifest(rawManifest({ title: 'Demo Title', enabledByDefault: 'true' }), pluginDir)
    expect(manifest.displayName).toBe('Demo Title')
    expect(manifest.enabledByDefault).toBe(false)
    expect(normalizePluginManifest(rawManifest({ enabledByDefault: true }), pluginDir).enabledByDefault).toBe(true)
  })
})

describe('normalizePluginManifest tools', () => {
  it('falls back to the tool name for label and description', () => {
    const manifest = normalizePluginManifest(rawManifest({}, {
      tools: [{ name: 'RunTask' }],
    }), pluginDir)
    expect(manifest.contributes.tools).toEqual([{
      name: 'RunTask',
      label: 'RunTask',
      description: 'RunTask',
      parameters: { type: 'object', properties: {} },
      executionMode: undefined,
    }])
  })

  it('keeps provided tool fields, prefers inputSchema as a parameters fallback, and maps empty executionMode to undefined', () => {
    const manifest = normalizePluginManifest(rawManifest({}, {
      tools: [{
        name: 'run',
        label: 'Run',
        title: 'Ignored Title',
        description: 'Runs the task',
        inputSchema: { type: 'object', properties: { a: { type: 'string' } } },
        executionMode: '  ',
      }],
    }), pluginDir)
    expect(manifest.contributes.tools[0]).toMatchObject({
      name: 'run',
      label: 'Run',
      description: 'Runs the task',
      parameters: { type: 'object', properties: { a: { type: 'string' } } },
      executionMode: undefined,
    })
    expect(normalizePluginManifest(rawManifest({}, {
      tools: [{ name: 'stream', executionMode: 'streaming' }],
    }), pluginDir).contributes.tools[0].executionMode).toBe('streaming')
  })

  it('rejects tool entries with invalid names', () => {
    for (const name of ['', 'has space', '1'.repeat(65)]) {
      expect(() => normalizePluginManifest(rawManifest({}, { tools: [{ name }] }), pluginDir))
        .toThrow(/invalid tool name/)
    }
    expect(() => normalizePluginManifest(rawManifest({}, { tools: ['run'] }), pluginDir))
      .toThrow('Plugin demo tool entry must be an object.')
    expect(() => normalizePluginManifest(rawManifest({}, { tools: [{ name: '' }] }), pluginDir))
      .toThrow('Plugin demo has invalid tool name: (empty).')
  })
})

describe('normalizePluginManifest permissions', () => {
  it('cleans, trims, and deduplicates array permissions', () => {
    const manifest = normalizePluginManifest(rawManifest({
      permissions: ['fs:read', ' fs:read ', '', '  ', 42, 'net:write', 'net:write'],
    }), pluginDir)
    expect(manifest.permissions).toEqual(['fs:read', 'net:write'])
  })

  it('normalizes object permissions across value, array, and plain-object forms', () => {
    const manifest = normalizePluginManifest(rawManifest({
      permissions: {
        fs: ['read', 'read', 'write'],
        net: 'connect',
        env: { mode: 'strict' },
        retries: 3,
        '': 'ignored',
      },
    }), pluginDir)
    expect(manifest.permissions).toEqual([
      'fs:read',
      'fs:write',
      'net:connect',
      'env:{"mode":"strict"}',
      'retries:3',
    ])
  })

  it('returns no permissions for unsupported permission shapes', () => {
    expect(normalizePluginManifest(rawManifest({ permissions: 'fs:read' }), pluginDir).permissions).toEqual([])
  })
})

describe('normalizePluginManifest path contributions', () => {
  it('rejects null bytes, absolute paths, and escaping segments', () => {
    for (const contribution of [
      'bad\0path.md',
      '/etc/passwd',
      '../escape.md',
      '..\\escape.md',
      ['nested/../../escape.md'],
    ]) {
      expect(() => normalizePluginManifest(rawManifest({}, { skills: contribution }), pluginDir)).toThrow(/contribution path/)
    }
  })

  it('strips a leading ./ prefix and resolves contributions inside the plugin directory', () => {
    const manifest = normalizePluginManifest(rawManifest({}, {
      skills: './skills/getting-started.md',
      commands: ['build.mjs'],
    }), pluginDir)
    expect(manifest.contributes.skills).toEqual([{
      path: 'skills/getting-started.md',
      resolvedPath: path.resolve(pluginDir, 'skills/getting-started.md'),
    }])
    expect(manifest.contributes.commands).toEqual([{
      path: 'build.mjs',
      resolvedPath: path.resolve(pluginDir, 'build.mjs'),
    }])
  })

  it('deduplicates contributions case-insensitively and keeps the first entry', () => {
    const manifest = normalizePluginManifest(rawManifest({}, {
      skills: ['Skills/a.md', 'skills/A.md', 'skills/b.md'],
    }), pluginDir)
    expect(manifest.contributes.skills.map((entry) => entry.path)).toEqual(['Skills/a.md', 'skills/b.md'])
  })

  it('accepts string, array, and object entries using path, dir, or file keys', () => {
    const fromString = normalizePluginManifest(rawManifest({}, { skills: 'one.md' }), pluginDir)
    expect(fromString.contributes.skills.map((entry) => entry.path)).toEqual(['one.md'])

    const fromObject = normalizePluginManifest(rawManifest({}, {
      commands: [{ path: 'two.mjs' }, { dir: 'three' }, { file: 'four.mjs' }],
    }), pluginDir)
    expect(fromObject.contributes.commands.map((entry) => entry.path)).toEqual(['two.mjs', 'three', 'four.mjs'])

    expect(normalizePluginManifest(rawManifest(), pluginDir).contributes.skills).toEqual([])
  })

  it('keeps contributes.settings only for plain objects', () => {
    expect(normalizePluginManifest(rawManifest({}, { settings: { a: 1 } }), pluginDir).contributes.settings).toEqual({ a: 1 })
    expect(normalizePluginManifest(rawManifest({}, { settings: 'nope' }), pluginDir).contributes.settings).toBeNull()
    expect(normalizePluginManifest(rawManifest({}, { settings: [['a']] }), pluginDir).contributes.settings).toBeNull()
  })
})

describe('quickforge plugin tool name codec', () => {
  it('replaces unsupported tool name characters and round-trips through the parser', () => {
    const encoded = quickForgePluginToolName('demo-plugin', 'hello world!')
    expect(encoded).toBe('plugin__demo-plugin__hello_world_')
    expect(parseQuickForgePluginToolName(encoded)).toEqual({ pluginName: 'demo-plugin', toolName: 'hello_world_' })
    expect(parseQuickForgePluginToolName(quickForgePluginToolName('a', 'b'))).toEqual({ pluginName: 'a', toolName: 'b' })
  })

  it('rejects values that cannot be parsed back into plugin tool names', () => {
    for (const value of ['', null, undefined, 'tool', 'plugin__onlyname', 'plugin____leading', 'plugin__ab__']) {
      expect(parseQuickForgePluginToolName(value)).toBeNull()
    }
  })

  it('detects plugin tool names', () => {
    expect(isPluginToolName('plugin__demo__run')).toBe(true)
    expect(isPluginToolName('read_file')).toBe(false)
  })
})
