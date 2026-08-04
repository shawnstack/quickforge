import { generateKeyPair } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createRandomToken } from '../utils/password-auth.mjs'
import { ensureStorage, storageDir } from '../storage.mjs'

const generateKeyPairAsync = promisify(generateKeyPair)
const SCHEMA_VERSION = 1

function platformName(platform = process.platform) {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

function defaultRecord({ installationName, platform, clientVersion } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: 'local',
    installationName: installationName || os.hostname() || 'QuickForge',
    platform: platformName(platform),
    clientVersion: clientVersion || 'unknown',
    updatedAt: new Date().toISOString(),
  }
}

function normalizeRecord(value, defaults) {
  const input = value && typeof value === 'object' ? value : {}
  const base = defaultRecord(defaults)
  return {
    ...base,
    ...input,
    schemaVersion: SCHEMA_VERSION,
    mode: ['local', 'guest', 'account'].includes(input.mode) ? input.mode : 'local',
    installationName: String(input.installationName || base.installationName).slice(0, 120),
    platform: ['windows', 'macos', 'linux'].includes(input.platform) ? input.platform : base.platform,
    clientVersion: String(input.clientVersion || base.clientVersion).slice(0, 80),
  }
}

function publicRecord(record) {
  return {
    configured: true,
    mode: record.mode,
    installationId: record.installationId,
    installationName: record.installationName,
    platform: record.platform,
    clientVersion: record.clientVersion,
    hasInstallationKey: Boolean(record.publicKey && record.privateKeyPkcs8),
    hasSession: Boolean(record.refreshToken),
    account: record.account,
    updatedAt: record.updatedAt,
  }
}

async function generateInstallationKeyPair() {
  const { publicKey, privateKey } = await generateKeyPairAsync('ed25519')
  const publicJwk = publicKey.export({ format: 'jwk' })
  return {
    publicKey: publicJwk.x,
    privateKeyPkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  }
}

export function createCloudCredentialStore({
  filePath = path.join(storageDir, 'security', 'cloud-identity.json'),
  ensureBaseStorage = ensureStorage,
  installationName,
  platform,
  clientVersion,
} = {}) {
  let queue = Promise.resolve()
  const defaults = { installationName, platform, clientVersion }

  async function ensureDirectory() {
    await ensureBaseStorage()
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  }

  async function read() {
    await ensureDirectory()
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      return normalizeRecord(raw.trim() ? JSON.parse(raw) : {}, defaults)
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultRecord(defaults)
      throw error
    }
  }

  async function writeNow(record) {
    await ensureDirectory()
    const normalized = normalizeRecord({ ...record, updatedAt: new Date().toISOString() }, defaults)
    const temporary = `${filePath}.${process.pid}.${createRandomToken(8)}.tmp`
    await fs.writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    try { await fs.chmod(temporary, 0o600) } catch { /* best effort on Windows */ }
    try {
      await fs.rename(temporary, filePath)
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error
      await fs.rm(filePath, { force: true })
      await fs.rename(temporary, filePath)
    }
    try { await fs.chmod(filePath, 0o600) } catch { /* best effort on Windows */ }
    return normalized
  }

  function update(mutator) {
    const next = queue.catch(() => undefined).then(async () => {
      const current = await read()
      const result = await mutator({ ...current })
      return writeNow(result || current)
    })
    queue = next
    return next
  }

  async function ensureInstallation() {
    const current = await read()
    if (current.publicKey && current.privateKeyPkcs8) return current
    return update(async (record) => ({ ...record, ...(await generateInstallationKeyPair()) }))
  }

  async function rotateInstallation() {
    const keyPair = await generateInstallationKeyPair()
    return update((record) => ({
      ...record,
      ...keyPair,
      mode: 'local',
      installationId: undefined,
      refreshToken: undefined,
      pendingRegistrationKey: undefined,
      pendingRegistrationHash: undefined,
      account: undefined,
      rotateInstallationBeforeRegistration: undefined,
    }))
  }

  return {
    filePath,
    read,
    update,
    ensureInstallation,
    rotateInstallation,
    async readPublic() { return publicRecord(await read()) },
    async clearSession({ rotateInstallationBeforeRegistration = false } = {}) {
      return update((record) => ({
        ...record,
        mode: 'local',
        installationId: undefined,
        refreshToken: undefined,
        pendingRegistrationKey: undefined,
        pendingRegistrationHash: undefined,
        account: undefined,
        rotateInstallationBeforeRegistration: rotateInstallationBeforeRegistration || undefined,
      }))
    },
  }
}

export { publicRecord as publicCloudCredentialRecord }
