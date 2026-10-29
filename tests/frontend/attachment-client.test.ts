import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveAttachmentPayload,
  resolveAttachmentsForDraft,
  resolveMessagesForUpload,
} from '../../src/components/chat/surface/attachment-client'
import type { Attachment } from '../../src/components/chat/surface/ChatTypes'

const fetchMock = vi.fn()

function projected(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'image_1',
    type: 'image',
    fileName: 'image.png',
    mimeType: 'image/png',
    size: 3,
    assetUrl: '/api/sessions/s/attachments/image_1',
    ...overrides,
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('attachment client resolution', () => {
  it('returns local attachments without a request', async () => {
    const local = projected({ content: 'AAAA' })
    await expect(resolveAttachmentPayload(local)).resolves.toBe(local)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('materializes content and extracted text from the asset endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'BBBB', preview: 'BBBB', extractedText: 'hello' }),
    })

    const resolved = await resolveAttachmentPayload(projected())
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s/attachments/image_1', { credentials: 'same-origin' })
    expect(resolved).toMatchObject({ content: 'BBBB', extractedText: 'hello' })
  })

  it('rejects a failed fetch', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    await expect(resolveAttachmentPayload(projected())).rejects.toThrow('HTTP 404')
  })

  it('resolves every attachment in a draft', async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => ({ content: url.endsWith('a') ? 'AAAA' : 'BBBB' }),
    }))

    const resolved = await resolveAttachmentsForDraft([
      projected({ id: 'a', assetUrl: '/attachments/a' }),
      projected({ id: 'b', assetUrl: '/attachments/b' }),
    ])
    expect(resolved?.map((attachment) => attachment.content)).toEqual(['AAAA', 'BBBB'])
  })

  it('rehydrates only user-with-attachments messages for upload', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: 'CCCC' }) })
    const assistant = { role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: 1 } as never
    const user = {
      role: 'user-with-attachments',
      content: 'look',
      timestamp: 2,
      attachments: [projected()],
    } as never

    const resolved = await resolveMessagesForUpload([assistant, user])
    expect(resolved[0]).toBe(assistant)
    expect((resolved[1] as { attachments: Attachment[] }).attachments[0].content).toBe('CCCC')
  })
})
