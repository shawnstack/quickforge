/**
 * Project stored messages onto the client wire.
 *
 * Stored `user-with-attachments` messages keep the uploaded bytes inline
 * (`attachments[].content` is base64, `preview` used to be a second copy of the
 * same bytes). Shipping that to the browser makes every historical image cost
 * tens of MB of JS heap and is copied again into the IndexedDB snapshot.
 *
 * The client only needs the attachment identity: bytes are fetched on demand
 * from `/api/sessions/:id/attachments/:attachmentId` (and the share-scoped
 * equivalent). The LLM request path still reads the stored inline payload.
 *
 * A small `preview` is kept inline because it is already a thumbnail (PDF first
 * page, images downscaled by the composer); large legacy previews (the old
 * full-image duplicate) are dropped and resolved lazily by the client.
 */

export const MAX_INLINE_PREVIEW_CHARS = 128 * 1024

function projectAttachment(attachment, attachmentUrlFor) {
  if (!attachment || typeof attachment !== 'object') return attachment
  // `extractedText` can be megabytes for long documents and is only needed by
  // the overlay / draft / fork paths, all of which resolve it on demand.
  const { content: _content, extractedText: _extractedText, preview, ...rest } = attachment
  const next = { ...rest }
  if (typeof preview === 'string' && preview.length <= MAX_INLINE_PREVIEW_CHARS) {
    next.preview = preview
  }
  if (typeof attachment.id === 'string' && attachment.id) {
    next.assetUrl = attachmentUrlFor(attachment.id)
  }
  return next
}

export function projectMessageForClient(message, attachmentUrlFor) {
  if (!message || !Array.isArray(message.attachments) || message.attachments.length === 0) return message
  return {
    ...message,
    attachments: message.attachments.map((attachment) => projectAttachment(attachment, attachmentUrlFor)),
  }
}

export function projectMessagesForClient(messages, attachmentUrlFor) {
  if (!Array.isArray(messages)) return messages
  let changed = false
  const next = messages.map((message) => {
    const projected = projectMessageForClient(message, attachmentUrlFor)
    if (projected !== message) changed = true
    return projected
  })
  return changed ? next : messages
}

export function projectStateForClient(state, attachmentUrlFor) {
  if (!state || !Array.isArray(state.messages)) return state
  const messages = projectMessagesForClient(state.messages, attachmentUrlFor)
  return messages === state.messages ? state : { ...state, messages }
}

/** Project an SSE event that may carry a committed message or a tail window. */
export function projectEventForClient(event, attachmentUrlFor) {
  if (!event || typeof event !== 'object') return event
  let next = event
  if (event.message) {
    const message = projectMessageForClient(event.message, attachmentUrlFor)
    if (message !== event.message) next = { ...next, message }
  }
  if (Array.isArray(event.messages)) {
    const messages = projectMessagesForClient(event.messages, attachmentUrlFor)
    if (messages !== event.messages) next = { ...next, messages }
  }
  return next
}

export function sessionAttachmentUrlFor(sessionId) {
  return (attachmentId) => `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}`
}

export function shareAttachmentUrlFor(shareId) {
  return (attachmentId) => `/api/shared/${encodeURIComponent(shareId)}/attachments/${encodeURIComponent(attachmentId)}`
}
