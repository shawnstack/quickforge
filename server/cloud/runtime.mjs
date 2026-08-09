import { CloudClient } from './client.mjs'
import { readCloudConfig, cloudEndpoint } from './config.mjs'
import { createCloudCredentialStore } from './credential-store.mjs'
import { CloudIdentityManager } from './identity.mjs'
import { ManagedCloudModels, isManagedCloudModel } from './models.mjs'
import { readCloudServiceConfig } from './service-config.mjs'

let singleton
let singletonKey
let singletonPromise
let runtimeOverride = false
let runtimeGeneration = 0
let runtimeFactory = createCloudRuntime

function runtimeKey(config, generation = runtimeGeneration) {
  return `${generation}:${config?.enabled === true}:${config?.baseUrl?.href || ''}:${config?.timeoutMs || ''}`
}

export function createCloudRuntime({ config = readCloudConfig(), store, client } = {}) {
  const credentialStore = store || createCloudCredentialStore({ clientVersion: process.env.npm_package_version || 'unknown' })
  if (!config?.baseUrl) return { enabled: false, config, store: credentialStore }
  const cloudClient = client || new CloudClient(config)
  const identity = new CloudIdentityManager({ client: cloudClient, store: credentialStore, serviceUrl: config.baseUrl.href })
  const models = new ManagedCloudModels({ identity })
  return { enabled: config.enabled === true, config, store: credentialStore, client: cloudClient, identity, models }
}

async function resolvedRuntimeConfig() {
  const service = await readCloudServiceConfig()
  const timeoutValue = Number(process.env.QUICKFORGE_CLOUD_TIMEOUT_MS || 10_000)
  return {
    enabled: service.enabled === true && Boolean(service.baseUrl),
    baseUrl: service.baseUrl,
    cloudUrl: service.cloudUrl,
    source: service.source,
    saved: service.saved,
    timeoutMs: Number.isFinite(timeoutValue) ? Math.min(60_000, Math.max(1_000, timeoutValue)) : 10_000,
  }
}

export async function getCloudRuntime() {
  if (runtimeOverride) return singleton
  const generation = runtimeGeneration
  const config = await resolvedRuntimeConfig()
  if (runtimeOverride) return singleton
  if (generation !== runtimeGeneration) return getCloudRuntime()
  const key = runtimeKey(config, generation)
  if (singleton && singletonKey === key) return singleton
  if (singletonPromise && singletonKey === key) return singletonPromise
  singletonKey = key
  const promise = Promise.resolve(runtimeFactory({ config })).then((runtime) => {
    if (
      !runtimeOverride
      && generation === runtimeGeneration
      && singletonKey === key
      && singletonPromise === promise
    ) {
      singleton = runtime
    }
    return runtime
  }).finally(() => {
    if (singletonPromise === promise) singletonPromise = undefined
  })
  singletonPromise = promise
  return promise
}

export function invalidateCloudRuntime() {
  runtimeGeneration++
  runtimeOverride = false
  singleton = undefined
  singletonKey = undefined
  singletonPromise = undefined
}

export async function resolveManagedCloudProvider(model, signal) {
  if (!isManagedCloudModel(model)) return undefined
  const runtime = await getCloudRuntime()
  if (!runtime.enabled) {
    const error = new Error(runtime?.config?.baseUrl && runtime?.config?.enabled !== true
      ? 'QuickForge Cloud is disabled.'
      : 'QuickForge Cloud is not configured.')
    error.code = runtime?.config?.baseUrl && runtime?.config?.enabled !== true ? 'cloud_disabled' : 'cloud_not_configured'
    throw error
  }
  const resolved = await runtime.models.resolve(model, signal)
  const accessToken = await runtime.identity.access({ signal })
  return {
    model: {
      ...resolved.publicModel,
      id: resolved.catalogId,
      name: resolved.publicModel.name || resolved.catalogId,
      provider: 'quickforge-cloud',
      api: 'openai-completions',
      baseUrl: cloudEndpoint(runtime.config.baseUrl, 'v1/').href.replace(/\/$/, ''),
      headers: undefined,
      // The Cloud gateway implements the conservative OpenAI-compatible request
      // shape. Disable newer OpenAI-only fields that strict gateways may reject.
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
        maxTokensField: 'max_tokens',
      },
      // The cloud catalog does not carry per-model USD prices (billing is done
      // server-side in credits). pi-ai's calculateCost() reads model.cost.*
      // unconditionally, so provide a zero cost table to avoid throwing when
      // parsing streamed usage chunks.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    apiKey: accessToken,
  }
}

export function resetCloudRuntimeForTests() {
  runtimeGeneration = 0
  runtimeOverride = false
  runtimeFactory = createCloudRuntime
  singleton = undefined
  singletonKey = undefined
  singletonPromise = undefined
}

export function setCloudRuntimeFactoryForTests(factory) {
  runtimeFactory = factory
}

export function setCloudRuntimeForTests(runtime) {
  runtimeOverride = true
  singleton = runtime
  singletonKey = runtimeKey(runtime?.config)
  singletonPromise = undefined
}
