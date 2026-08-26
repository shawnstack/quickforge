import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const vendorDir = path.join(root, 'vendor', 'node-pty')

function listVendorFiles() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else files.push(path.relative(vendorDir, full).replaceAll(path.sep, '/'))
    }
  }
  for (const name of ['lib', 'prebuilds']) walk(path.join(vendorDir, name))
  return files
}

describe('vendored node-pty runtime layout', () => {
  it('ships lib entry, commonjs marker, manifest and all platform prebuilds', () => {
    expect(fs.existsSync(path.join(vendorDir, 'lib', 'index.js'))).toBe(true)
    expect(fs.existsSync(path.join(vendorDir, 'lib', 'shared', 'conout.js'))).toBe(true)
    expect(fs.existsSync(path.join(vendorDir, 'lib', 'worker', 'conoutSocketWorker.js'))).toBe(true)

    expect(JSON.parse(fs.readFileSync(path.join(vendorDir, 'package.json'), 'utf8')).type).toBe('commonjs')

    const manifest = JSON.parse(fs.readFileSync(path.join(vendorDir, 'VENDOR.json'), 'utf8'))
    expect(manifest.source).toBe('node-pty')
    expect(manifest.platforms).toEqual(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'])
    for (const platform of manifest.platforms) {
      const dir = path.join(vendorDir, 'prebuilds', platform)
      expect(fs.existsSync(path.join(dir, 'pty.node'))).toBe(true)
      // macOS posix_spawns this helper binary directly
      if (platform.startsWith('darwin-')) {
        expect(fs.existsSync(path.join(dir, 'spawn-helper'))).toBe(true)
      }
    }
  })

  it('keeps license texts for upstream and bundled third-party binaries', () => {
    expect(fs.existsSync(path.join(vendorDir, 'LICENSE'))).toBe(true)
    for (const name of ['README.md', 'winpty-LICENSE.txt', 'conpty-LICENSE.txt']) {
      expect(fs.existsSync(path.join(vendorDir, 'licenses', name))).toBe(true)
    }
  })

  it('excludes debug symbols, tests and sourcemaps', () => {
    const files = listVendorFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files.some((f) => f.endsWith('.pdb'))).toBe(false)
    expect(files.some((f) => f.endsWith('.test.js') || f.endsWith('.map'))).toBe(false)
  })
})

const hasVendoredPrebuild = ['win32', 'darwin'].includes(process.platform)
  && fs.existsSync(path.join(vendorDir, 'prebuilds', `${process.platform}-${process.arch}`))

describe.skipIf(!hasVendoredPrebuild)('terminal-manager vendored pty loading', () => {
  it('resolves the vendor entry path inside the package', async () => {
    const { vendoredPtyEntryPath } = await import('../../server/terminal/terminal-manager.mjs')
    const entry = vendoredPtyEntryPath()
    expect(entry).toBe(path.join(vendorDir, 'lib', 'index.js'))
  })

  it('enables the terminal via the vendored runtime, not a node_modules copy', async () => {
    const { terminalCapabilities, vendoredPtyEntryPath } = await import('../../server/terminal/terminal-manager.mjs')
    const capabilities = await terminalCapabilities()
    expect(capabilities.enabled).toBe(true)
    expect(require.cache[vendoredPtyEntryPath()]).toBeTruthy()
  })
})
