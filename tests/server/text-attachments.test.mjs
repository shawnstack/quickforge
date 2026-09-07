import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTextAttachment, isTextAttachmentPath, readTextAttachment } from '../../server/text-attachments.mjs'

describe('text attachments', () => {
  it('writes clipboard text into the qf temporary directory and reads it back', async () => {
    const attachment = await createTextAttachment({ sessionId: 'session/demo', text: '你好\nworld', fileName: 'pasted-content.txt' })
    expect(attachment.type).toBe('document')
    expect(attachment.mimeType).toBe('text/plain')
    expect(attachment.characterCount).toBe(8)
    expect(isTextAttachmentPath(attachment.path)).toBe(true)
    await expect(readTextAttachment(attachment.path)).resolves.toBe('你好\nworld')
    await fs.rm(path.dirname(attachment.path), { recursive: true, force: true })
  })

  it('rejects paths outside the temporary attachment root', async () => {
    expect(isTextAttachmentPath(path.join(os.tmpdir(), 'not-qf-attachment.txt'))).toBe(false)
    await expect(readTextAttachment(path.join(os.tmpdir(), 'not-qf-attachment.txt'))).rejects.toThrow('Invalid text attachment path')
  })
})
