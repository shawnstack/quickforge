import { CloudClient } from './client.mjs'
import { readCloudConfig, cloudEndpoint } from './config.mjs'
import { createCloudCredentialStore } from './credential-store.mjs'
import { CloudIdentityManager } from './identity.mjs'
import { ManagedCloudModels, isManagedCloudModel } from './models.mjs'

let singleton
let singletonError

export function createCloudRuntime({ config = readCloudConfig(), store, client } = {}) {
  if (!config.enabled) return { enabled: false, config }
  const credentialStore = store || createCloudCredentialStore({ clientVersion: process.env.npm_package_version || 'unknown' })
  const cloudClient = client || new CloudClient(config)
  const identity = new CloudIdentityManager({ client: cloudClient, store: credentialStore })
  const models = new ManagedCloudModels({ identity })
  return { enabled: true, config, store: credentialStore, client: cloudClient, identity, models }
}

export function getCloudRuntime() {
  if (singleton || singletonError) {
    if (singletonError) throw singletonError
    return singleton
  }
  try { singleton = createCloudRuntime() } catch (error) { singletonError = error; throw error }
  return singleton
}

export async function resolveManagedCloudProvider(model, signal) {
  if (!isManagedCloudModel(model)) return undefined
  const runtime = getCloudRuntime()
  if (!runtime.enabled) throw new Error('QuickForge Cloud is not configured.')
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
    },
    apiKey: accessToken,
  }
}

export function resetCloudRuntimeForTests() {
  singleton = undefined
  singletonError = undefined
}
