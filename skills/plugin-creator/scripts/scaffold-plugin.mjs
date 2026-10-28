#!/usr/bin/env node
// Scaffolds a QuickForge plugin directory.
//
//   node skills/plugin-creator/scripts/scaffold-plugin.mjs <targetDir> \
//     --name my-plugin --template ui|tool|panel
//
// Writes plugin.json, index.mjs and (for the panel template) panel/index.html.
// Refuses to overwrite an existing directory so it is safe to re-run.

import { promises as fs } from 'node:fs'
import path from 'node:path'

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

function usage(message) {
  if (message) console.error(`error: ${message}`)
  console.error('usage: scaffold-plugin.mjs <targetDir> --name <name> [--template ui|tool|panel] [--force]')
  process.exit(message ? 1 : 0)
}

function parseArgs(argv) {
  const args = { targetDir: '', name: '', template: 'ui', force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--name') {
      args.name = argv[++index] || ''
    } else if (current === '--template') {
      args.template = argv[++index] || ''
    } else if (current === '--force') {
      args.force = true
    } else if (current === '--help' || current === '-h') {
      usage()
    } else if (!current.startsWith('-') && !args.targetDir) {
      args.targetDir = current
    } else {
      usage(`unknown argument: ${current}`)
    }
  }
  return args
}

function titleize(name) {
  return name.split(/[-_]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function pluginJson({ name, template }) {
  const base = {
    name,
    displayName: titleize(name),
    version: '0.1.0',
    description: `${titleize(name)} plugin for QuickForge.`,
    apiVersion: 2,
    quickforgeVersion: '>=2.3.4',
    enabledByDefault: false,
    main: 'index.mjs',
  }

  if (template === 'tool') {
    return {
      ...base,
      permissions: [],
      contributes: {
        tools: [{
          name: `${name.replace(/-/g, '_')}_run`,
          label: titleize(name),
          description: `Runs the ${name} plugin action.`,
          parameters: { type: 'object', properties: { input: { type: 'string' } } },
        }],
      },
    }
  }

  if (template === 'panel') {
    return {
      ...base,
      permissions: [],
      contributes: {
        ui: {
          slots: {},
          actions: [],
          panels: [{ id: 'main', title: titleize(name), entry: 'panel/index.html', width: 420 }],
        },
      },
    }
  }

  return {
    ...base,
    permissions: ['ui:composer'],
    contributes: {
      ui: {
        slots: {
          'composer.actions': [{
            type: 'button',
            label: titleize(name),
            icon: 'puzzle',
            variant: 'ghost',
            onClick: { action: 'run' },
          }],
        },
        actions: ['run'],
      },
    },
  }
}

function indexModule({ name, template }) {
  if (template === 'tool') {
    return `export function createPlugin() {
  return {
    tools: {
      async ${name.replace(/-/g, '_')}_run({ input }) {
        return { content: String(input ?? '') , details: { length: String(input ?? '').length } }
      },
    },
  }
}
`
  }

  if (template === 'panel') {
    return `// This plugin is UI-only: it contributes a sandboxed panel and no runtime
// behaviour. Delete this file and the "main" field if you do not need one.
export function createPlugin() {
  return {}
}
`
  }

  return `export function createPlugin(context) {
  let runs = 0

  const buttonNode = () => ({
    type: 'button',
    label: runs > 0 ? \`${titleize(name)} ×\${runs}\` : '${titleize(name)}',
    icon: 'puzzle',
    variant: 'ghost',
    onClick: { action: 'run' },
  })

  return {
    ui: {
      getSlots(slotName) {
        return slotName === 'composer.actions' ? [buttonNode()] : undefined
      },
      async handle(action, payload, info) {
        if (action !== 'run') return {}
        runs += 1
        return {
          slots: { 'composer.actions': [buttonNode()] },
          state: { runs },
          toast: { level: 'info', message: \`${titleize(name)} clicked (\${info.slot})\` },
        }
      },
    },
  }
}
`
}

function panelHtml({ name }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${titleize(name)}</title>
  <style>
    body { margin: 0; padding: 16px; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
  </style>
</head>
<body>
  <p>${titleize(name)} panel. Everything goes through the host bridge.</p>
  <button id="ping" type="button">Ping</button>
  <output id="out"></output>

  <script>
    let seq = 0
    const pending = new Map()

    function call(method, ...args) {
      const id = String(++seq)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        parent.postMessage({ type: 'qf:call', id, method, args }, '*')
        setTimeout(() => { if (pending.delete(id)) reject(new Error('bridge timeout')) }, 5000)
      })
    }

    addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.type !== 'qf:result') return
      const entry = pending.get(data.id)
      if (!entry) return
      pending.delete(data.id)
      data.ok ? entry.resolve(data.data) : entry.reject(new Error(data.error || 'bridge error'))
    })

    document.getElementById('ping').addEventListener('click', async () => {
      const count = Number(await call('kv.get', 'pings').catch(() => 0)) + 1
      await call('kv.set', 'pings', count).catch(() => {})
      document.getElementById('out').textContent = ' ' + count
      await call('notify', 'info', 'pings: ' + count).catch(() => {})
    })
  </script>
</body>
</html>
`
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.targetDir) usage('missing <targetDir>')
  if (!NAME_PATTERN.test(args.name)) usage(`--name must match ${NAME_PATTERN}`)
  if (!['ui', 'tool', 'panel'].includes(args.template)) usage(`unknown --template: ${args.template}`)

  const targetDir = path.resolve(process.cwd(), args.targetDir)
  if (!args.force && (await exists(targetDir))) {
    usage(`${targetDir} already exists (use --force to write into it)`)
  }

  await fs.mkdir(targetDir, { recursive: true })
  await fs.writeFile(path.join(targetDir, 'plugin.json'), `${JSON.stringify(pluginJson(args), null, 2)}\n`)
  await fs.writeFile(path.join(targetDir, 'index.mjs'), indexModule(args))

  if (args.template === 'panel') {
    await fs.mkdir(path.join(targetDir, 'panel'), { recursive: true })
    await fs.writeFile(path.join(targetDir, 'panel', 'index.html'), panelHtml(args))
  }

  console.log(`created ${args.template} plugin "${args.name}" at ${targetDir}`)
  console.log('next: node skills/plugin-creator/scripts/validate-plugin.mjs ' + targetDir)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
