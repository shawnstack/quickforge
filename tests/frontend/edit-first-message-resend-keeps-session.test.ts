import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { useChatActions } from '../../src/hooks/useChatActions'

/**
 * 回归：回滚必须留在当前会话，不论入口是「就地编辑后重发」还是「回滚填回输入框」。
 *
 * 旧实现里截断后为空 → `shouldSaveSession` 为 false → 删旧会话 + createAgent
 * 新 session（attachToView 会 replaceState 写入 ?session=），用户看到的是
 * 「跳回新对话页」；在 global scope 下还会进一步触发「空态自动切项目会话」。
 * 现在 project / global 两种 scope 都保留原会话，行为一致。
 */
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
}))
vi.mock('@/lib/pi-chat', () => ({ initializePiStorage: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showAlert: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

const SESSION_ID = 'sess-1'

function userMessage(text: string) {
  return { role: 'user' as const, content: text, timestamp: 0 }
}

function assistantMessage(text: string) {
  return { role: 'assistant' as const, content: [{ type: 'text' as const, text }], timestamp: 1 }
}

function useChatActionsHarness(options: { messages: unknown[]; rolledBackMessages: unknown[] }) {
  const agent = {
    sessionId: SESSION_ID,
    state: {
      messages: options.messages,
      isStreaming: false,
      model: { provider: 'custom', id: 'test-model' } as Model<Api>,
      thinkingLevel: 'off' as const,
    },
    // 与真实 ServerAgent 一致：回滚接口返回的全量历史由 agent 自己采纳，
    // hook 层不再写消息数组。
    rollback: vi.fn(async () => {
      agent.state.messages = options.rolledBackMessages
      return { session: { messages: options.rolledBackMessages } }
    }),
    trimTrailingMessages: vi.fn((keepCount: number) => {
      agent.state.messages = agent.state.messages.slice(0, keepCount)
    }),
    dispose: vi.fn(),
  }
  const task = {
    sessionId: SESSION_ID,
    agent,
    title: 'hello',
    scope: 'global' as const,
    unsubscribe: vi.fn(),
  }
  const deleteSession = vi.fn(async () => {})
  const createAgent = vi.fn(async () => agent)
  const refreshSessions = vi.fn(async () => {})
  const syncSessionUI = vi.fn(async () => {})
  const setChatPanelRevision = vi.fn()
  const setRestoredDraft = vi.fn()

  const actions = useChatActions({
    storageRef: { current: { sessions: { delete: deleteSession } } },
    activeModelRef: { current: { provider: 'custom', id: 'test-model' } },
    activeProjectRef: { current: undefined },
    currentChatScopeRef: { current: 'global' },
    currentSessionIdRef: { current: SESSION_ID },
    taskMapRef: { current: new Map([[SESSION_ID, task]]) },
    agentRef: { current: agent },
    startDeferredSession: vi.fn(async () => {}),
    createAgent,
    syncSessionUI,
    setChatPanelRevision,
    refreshSessions,
    needsModelSetup: false,
    setNeedsModelSetup: vi.fn(),
    switchActiveProject: vi.fn(),
    closeWorkspacePage: vi.fn(),
    setRestoredDraft,
  } as unknown as Parameters<typeof useChatActions>[0])

  return {
    actions,
    agent,
    task,
    deleteSession,
    createAgent,
    refreshSessions,
    syncSessionUI,
    setChatPanelRevision,
    setRestoredDraft,
  }
}

describe('edit-and-resend on the first message', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { href: `http://localhost/?session=${SESSION_ID}` },
      history: { replaceState: vi.fn() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the current session instead of deleting it and creating a new one', async () => {
    const harness = useChatActionsHarness({
      messages: [userMessage('hello'), assistantMessage('hi'), userMessage('next'), assistantMessage('ok')],
      rolledBackMessages: [],
    })

    const rolledBack = await harness.actions.rollbackForResend(0)

    expect(rolledBack).toBe(true)
    expect(harness.agent.rollback).toHaveBeenCalledWith(0)
    // 消息数组由 agent 采纳回滚结果（hook 不再直写），这里是采纳后的空历史
    expect(harness.agent.state.messages).toEqual([])
    // 关键断言：不删旧会话、不新建 agent、不写新的 ?session=
    expect(harness.deleteSession).not.toHaveBeenCalled()
    expect(harness.createAgent).not.toHaveBeenCalled()
    expect(harness.refreshSessions).not.toHaveBeenCalled()
    expect(window.history.replaceState).not.toHaveBeenCalled()
    // 仍然要刷新面板与列表状态
    expect(harness.setChatPanelRevision).toHaveBeenCalled()
    expect(harness.syncSessionUI).toHaveBeenCalledWith(harness.task)
    // 就地编辑不写回 draft（新文案由 composer 直接发）
    expect(harness.setRestoredDraft).not.toHaveBeenCalled()
  })

  it('still resyncs the panel when the rolled back session keeps messages', async () => {
    const harness = useChatActionsHarness({
      messages: [userMessage('hello'), assistantMessage('hi'), userMessage('next'), assistantMessage('ok')],
      rolledBackMessages: [userMessage('hello'), assistantMessage('hi')],
    })

    const rolledBack = await harness.actions.rollbackForResend(2)

    expect(rolledBack).toBe(true)
    expect(harness.deleteSession).not.toHaveBeenCalled()
    expect(harness.createAgent).not.toHaveBeenCalled()
    expect(harness.syncSessionUI).toHaveBeenCalledWith(harness.task)
  })

  it('keeps the current session for plain rollback as well (no delete + recreate)', async () => {
    const harness = useChatActionsHarness({
      messages: [userMessage('hello'), assistantMessage('hi')],
      rolledBackMessages: [],
    })

    await harness.actions.rollbackFromMessage(0)

    // 会话原地保留：不删旧会话、不新建 agent、不写新的 ?session=、不触发列表刷新。
    expect(harness.deleteSession).not.toHaveBeenCalled()
    expect(harness.createAgent).not.toHaveBeenCalled()
    expect(harness.refreshSessions).not.toHaveBeenCalled()
    expect(window.history.replaceState).not.toHaveBeenCalled()
    // 原文案回填输入框，且仍指向原会话。
    expect(harness.setRestoredDraft).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, text: 'hello' }),
    )
    expect(harness.agent.state.messages).toEqual([])
    expect(harness.setChatPanelRevision).toHaveBeenCalled()
  })
})
