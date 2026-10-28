import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizePluginManifest } from '../../../server/plugins/manifest.mjs'
import { UI_SLOTS, uiPermissionForSlot } from '../../../server/plugins/ui-schema.mjs'

// Guards the bundled reference plugin against schema drift: this is the plugin
// `plugin-creator` points people at, so a manifest change that breaks it must
// fail here rather than in the docs.
const exampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugins/hello-ui')

async function loadExample() {
  const raw = JSON.parse(await fs.readFile(path.join(exampleDir, 'plugin.json'), 'utf8'))
  return { raw, manifest: normalizePluginManifest(raw, exampleDir) }
}

describe('bundled example plugin (plugins/hello-ui)', () => {
  it('normalises as an apiVersion 2 plugin with a declarative slot', async () => {
    const { manifest } = await loadExample()

    expect(manifest.apiVersion).toBe(2)
    expect(manifest.enabledByDefault).toBe(false)
    expect(Object.keys(manifest.contributes.ui.slots)).toEqual(['composer.actions'])
    expect(manifest.contributes.ui.actions).toEqual(['greet'])
    expect(manifest.uiDigest).toMatch(/^[a-f0-9]{64}$/)

    const nodes = manifest.contributes.ui.slots['composer.actions']
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ type: 'button', label: 'Hello' })
    expect(nodes[0].onClick.action).toBe('greet')
  })

  it('declares every permission its slots need', async () => {
    const { manifest } = await loadExample()
    for (const slotName of Object.keys(manifest.contributes.ui.slots)) {
      expect(UI_SLOTS[slotName]).toBeDefined()
      expect(manifest.permissions).toContain(uiPermissionForSlot(slotName))
    }
  })

  it('ships a main entry and a serveable panel document', async () => {
    const { manifest } = await loadExample()

    await expect(fs.access(path.join(exampleDir, manifest.main))).resolves.toBeUndefined()

    const panels = manifest.contributes.ui.panels
    expect(panels).toHaveLength(1)
    const [panel] = panels
    expect(panel.id).toBe('hello')
    expect(path.extname(panel.entry)).toBe('.html')

    // `entry` is normalised relative to the plugin dir and re-resolved there, so
    // this also proves the file the assets route would serve actually exists.
    const panelFile = path.join(exampleDir, panel.entry)
    expect(panel.resolvedPath).toBe(panelFile)
    await expect(fs.access(panelFile)).resolves.toBeUndefined()
  })

  it('keeps the panel self-contained (no host API calls that the sandbox blocks)', async () => {
    const { manifest } = await loadExample()
    const html = await fs.readFile(path.join(exampleDir, manifest.contributes.ui.panels[0].entry), 'utf8')

    // The frame is opaque-origin: same-origin fetches are blocked by CORS and
    // localStorage is not the host's. Both would be silent no-ops in production.
    expect(html).not.toMatch(/fetch\(['"]\/api/)
    expect(html).not.toContain('localStorage')
    expect(html).toContain("postMessage({ type: 'qf:call'")
  })
})
