import { beforeEach, describe, expect, it, vi } from 'vitest'

const stateMock = vi.hoisted(() => ({ state: null }))
vi.mock('../../server/agent-manager.mjs', () => ({
  getSessionState: () => stateMock.state,
}))
vi.mock('../../server/session-state-service.mjs', () => ({
  findSessionAttachmentRecord: vi.fn(async () => null),
}))

const { findSessionAttachment } = await import('../../server/message-attachment-lookup.mjs')
const { findSessionAttachmentRecord } = await import('../../server/session-state-service.mjs')

const attachment = { id: 'file_1', type: 'image', content: 'AAAA' }

beforeEach(() => {
  stateMock.state = null
  findSessionAttachmentRecord.mockClear()
})

describe('findSessionAttachment', () => {
  it('resolves from the in-memory transcript first', async () => {
    stateMock.state = { messages: [{ role: 'user', content: 'x' }, { role: 'user-with-attachments', attachments: [attachment] }] }

    await expect(findSessionAttachment('session-1', 'file_1')).resolves.toBe(attachment)
    expect(findSessionAttachmentRecord).not.toHaveBeenCalled()
  })

  it('falls back to stored messages for cold sessions', async () => {
    findSessionAttachmentRecord.mockResolvedValue(attachment)

    await expect(findSessionAttachment('session-1', 'file_1')).resolves.toBe(attachment)
    expect(findSessionAttachmentRecord).toHaveBeenCalledWith('session-1', 'file_1')
  })

  it('returns null for invalid ids without touching storage', async () => {
    await expect(findSessionAttachment('', 'file_1')).resolves.toBeNull()
    await expect(findSessionAttachment('session-1', '')).resolves.toBeNull()
    expect(findSessionAttachmentRecord).not.toHaveBeenCalled()
  })
})
