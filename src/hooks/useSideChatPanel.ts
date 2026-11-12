import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Api, Model } from '@earendil-works/pi-ai'
import { SideChatAgent } from '@/components/workspace/side-chat-agent'
import { buildConnectionModel, DEFAULT_CONNECTION } from '@/lib/pi-chat'

/** Workspace Inspector 内侧聊（side chat）的宿主状态（原 MainApp 内联块）。
 *
 *  侧聊是独立的轻量 agent：上下文（sessionId / model）跟随当前会话，
 *  会话切换时清空草稿与历史并 bump revision 让 Inspector 里的视图重挂载。
 *  输入草稿刻意放在宿主（而非 Inspector）——Inspector 卸载重建时草稿不丢。
 */
export function useSideChatPanel(context: {
  agent: { state: { model?: Model<Api> } } | null | undefined
  chatPanelRevision: number
  currentSessionId: string | undefined
  runtimeScopeId: string
  activeModelRef: RefObject<Model<Api>>
}) {
  const { agent, chatPanelRevision, currentSessionId, runtimeScopeId, activeModelRef } = context

  const sideChatRuntimeScopeRef = useRef(runtimeScopeId)
  const [sideChatAgent] = useState(() => new SideChatAgent({ model: buildConnectionModel(DEFAULT_CONNECTION) }))
  const [sideChatRevision, setSideChatRevision] = useState(0)
  const bumpSideChatRevision = useCallback(() => setSideChatRevision((value) => value + 1), [])
  const sideChatDraftRef = useRef('')
  const sideChatInputMemory = useMemo(() => ({
    get: () => sideChatDraftRef.current,
    set: (text: string) => {
      sideChatDraftRef.current = text
    },
  }), [])

  const clearSideChat = useCallback(() => {
    sideChatAgent.reset()
    sideChatDraftRef.current = ''
    bumpSideChatRevision()
  }, [bumpSideChatRevision, sideChatAgent])

  useEffect(() => () => sideChatAgent.abort(), [sideChatAgent])

  useEffect(() => {
    if (sideChatRuntimeScopeRef.current === runtimeScopeId) return undefined
    sideChatRuntimeScopeRef.current = runtimeScopeId
    const timer = window.setTimeout(() => {
      clearSideChat()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [clearSideChat, runtimeScopeId])

  useEffect(() => {
    const model = agent?.state.model ?? activeModelRef.current
    sideChatAgent.setContext({ sessionId: currentSessionId, model })
  }, [activeModelRef, agent, chatPanelRevision, currentSessionId, sideChatAgent])

  return {
    sideChatAgent,
    sideChatInputMemory,
    sideChatRevision,
    clearSideChat,
  }
}
