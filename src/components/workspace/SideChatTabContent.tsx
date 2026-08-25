import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { ChatConversationSurface } from '@/components/chat/ChatConversationSurface'
import { copyTextToClipboard } from '@/lib/message-utils'
import type { SideChatAgent } from './side-chat-agent'

export type SideChatComposerDraftMemory = {
  get: () => string
  set: (text: string) => void
}

export type SideChatTabContentProps = {
  agent: SideChatAgent
  inputMemory: SideChatComposerDraftMemory
  revision: number
}

const noop = () => {}
const copyAnswer = (text: string) => copyTextToClipboard(text)

export function SideChatTabContent({ agent, inputMemory, revision }: SideChatTabContentProps) {
  return (
    <ChatConversationSurface>
      <ChatPanelHost
        mode="side-chat"
        agent={agent}
        sideChatInputMemory={inputMemory}
        revision={revision}
        agentAccessMode="default"
        workspaceToolsEnabled={false}
        onAccessModeChange={noop}
        onRollbackFromMessage={noop}
        onRetryFromMessage={noop}
        onCopyAnswer={copyAnswer}
        onForkFromMessage={noop}
        onApproveToolCall={noop}
        onRejectToolCall={noop}
        newChatEmptyState={false}
      />
    </ChatConversationSurface>
  )
}
