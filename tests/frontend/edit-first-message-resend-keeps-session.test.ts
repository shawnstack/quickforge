import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { useChatActions } from '../../src/hooks/useChatActions'

/**
 * 回归：就地编辑「第一条」消息后直接重发时，必须留在当前会话。
 *
 * 旧实现里截断后为空 → `shouldSaveSession` 为 false → 删旧会话 + createAgent
 * 新 session（attachToView 会 replaceState 写入 ?session=），用户看到的是
 * 「跳回新对话页」，紧接着的新文案也发到了那个新会话里。
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
    rollback: vi.fn(async () => ({ session: { messages: options.rolledBackMessages } })),
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
  const setCurrentAgentMessages = vi.fn()
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
    setCurrentAgentMessages,
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
    setCurrentAgentMessages,
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
    expect(harness.setCurrentAgentMessages).toHaveBeenCalledWith([])
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

  it('keeps the legacy "reset to a new chat" behaviour for plain rollback', async () => {
    const harness = useChatActionsHarness({
      messages: [userMessage('hello'), assistantMessage('hi')],
      rolledBackMessages: [],
    })

    await harness.actions.rollbackFromMessage(0)

    expect(harness.deleteSession).toHaveBeenCalledWith(SESSION_ID)
    expect(harness.refreshSessions).toHaveBeenCalled()
    expect(harness.createAgent).toHaveBeenCalledTimes(1)
    const [, , createOptions] = harness.createAgent.mock.calls[0] as unknown as [unknown, string, { attachToView?: boolean }]
    expect(createOptions.attachToView).toBe(true)
    expect(harness.setRestoredDraft).toHaveBeenCalled()
  })
})
