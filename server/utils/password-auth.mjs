import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const PASSWORD_VERSION = 1

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

export function createRandomToken(bytes = 24) {
  return randomToken(bytes)
}

export async function hashPassword(password, salt = randomToken(16)) {
  if (typeof password !== 'string' || !password) return {}
  const derived = await scrypt(password, salt, 32)
  return {
    passwordHash: derived.toString('base64url'),
    passwordSalt: salt,
    passwordVersion: PASSWORD_VERSION,
  }
}

export async function verifyPassword(record, password) {
  if (!record?.passwordHash || !record?.passwordSalt || typeof password !== 'string' || !password) return false
  const { passwordHash } = await hashPassword(password, record.passwordSalt)
  const expected = Buffer.from(record.passwordHash, 'base64url')
  const actual = Buffer.from(passwordHash, 'base64url')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function sha256Base64Url(value) {
  return createHash('sha256').update(String(value)).digest('base64url')
}

export function safeHashEqual(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false
  const expected = Buffer.from(expectedHash)
  const actual = Buffer.from(actualHash)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
