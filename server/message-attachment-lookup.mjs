import { getSessionState } from './agent-manager.mjs'
import { findSessionAttachmentRecord } from './session-state-service.mjs'

function findAttachmentInMessages(messages, attachmentId) {
  if (!Array.isArray(messages)) return null
  for (const message of messages) {
    if (!Array.isArray(message?.attachments)) continue
    const attachment = message.attachments.find((candidate) => candidate && candidate.id === attachmentId)
    if (attachment) return attachment
  }
  return null
}

/**
 * Resolve a stored attachment by id.
 *
 * Hot sessions keep their full messages in memory, so this is a linear scan
 * over the active transcript; cold sessions fall back to the storage service's
 * row scan. Callers only pass ids that appeared in a projected message, so a
 * miss is a genuine 404.
 */
export async function findSessionAttachment(sessionId, attachmentId) {
  if (typeof sessionId !== 'string' || !sessionId || typeof attachmentId !== 'string' || !attachmentId) return null
  const state = getSessionState(sessionId)
  const attachment = findAttachmentInMessages(state?.messages, attachmentId)
  if (attachment) return attachment
  return findSessionAttachmentRecord(sessionId, attachmentId)
}
