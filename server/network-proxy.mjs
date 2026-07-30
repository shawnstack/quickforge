import tls from 'node:tls'
import { Agent, DecoratorHandler, Dispatcher, ProxyAgent } from 'undici'
import { SocksClient } from 'socks'
import { atomicUpdate, readStore } from './storage.mjs'

const SETTINGS_KEY = 'network-proxy'
const VALID_MODES = new Set(['direct', 'system', 'manual'])
const PROXY_ENV_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]
const ORIGINAL_FETCH = globalThis.fetch.bind(globalThis)
const FETCH_PATCH_MARKER = Symbol.for('quickforge.networkProxy.fetchPatched')

let currentConfig = { mode: 'direct', proxyUrl: '' }
let hostRuntime = null
let nativeResolver = null
let nativeResolverError = null
let networkDispatcher = null
let initialized = false
let lastAppliedAt = null

export function normalizeNetworkProxyConfig(value) {
  const mode = VALID_MODES.has(value?.mode) ? value.mode : 'direct'
  const proxyUrl = typeof value?.proxyUrl === 'string' ? value.proxyUrl.trim() : ''
  return { mode, proxyUrl }
}

export function validateManualProxyUrl(value) {
  let url
  try {
    url = new URL(String(value || '').trim())
  } catch {
    const error = new Error('Proxy address must be a valid HTTP or HTTPS URL')
    error.statusCode = 400
    throw error
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    const error = new Error('Only HTTP and HTTPS proxy addresses are supported')
    error.statusCode = 400
    throw error
  }
  if (!url.hostname || !url.port) {
    const error = new Error('Proxy address must include a host and port')
    error.statusCode = 400
    throw error
  }
  if (url.username || url.password) {
    const error = new Error('Proxy credentials are not supported in the proxy address')
    error.statusCode = 400
    throw error
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    const error = new Error('Proxy address cannot include a path, query, or fragment')
    error.statusCode = 400
    throw error
  }

  return `${url.protocol}//${url.host}`
}

function isLoopbackUrl(input) {
  let url
  try {
    if (typeof Request !== 'undefined' && input instanceof Request) url = new URL(input.url)
    else url = new URL(input instanceof URL ? input.href : String(input))
  } catch {
    return false
  }
  return ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(url.hostname)
}

function withoutProxyEnvironment(callback) {
  const previous = new Map()
  for (const key of PROXY_ENV_KEYS) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }
  try {
    return callback()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function getNativeResolver() {
  if (nativeResolver) return nativeResolver
  if (nativeResolverError) throw nativeResolverError

  try {
    const { ProxyResolver } = await import('@vscode/os-proxy-resolver')
    nativeResolver = withoutProxyEnvironment(() => new ProxyResolver())
    return nativeResolver
  } catch (error) {
    nativeResolverError = error instanceof Error ? error : new Error(String(error))
    throw nativeResolverError
  }
}

function parseProxyHost(value) {
  const raw = String(value || '').trim()
  const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
  return {
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    secure: url.protocol === 'https:',
  }
}

function createSocksConnector(proxyHost) {
  const proxy = parseProxyHost(proxyHost)
  return (options, callback) => {
    const destinationHost = options.hostname || options.host
    const destinationPort = Number(options.port || (options.protocol === 'https:' ? 443 : 80))
    let settled = false

    const complete = (error, socket) => {
      if (settled) return
      settled = true
      callback(error, socket)
    }

    SocksClient.createConnection({
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
      },
      command: 'connect',
      destination: {
        host: destinationHost,
        port: destinationPort,
      },
      timeout: Number(options.timeout || 10000),
    }).then(({ socket }) => {
      if (options.protocol !== 'https:') {
        complete(null, socket)
        return
      }
      const secureSocket = tls.connect({
        socket,
        servername: options.servername || destinationHost,
        ALPNProtocols: ['http/1.1'],
      })
      secureSocket.once('secureConnect', () => complete(null, secureSocket))
      secureSocket.once('error', (error) => complete(error))
    }).catch((error) => complete(error))

    return () => {
      settled = true
    }
  }
}

class RetryHandler extends DecoratorHandler {
  constructor(dispatcher, options, handler, retry) {
    super(handler)
    this.dispatcher = dispatcher
    this.options = options
    this.retry = retry
    this.receivedResponse = false
  }

  onResponseStart(controller, statusCode, headers, statusMessage) {
    this.receivedResponse = true
    return super.onResponseStart(controller, statusCode, headers, statusMessage)
  }

  onResponseError(controller, error) {
    if (!this.receivedResponse) {
      void this.retry(error)
      return
    }
    return super.onResponseError(controller, error)
  }
}

class SystemProxyDispatcher extends Dispatcher {
  constructor(resolver) {
    super()
    this.resolver = resolver
    this.directAgent = new Agent()
    this.dispatchers = new Map()
  }

  dispatcherFor(route) {
    if (!route || route.kind === 'direct') return this.directAgent
    const key = `${route.kind}:${route.host}`
    if (this.dispatchers.has(key)) return this.dispatchers.get(key)

    let dispatcher
    if (route.kind === 'http') {
      const proxy = parseProxyHost(route.host)
      dispatcher = new ProxyAgent({ uri: `${proxy.secure ? 'https' : 'http'}://${proxy.host}:${proxy.port}` })
    } else if (route.kind === 'socks') {
      dispatcher = new Agent({ connect: createSocksConnector(route.host) })
    } else {
      dispatcher = this.directAgent
    }
    this.dispatchers.set(key, dispatcher)
    return dispatcher
  }

  dispatch(options, handler) {
    const url = `${options.origin}${options.path}`
    let routes = []
    let index = 0

    const tryNext = async (lastError) => {
      if (index >= routes.length) {
        handler.onResponseError?.(null, lastError || new Error('No usable system proxy route'))
        return
      }
      const route = routes[index]
      index += 1
      const dispatcher = this.dispatcherFor(route)
      const retryHandler = new RetryHandler(dispatcher, options, handler, async (error) => {
        if (route?.kind !== 'direct') this.resolver.reportProxyFailed(route)
        await tryNext(error)
      })
      try {
        dispatcher.dispatch(options, retryHandler)
      } catch (error) {
        if (route?.kind !== 'direct') this.resolver.reportProxyFailed(route)
        await tryNext(error)
      }
    }

    void this.resolver.resolve(url).then((resolvedRoutes) => {
      routes = Array.isArray(resolvedRoutes) && resolvedRoutes.length ? resolvedRoutes : [{ kind: 'direct' }]
      return tryNext()
    }).catch((error) => handler.onResponseError?.(null, error))

    return true
  }

  async close() {
    const dispatchers = [this.directAgent, ...this.dispatchers.values()]
    await Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.close()))
    this.dispatchers.clear()
  }

  async destroy(error) {
    const dispatchers = [this.directAgent, ...this.dispatchers.values()]
    await Promise.allSettled(dispatchers.map((dispatcher) => dispatcher.destroy(error)))
    this.dispatchers.clear()
  }
}

async function createNetworkDispatcher(config) {
  if (config.mode === 'manual') return new ProxyAgent(config.proxyUrl)
  if (config.mode === 'system') return new SystemProxyDispatcher(await getNativeResolver())
  return new Agent()
}

async function replaceNetworkDispatcher(config) {
  const previous = networkDispatcher
  networkDispatcher = await createNetworkDispatcher(config)
  if (previous) void previous.close().catch(() => {})
}

function installNetworkFetch() {
  if (globalThis[FETCH_PATCH_MARKER]) return
  globalThis.fetch = async (input, init = {}) => {
    if (isLoopbackUrl(input)) return ORIGINAL_FETCH(input, init)
    if (hostRuntime) {
      if (currentConfig.mode === 'direct') return ORIGINAL_FETCH(input, init)
      return hostRuntime.fetch(input, init)
    }
    if (!networkDispatcher) return ORIGINAL_FETCH(input, init)
    return ORIGINAL_FETCH(input, { ...init, dispatcher: networkDispatcher })
  }
  globalThis[FETCH_PATCH_MARKER] = true
}

export function registerHostNetworkRuntime(runtime) {
  hostRuntime = runtime || null
}

async function persistConfig(config) {
  await atomicUpdate('settings', (settings) => ({
    ...settings,
    [SETTINGS_KEY]: config,
  }))
}

async function applyConfig(config) {
  const normalized = normalizeNetworkProxyConfig(config)
  if (normalized.mode === 'manual') normalized.proxyUrl = validateManualProxyUrl(normalized.proxyUrl)

  if (hostRuntime) await hostRuntime.apply(normalized)
  else await replaceNetworkDispatcher(normalized)

  currentConfig = normalized
  lastAppliedAt = new Date().toISOString()
  return currentConfig
}

async function nativeStatus() {
  try {
    const resolver = await getNativeResolver()
    const config = await resolver.readProxyConfig()
    const source = config.platform?.kind || process.platform
    return {
      supported: true,
      source,
      features: {
        pac: config.configuredPac?.state !== 'unsupported',
        wpad: config.wpadDns?.state !== 'unsupported' || config.wpadDhcp?.state !== 'unsupported',
        httpProxy: true,
        httpsProxy: true,
        socks: true,
      },
    }
  } catch (error) {
    return {
      supported: false,
      source: 'none',
      features: { pac: false, wpad: false, httpProxy: false, httpsProxy: false, socks: false },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getNetworkProxyStatus() {
  const runtimeStatus = hostRuntime
    ? await hostRuntime.getStatus()
    : await nativeStatus()
  const configuredMode = currentConfig.mode
  const modeSupported = configuredMode !== 'system' || runtimeStatus.supported
  return {
    configuredMode,
    effectiveMode: modeSupported ? configuredMode : 'unsupported',
    proxyUrl: currentConfig.proxyUrl,
    runtimeKind: hostRuntime ? 'electron-inline' : (process.versions.electron ? 'electron-node' : 'node'),
    lastAppliedAt,
    ...runtimeStatus,
  }
}

export async function initializeNetworkProxy() {
  if (initialized) return { config: currentConfig, status: await getNetworkProxyStatus() }
  installNetworkFetch()
  const settings = await readStore('settings')
  await applyConfig(settings?.[SETTINGS_KEY])
  initialized = true
  return { config: currentConfig, status: await getNetworkProxyStatus() }
}

export async function getNetworkProxyConfig() {
  if (!initialized) await initializeNetworkProxy()
  return { config: currentConfig, status: await getNetworkProxyStatus() }
}

export async function updateNetworkProxyConfig(value) {
  if (!initialized) await initializeNetworkProxy()
  const previous = currentConfig
  const next = normalizeNetworkProxyConfig(value)
  if (next.mode === 'manual') next.proxyUrl = validateManualProxyUrl(next.proxyUrl)

  await applyConfig(next)
  try {
    await persistConfig(currentConfig)
  } catch (error) {
    await applyConfig(previous)
    throw error
  }
  return { config: currentConfig, status: await getNetworkProxyStatus() }
}

export async function refreshSystemProxy() {
  if (!initialized) await initializeNetworkProxy()
  nativeResolver?.close?.()
  nativeResolver = null
  nativeResolverError = null
  if (hostRuntime) await hostRuntime.refresh()
  else await replaceNetworkDispatcher(currentConfig)
  lastAppliedAt = new Date().toISOString()
  return { config: currentConfig, status: await getNetworkProxyStatus() }
}
