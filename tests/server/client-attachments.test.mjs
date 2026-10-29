import { describe, expect, it } from 'vitest'
import {
  MAX_INLINE_PREVIEW_CHARS,
  projectEventForClient,
  projectMessagesForClient,
  projectStateForClient,
  sessionAttachmentUrlFor,
  shareAttachmentUrlFor,
} from '../../server/client-attachments.mjs'

const urlFor = sessionAttachmentUrlFor('session 1')

function attachment(overrides = {}) {
  return {
    id: 'image.png_1_0.5',
    type: 'image',
    fileName: 'image.png',
    mimeType: 'image/png',
    size: 4,
    content: 'AAAA',
    preview: 'AAAA',
    extractedText: 'extracted body',
    ...overrides,
  }
}

describe('client attachment projection', () => {
  it('strips bytes, keeps small previews and adds a scoped asset URL', () => {
    const message = { role: 'user-with-attachments', content: 'look', attachments: [attachment()] }
    const projected = projectMessagesForClient([message], urlFor)

    expect(projected[0].attachments[0]).toEqual({
      id: 'image.png_1_0.5',
      type: 'image',
      fileName: 'image.png',
      mimeType: 'image/png',
      size: 4,
      preview: 'AAAA',
      assetUrl: '/api/sessions/session%201/attachments/image.png_1_0.5',
    })
    expect(projected[0].attachments[0]).not.toHaveProperty('content')
    expect(projected[0].attachments[0]).not.toHaveProperty('extractedText')
    expect(projected[0]).not.toBe(message)
  })

  it('drops legacy full-image previews', () => {
    const large = 'x'.repeat(MAX_INLINE_PREVIEW_CHARS + 1)
    const projected = projectMessagesForClient(
      [{ role: 'user-with-attachments', content: 'look', attachments: [attachment({ preview: large })] }],
      urlFor,
    )
    expect(projected[0].attachments[0]).not.toHaveProperty('preview')
    expect(projected[0].attachments[0].assetUrl).toContain('/attachments/')
  })

  it('keeps messages without attachments by identity', () => {
    const messages = [{ role: 'user', content: 'hi' }]
    expect(projectMessagesForClient(messages, urlFor)).toBe(messages)
  })

  it('projects state and SSE events', () => {
    const message = { role: 'user-with-attachments', content: 'look', attachments: [attachment()] }
    const state = { messages: [message], stateVersion: 1 }
    const projectedState = projectStateForClient(state, urlFor)
    expect(projectedState).not.toBe(state)
    expect(projectedState.messages[0].attachments[0]).not.toHaveProperty('content')

    const event = { type: 'message_end', message, messages: [message], stateVersion: 2 }
    const projectedEvent = projectEventForClient(event, urlFor)
    expect(projectedEvent.message.attachments[0]).not.toHaveProperty('content')
    expect(projectedEvent.messages[0].attachments[0]).not.toHaveProperty('content')
    expect(projectedEvent.stateVersion).toBe(2)
  })

  it('builds share-scoped URLs', () => {
    expect(shareAttachmentUrlFor('share 1')('a b')).toBe('/api/shared/share%201/attachments/a%20b')
  })
})
