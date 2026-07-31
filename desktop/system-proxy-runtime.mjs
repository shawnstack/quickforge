import { session } from 'electron'

const PARTITION = 'quickforge-network'
const nodeFetch = globalThis.fetch.bind(globalThis)

function proxyRulesForUrl(value) {
  const url = new URL(value)
  return `${url.protocol}//${url.host}`
}

function requestUrl(input) {
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  if (input instanceof URL) return input.href
  return String(input)
}

function isLoopback(input) {
  try {
    const url = new URL(requestUrl(input))
    return ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function createDesktopNetworkRuntime() {
  const networkSession = session.fromPartition(PARTITION)
  let configuredMode = 'direct'
  let lastAppliedAt = null

  async function apply(config) {
    configuredMode = config.mode
    if (config.mode === 'system') {
      await networkSession.setProxy({ mode: 'system' })
    } else if (config.mode === 'pac') {
      await networkSession.setProxy({ mode: 'pac_script', pacScript: config.proxyUrl })
    } else if (config.mode === 'manual') {
      await networkSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: proxyRulesForUrl(config.proxyUrl),
        proxyBypassRules: '<local>;localhost;127.0.0.1;[::1]',
      })
    } else {
      await networkSession.setProxy({ mode: 'direct' })
    }
    await networkSession.closeAllConnections()
    lastAppliedAt = new Date().toISOString()
  }

  return {
    async apply(config) {
      await apply(config)
    },
    async fetch(input, init) {
      if (isLoopback(input)) return nodeFetch(input, init)
      return networkSession.fetch(input, init)
    },
    async refresh() {
      if (configuredMode === 'system') {
        await networkSession.setProxy({ mode: 'system' })
        await networkSession.closeAllConnections()
        lastAppliedAt = new Date().toISOString()
      }
    },
    async getStatus() {
      return {
        supported: true,
        source: 'electron-chromium',
        features: {
          pac: true,
          pacUrl: true,
          wpad: true,
          httpProxy: true,
          httpsProxy: true,
          socks: true,
        },
        runtimeLastAppliedAt: lastAppliedAt,
      }
    },
  }
}
