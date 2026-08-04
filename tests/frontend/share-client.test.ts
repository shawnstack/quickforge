import { describe, expect, it, vi } from 'vitest'
import { conversationShareStatus } from '../../src/lib/share-client'

describe('conversation share status', () => {
  it('prioritizes disabled status and detects expiration', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))

    expect(conversationShareStatus({ id: 'one', permission: 'read', revokedAt: '2025-12-31T00:00:00.000Z' })).toBe('disabled')
    expect(conversationShareStatus({ id: 'two', permission: 'read', expiresAt: '2026-01-01T11:59:59.000Z' })).toBe('expired')
    expect(conversationShareStatus({ id: 'three', permission: 'read', expiresAt: '2026-01-01T12:00:01.000Z' })).toBe('active')

    vi.useRealTimers()
  })
})
