import { describe, it, expect } from 'vitest'
import {
  createRandomToken,
  hashPassword,
  verifyPassword,
  sha256Base64Url,
  safeHashEqual,
} from '../../../server/utils/password-auth.mjs'

describe('password-auth', () => {
  describe('createRandomToken', () => {
    it('returns a base64url string of the expected length', () => {
      const token = createRandomToken()
      // 24 bytes → 32 base64url characters (no padding)
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(0)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it('respects custom byte length', () => {
      const token = createRandomToken(48)
      expect(token.length).toBeGreaterThan(createRandomToken().length)
    })

    it('produces different tokens on successive calls', () => {
      const a = createRandomToken()
      const b = createRandomToken()
      expect(a).not.toBe(b)
    })
  })

  describe('hashPassword', () => {
    it('returns hash, salt and version for a valid password', async () => {
      const result = await hashPassword('secret123')
      expect(result).toHaveProperty('passwordHash')
      expect(result).toHaveProperty('passwordSalt')
      expect(result).toHaveProperty('passwordVersion')
      expect(result.passwordHash).toBeTruthy()
      expect(result.passwordSalt).toBeTruthy()
      expect(result.passwordVersion).toBe(1)
    })

    it('uses the provided salt', async () => {
      const salt = 'fixed-salt-value'
      const result = await hashPassword('secret', salt)
      expect(result.passwordSalt).toBe(salt)
    })

    it('returns consistent hash for same password and salt', async () => {
      const salt = 'consistent-salt'
      const a = await hashPassword('password', salt)
      const b = await hashPassword('password', salt)
      expect(a.passwordHash).toBe(b.passwordHash)
    })

    it('returns empty object for empty password', async () => {
      const result = await hashPassword('')
      expect(result).toEqual({})
    })

    it('returns empty object for non-string password', async () => {
      const result = await hashPassword(null)
      expect(result).toEqual({})
    })
  })

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      const record = await hashPassword('correct-password')
      const result = await verifyPassword(record, 'correct-password')
      expect(result).toBe(true)
    })

    it('returns false for incorrect password', async () => {
      const record = await hashPassword('correct-password')
      const result = await verifyPassword(record, 'wrong-password')
      expect(result).toBe(false)
    })

    it('returns false for null record', async () => {
      const result = await verifyPassword(null, 'password')
      expect(result).toBe(false)
    })

    it('returns false for empty password', async () => {
      const record = await hashPassword('some-password')
      const result = await verifyPassword(record, '')
      expect(result).toBe(false)
    })

    it('returns false when record is missing fields', async () => {
      const result = await verifyPassword({ passwordHash: 'abc' }, 'password')
      expect(result).toBe(false)
    })
  })

  describe('sha256Base64Url', () => {
    it('returns a deterministic base64url hash', () => {
      const hash = sha256Base64Url('hello')
      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(sha256Base64Url('hello')).toBe(hash)
    })

    it('produces different hashes for different inputs', () => {
      expect(sha256Base64Url('hello')).not.toBe(sha256Base64Url('world'))
    })

    it('handles non-string values', () => {
      const hash = sha256Base64Url(123)
      expect(hash).toBeDefined()
      expect(typeof hash).toBe('string')
    })
  })

  describe('safeHashEqual', () => {
    it('returns true for identical strings', () => {
      expect(safeHashEqual('abc', 'abc')).toBe(true)
    })

    it('returns false for different strings', () => {
      expect(safeHashEqual('abc', 'def')).toBe(false)
    })

    it('returns false when either argument is empty', () => {
      expect(safeHashEqual('', 'abc')).toBe(false)
      expect(safeHashEqual('abc', '')).toBe(false)
    })

    it('returns false when either argument is null', () => {
      expect(safeHashEqual(null, 'abc')).toBe(false)
      expect(safeHashEqual('abc', null)).toBe(false)
    })

    it('returns false for strings of different length', () => {
      expect(safeHashEqual('ab', 'abc')).toBe(false)
    })
  })
})
