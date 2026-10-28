#!/usr/bin/env node
// Validates a plugin directory with the *real* server normaliser.
//
//   node skills/plugin-creator/scripts/validate-plugin.mjs <pluginDir>
//
// Exit code 0 = loadable, 1 = the server would reject this manifest (or the
// plugin directory is missing required pieces). No dependencies, no network.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { normalizePluginManifest } from '../../../server/plugins/manifest.mjs'
import { UI_LIMITS, UI_SLOT_NAMES, uiPermissionForSlot } from '../../../server/plugins/ui-schema.mjs'

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

async function readManifest(dir) {
  const manifestPath = path.join(dir, 'plugin.json')
  let text
  try {
    text = await fs.readFile(manifestPath, 'utf8')
  } catch {
    fail(`plugin.json not found in ${dir}`)
  }
  try {
    return JSON.parse(text.trimStart())
  } catch (error) {
    fail(`plugin.json is not valid JSON: ${error.message}`)
  }
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

function line(label, value) {
  console.log(`  ${label.padEnd(16)} ${value}`)
}

async function main() {
  const target = process.argv[2]
  if (!target) fail('usage: validate-plugin.mjs <pluginDir>')

  const dir = path.resolve(process.cwd(), target)
  const raw = await readManifest(dir)

  let manifest
  try {
    manifest = normalizePluginManifest(raw, dir)
  } catch (error) {
    fail(error.message)
  }

  console.log(`✓ ${manifest.name} (${manifest.displayName}) v${manifest.version}`)
  line('apiVersion', manifest.apiVersion)
  line('main', manifest.main)

  if (!(await exists(path.join(dir, manifest.main))) && manifest.contributes.tools.length > 0) {
    fail(`main entry "${manifest.main}" does not exist but the plugin declares tools`)
  }

  line('permissions', manifest.permissions.length > 0 ? manifest.permissions.join(', ') : '(none)')

  if (manifest.contributes.tools.length > 0) {
    console.log('  tools')
    for (const tool of manifest.contributes.tools) {
      console.log(`    - plugin__${manifest.name}__${tool.name}  ${tool.description || ''}`.trimEnd())
    }
  }

  if (manifest.contributes.skills.length > 0) {
    console.log('  skills')
    for (const skill of manifest.contributes.skills) {
      const hasEntry = await exists(path.join(skill.resolvedPath, 'SKILL.md'))
      console.log(`    - ${skill.path}${hasEntry ? '' : '  ⚠ missing SKILL.md'}`)
    }
  }

  if (manifest.contributes.commands.length > 0) {
    console.log('  commands')
    for (const command of manifest.contributes.commands) {
      console.log(`    - ${command.path}`)
    }
  }

  const ui = manifest.contributes.ui
  if (!ui) {
    console.log('  ui               (none — apiVersion 1 or no contributes.ui)')
    if (manifest.apiVersion < 2) {
      console.log(`\nnote: apiVersion ${manifest.apiVersion} ignores contributes.ui. Set "apiVersion": 2 to enable it.`)
    }
  } else {
    const slots = Object.keys(ui.slots)
    line('ui slots', slots.length > 0 ? slots.join(', ') : '(none)')
    line('ui actions', ui.actions.length > 0 ? ui.actions.join(', ') : '(none)')
    line('ui panels', ui.panels.length > 0 ? ui.panels.map((panel) => `${panel.id} → ${panel.entry} (${panel.width}px)`).join(', ') : '(none)')
    line('ui digest', ui ? manifest.uiDigest : '(none)')

    for (const slotName of slots) {
      const permission = uiPermissionForSlot(slotName)
      if (permission && !manifest.permissions.includes(permission)) {
        console.log(`  ⚠ slot ${slotName} needs permission "${permission}" — clicks will be rejected with 403`)
      }
    }

    const declaredSlots = new Set(UI_SLOT_NAMES)
    for (const slotName of slots) {
      if (!declaredSlots.has(slotName)) fail(`unknown slot ${slotName}`)
    }

    // Action coverage: every action referenced by a node should be declared.
    const referenced = new Set()
    const visit = (nodes) => {
      for (const node of nodes || []) {
        if (node?.onClick?.action) referenced.add(node.onClick.action)
        if (node?.onChange?.action) referenced.add(node.onChange.action)
        visit(node?.children)
      }
    }
    for (const nodes of Object.values(ui.slots)) visit(nodes)
    for (const action of referenced) {
      if (!ui.actions.includes(action)) {
        console.log(`  ⚠ node references action "${action}" which is not in contributes.ui.actions — clicks will be rejected with 400`)
      }
    }

    if (ui.warnings.length > 0) {
      console.log('  warnings')
      for (const warning of ui.warnings) console.log(`    - ${warning}`)
    }

    console.log(`\nlimits: ${UI_LIMITS.maxTopLevelNodes} top-level nodes and ${UI_LIMITS.maxTotalNodes} total nodes per slot, depth ${UI_LIMITS.maxDepth}, ${UI_LIMITS.maxSlotsPerPlugin} slots, ${Math.round(UI_LIMITS.maxSerializedBytes / 1024)} KB per slot — see references/ui-slots.md`)
  }

  console.log('\n✓ manifest is loadable by this QuickForge build')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
