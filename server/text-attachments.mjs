import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { cacheDir, ensureStorage } from './storage.mjs'

export const textAttachmentsDir = path.join(cacheDir, 'global', 'tmp', 'conversations')
export const MAX_TEXT_ATTACHMENT_CHARS = 2_000_000

function safeSegment(value, fallback) {
  const normalized = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120)
  return normalized || fallback
}

export function textAttachmentPath(sessionId, fileName) {
  const sessionDir = path.join(textAttachmentsDir, safeSegment(sessionId, 'session'))
  const baseName = safeSegment(path.basename(fileName, path.extname(fileName)), 'pasted-content')
  const name = `${baseName}.txt`
  return path.join(sessionDir, name)
}

export function isTextAttachmentPath(filePath) {
  const root = path.resolve(textAttachmentsDir) + path.sep
  const resolved = path.resolve(String(filePath ?? ''))
  return resolved.startsWith(root) && path.extname(resolved).toLowerCase() === '.txt'
}

export async function createTextAttachment({ sessionId, text, fileName }) {
  const content = String(text ?? '')
  if (!content) throw Object.assign(new Error('Text attachment cannot be empty'), { statusCode: 400 })
  if (content.length > MAX_TEXT_ATTACHMENT_CHARS) throw Object.assign(new Error('Text attachment is too large'), { statusCode: 413 })
  await ensureStorage()
  const baseName = safeSegment(fileName || `pasted-content-${new Date().toISOString().slice(0, 10)}`, 'pasted-content')
  const filePath = textAttachmentPath(`${sessionId}-${randomUUID().slice(0, 8)}`, baseName)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  return {
    id: `text-${randomUUID()}`,
    type: 'document',
    fileName: path.basename(filePath),
    mimeType: 'text/plain',
    size: Buffer.byteLength(content, 'utf8'),
    characterCount: content.length,
    path: filePath,
    source: 'clipboard',
  }
}

export async function readTextAttachment(filePath) {
  if (!isTextAttachmentPath(filePath)) throw new Error('Invalid text attachment path')
  return fs.readFile(filePath, 'utf8')
}

export function isSessionTextAttachmentPath(sessionId, filePath) {
  const sessionRoot = path.resolve(textAttachmentsDir, safeSegment(sessionId, 'session')) + path.sep
  const resolved = path.resolve(String(filePath ?? ''))
  return isTextAttachmentPath(resolved) && resolved.startsWith(sessionRoot)
}
