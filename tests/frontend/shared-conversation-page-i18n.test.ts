import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

// SharedConversationPage 的错误兜底必须走 i18n：非 Error 的 reject 存键（渲染侧现取译文），
// Error.message 存服务端原文（恒定、不翻译）。形态与 ShareConversationDialog 的
// `{kind:'message'|'key'}` 判别联合同族（e71b6c38）。
// 先红断言：unlock 与 rollback 的兜底文案必须跟随语言切换——改造前它们是硬编码英文
// 常量，语言切到 zh 后断言必红。
const harness = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0 }))
const shareClient = vi.hoisted(() => ({
  unlockSharedConversation: vi.fn(),
  loadSharedConversationMeta: vi.fn(),
  loadSharedModelProviders: vi.fn(),
}))
const shared = vi.hoisted(() => {
  const agent = {
    permission: 'operate' as const,
    sessionId: 'sid',
    state: { permission: 'operate', messages: [{ role: 'user', content: 'hi' }], isStreaming: false },
    rollback: vi.fn(),
    dispose: vi.fn(),
  }
  // function 实现：vi.fn(() => agent) 被 new 时 vitest 警告且不保证返回 agent，
  // 构造函数返回对象才会替换实例（createAgentFromState 的 new SharedServerAgent 依赖这点）。
  const Ctor = Object.assign(vi.fn(function SharedServerAgent() { return agent }), { loadState: vi.fn() })
  return { agent, Ctor }
})

vi.mock('react', () => ({
  useEffect: () => undefined,
  useRef: (initial: unknown) => {
    const index = harness.refCursor++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useCallback: <T>(fn: T) => fn,
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value }]
  },
}))
vi.mock('lucide-react', () => ({ AlertTriangle: () => null, Copy: () => null }))
vi.mock('@/storage', () => ({
  AppStorage: class {},
  CustomProvidersStore: class { setBackend() {} },
  ProviderKeysStore: class { setBackend() {} },
  SessionsStore: class { setBackend() {} },
  SettingsStore: class { setBackend() {} },
  setAppStorage: vi.fn(),
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ showAlert: vi.fn() }))
vi.mock('@/components/ui/button', () => ({ Button: (props: unknown) => ({ type: 'Button', props }) }))
vi.mock('@/components/chat/ChatPanelHost', () => ({ ChatPanelHost: (props: unknown) => ({ type: 'ChatPanelHost', props }) }))
vi.mock('@/lib/http-storage-backend', () => ({ HttpStorageBackend: class {} }))
vi.mock('@/components/chat/surface/attachment-client', () => ({ resolveAttachmentsForDraft: vi.fn(async (attachments: unknown) => attachments) }))
vi.mock('@/lib/share-client', () => ({ ...shareClient }))
vi.mock('@/lib/pi-chat', () => ({ defaultThinkingLevelForModel: () => 'off' }))
vi.mock('@/lib/model-visibility', () => ({ filterSelectableModels: (models: unknown) => models }))
vi.mock('@/lib/model-identity', () => ({ includeCurrentModel: (models: unknown) => models }))
vi.mock('@/lib/custom-model-selector', () => ({ openCustomOnlyModelSelector: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/shared-server-agent', () => ({ SharedServerAgent: shared.Ctor }))

// @/lib/i18n 故意不 mock：真实的 t()/applyAppLanguageFromSnapshot 正是被测契约。
import { SharedConversationPage } from '../../src/components/share/SharedConversationPage'
import { Button } from '@/components/ui/button'
import { ChatPanelHost } from '@/components/chat/ChatPanelHost'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'

type Node = ReactElement<{ children?: unknown; className?: string; type?: unknown; onClick?: () => void; [key: string]: unknown }>
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as Node
  return [node, ...nodes(node.props.children)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : ''
}
function render() {
  harness.cursor = 0
  harness.refCursor = 0
  return nodes(SharedConversationPage({ shareId: 'share-1' }))
}
function errorText() {
  const node = render().find((item) => typeof item.props.className === 'string' && item.props.className.includes('text-destructive'))
  return node ? text(node) : ''
}
async function clickUnlock() {
  const button = render().find((node) => node.type === Button)
  const onClick = button?.props.onClick as (() => void) | undefined
  if (!onClick) throw new Error('unlock button missing')
  onClick()
}
async function unlockExpectingFailure() {
  await clickUnlock()
  await vi.waitFor(() => expect(errorText()).not.toBe(''))
}
async function unlockExpectingSuccess() {
  await clickUnlock()
  await vi.waitFor(() => {
    if (!render().some((node) => node.type === ChatPanelHost)) throw new Error('ChatPanelHost not rendered yet')
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  harness.states = []
  harness.refs = []
  applyAppLanguageFromSnapshot('en')
})
afterEach(() => {
  applyAppLanguageFromSnapshot('en')
})

describe('SharedConversationPage error fallbacks follow i18n', () => {
  it('unlock fallback switches with the language instead of hardcoded English', async () => {
    // 非 Error 的 reject 必须走键分支：译文跟语言走。
    shareClient.unlockSharedConversation.mockRejectedValue('boom-not-an-error')
    await unlockExpectingFailure()
    expect(errorText()).toBe('Failed to unlock shared conversation')
    applyAppLanguageFromSnapshot('zh')
    expect(errorText()).toBe('解锁分享对话失败。')
  })

  it('rollback fallback switches with the language (reuses rollbackFailed)', async () => {
    shareClient.unlockSharedConversation.mockResolvedValue({ permission: 'operate', title: 'T', share: { titleSnapshot: 'TS' } })
    shared.Ctor.loadState.mockResolvedValue(shared.agent.state)
    shared.agent.rollback.mockRejectedValue('rb-not-an-error')
    await unlockExpectingSuccess()
    const panel = render().find((node) => node.type === ChatPanelHost)!
    const rollback = panel.props.onRollbackFromMessage as (index: number) => Promise<void>
    await rollback(0)
    await vi.waitFor(() => expect(errorText()).toBe('Rollback failed.'))
    applyAppLanguageFromSnapshot('zh')
    expect(errorText()).toBe('回滚失败。')
  })

  it('keeps the server-provided Error message untranslated in both languages', async () => {
    // 判别联合的另一半：err.message 是服务端原文，任何语言下都不翻译、不吃进 t()。
    shareClient.unlockSharedConversation.mockRejectedValue(new Error('server said no'))
    await unlockExpectingFailure()
    expect(errorText()).toBe('server said no')
    applyAppLanguageFromSnapshot('zh')
    expect(errorText()).toBe('server said no')
  })
})
