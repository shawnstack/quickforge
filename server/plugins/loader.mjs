import { pathToFileURL } from 'node:url'

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function contentToText(result) {
  if (typeof result === 'string') return result
  if (Array.isArray(result?.content)) {
    return result.content.map((item) => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return item.text || ''
      return JSON.stringify(item)
    }).join('\n')
  }
  if (Object.prototype.hasOwnProperty.call(result || {}, 'content')) return String(result.content ?? '')
  return JSON.stringify(result ?? null, null, 2)
}

export async function loadPlugin(manifest, context = {}) {
  const mainPath = new URL(manifest.main, pathToFileURL(`${manifest.dir}/`))
  const moduleUrl = `${mainPath.href}?quickforgePluginReload=${Date.now()}`
  const module = await import(moduleUrl)
  const factory = module.createPlugin || module.default
  if (typeof factory !== 'function') {
    throw new Error(`Plugin ${manifest.name} must export createPlugin(context) or a default factory function.`)
  }

  const plugin = await factory({
    ...context,
    plugin: {
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      dir: manifest.dir,
    },
  })

  if (!isPlainObject(plugin)) {
    throw new Error(`Plugin ${manifest.name} factory must return an object.`)
  }

  const tools = isPlainObject(plugin.tools) ? plugin.tools : {}
  return {
    async callTool(toolName, params = {}, toolContext = {}) {
      const handler = tools[toolName]
      if (typeof handler !== 'function') throw new Error(`Plugin ${manifest.name} did not provide handler for tool ${toolName}.`)
      const result = await handler(params || {}, toolContext)
      return {
        content: contentToText(result),
        details: isPlainObject(result?.details) ? result.details : undefined,
        isError: Boolean(result?.isError),
      }
    },
  }
}
