import { memo } from 'react'
import type { Attachment, UserMessage as UserMessageType, UserMessageWithAttachments } from './ChatTypes'
import { MarkdownBlock } from './Markdown'
import { AttachmentTile } from './AttachmentTile'

/**
 * React replacement for the legacy `<user-message>` custom element.
 * Right-aligned user bubble (see `.qf-user-message > .user-message-container`
 * in `src/index.css`) with markdown content and attachment thumbnails.
 */

type UserMessageProps = {
  message: UserMessageWithAttachments | UserMessageType
}

// Memoized: finished user rows only change when their message object is
// replaced (the agent never mutates published messages in place), so reusing
// the snapshot's message identity (R1 F1a) lets every other row bail out
// while one message streams.
export const UserMessage = memo(function UserMessage({ message }: UserMessageProps) {
  const content =
    typeof message.content === 'string'
      ? message.content
      : message.content.find((chunk) => chunk.type === 'text')?.text || ''

  const attachments: Attachment[] =
    message.role === 'user-with-attachments' && message.attachments && message.attachments.length > 0
      ? message.attachments
      : []

  return (
    <div className="qf-user-message flex justify-start mx-4">
      {/* `qf-user-message-bubble` has no CSS rule and no production querySelector:
          it is a test/style hook class (tests/frontend/message-actions.test.ts
          queries it) — keep it when refactoring the bubble markup. */}
      <div className="user-message-container qf-user-message-bubble rounded-xl px-4 py-2">
        <MarkdownBlock content={content} />
        {attachments.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentTile key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
})
