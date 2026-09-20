import type { AgentMessage, CustomAgentMessages } from '@earendil-works/pi-agent-core'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { ArtifactMessage, Attachment, UserMessageWithAttachments } from '../../../src/components/chat/surface/ChatTypes'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

// This file is compiled by chat-message-contract.test.ts, not merely transpiled by Vitest.
export type MessageContract = [
  Assert<Equal<Attachment, {
    id: string
    type: 'image' | 'document'
    fileName: string
    mimeType: string
    size: number
    content: string
    extractedText?: string
    preview?: string
  }>>,
  Assert<Equal<UserMessageWithAttachments, {
    role: 'user-with-attachments'
    content: string | (TextContent | ImageContent)[]
    timestamp: number
    attachments?: Attachment[]
  }>>,
  Assert<Equal<ArtifactMessage, {
    role: 'artifact'
    action: 'create' | 'update' | 'delete'
    filename: string
    content?: string
    title?: string
    timestamp: string
  }>>,
  Assert<Equal<CustomAgentMessages['artifact'], ArtifactMessage>>,
  Assert<Equal<CustomAgentMessages['user-with-attachments'], UserMessageWithAttachments>>,
  Assert<Equal<Extract<AgentMessage, { role: 'artifact' }>, ArtifactMessage>>,
  Assert<Equal<Extract<AgentMessage, { role: 'user-with-attachments' }>, UserMessageWithAttachments>>,
]
