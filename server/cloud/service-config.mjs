import { atomicUpdate, readStore } from '../storage.mjs'
import { parseCloudBaseUrl } from './config.mjs'

export const CLOUD_SERVICE_SETTINGS_KEY = 'quickforge-cloud-service'
export const CLOUD_SERVICE_SCHEMA_VERSION = 1
export const CLOUD_SERVICE_TYPE = 'quickforge-cloud'
export const DEFAULT_CLOUD_URL = 'http://127.0.0.1:8082/'

function savedServiceRecord(settings) {
  const value = settings?.[CLOUD_SERVICE_SETTINGS_KEY]
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function candidateFrom(settings, env) {
  const saved = savedServiceRecord(settings)
  if (saved && typeof saved.cloudUrl === 'string' && saved.cloudUrl.trim()) {
    return { value: saved.cloudUrl, source: 'saved', saved: true }
  }
  if (typeof env?.QUICKFORGE_CLOUD_URL === 'string' && env.QUICKFORGE_CLOUD_URL.trim()) {
    return { value: env.QUICKFORGE_CLOUD_URL, source: 'env', saved: false }
  }
  return { value: DEFAULT_CLOUD_URL, source: 'default', saved: false }
}

export async function readCloudServiceConfig({ readSettings = readStore, env = process.env, strict = true } = {}) {
  const settings = await readSettings('settings')
  const candidate = candidateFrom(settings, env)
  try {
    const baseUrl = parseCloudBaseUrl(candidate.value)
    return {
      schemaVersion: CLOUD_SERVICE_SCHEMA_VERSION,
      serviceType: CLOUD_SERVICE_TYPE,
      cloudUrl: baseUrl.href,
      baseUrl,
      source: candidate.source,
      saved: candidate.saved,
      valid: true,
    }
  } catch (error) {
    if (strict) throw error
    return {
      schemaVersion: CLOUD_SERVICE_SCHEMA_VERSION,
      serviceType: CLOUD_SERVICE_TYPE,
      cloudUrl: String(candidate.value || '').trim(),
      source: candidate.source,
      saved: candidate.saved,
      valid: false,
      configurationError: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function saveCloudServiceConfig(cloudUrl, { updateSettings = atomicUpdate } = {}) {
  const baseUrl = parseCloudBaseUrl(cloudUrl)
  const record = {
    schemaVersion: CLOUD_SERVICE_SCHEMA_VERSION,
    serviceType: CLOUD_SERVICE_TYPE,
    cloudUrl: baseUrl.href,
  }
  await updateSettings('settings', (settings) => ({
    ...settings,
    [CLOUD_SERVICE_SETTINGS_KEY]: record,
  }))
  return record
}

export function publicCloudServiceConfig(config) {
  return {
    schemaVersion: CLOUD_SERVICE_SCHEMA_VERSION,
    serviceType: CLOUD_SERVICE_TYPE,
    cloudUrl: config.cloudUrl,
    source: config.source,
    saved: config.saved,
    valid: config.valid,
    configurationError: config.configurationError,
  }
}
