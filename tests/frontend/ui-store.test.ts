import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../src/stores/ui-store'

const INITIAL_UI = {
  sidebarOpen: true,
  mobileSidebarOpen: false,
  projectsCollapsed: false,
  pinnedCollapsed: false,
  conversationsCollapsed: false,
  skillsDialog: undefined,
  shareDialogOpen: false,
  conversationMenuOpen: false,
  workspaceInspectorRequest: undefined,
  artifactPreviewOpen: false,
  activeArtifactPath: undefined,
  firstUseGuideDismissed: false,
  settingsDialogOpen: false,
  settingsInitialTab: 'defaults' as const,
  settingsCustomProvider: undefined,
  conversationViewScope: null,
  settingsTabRequest: null,
  artifactPreviewRequest: null,
  openSessionRequest: null,
}

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState(INITIAL_UI)
  })

  it('boolean setter 兼容 useState 的直接值与函数式更新', () => {
    const store = useUIStore.getState()
    store.setSidebarOpen(false)
    expect(useUIStore.getState().sidebarOpen).toBe(false)
    store.setConversationMenuOpen((v) => !v)
    expect(useUIStore.getState().conversationMenuOpen).toBe(true)
  })

  it('workspaceInspectorRequest 支持函数式更新（复用当前请求生成新请求）', () => {
    useUIStore.getState().setWorkspaceInspectorRequest({ id: 1 } as never)
    useUIStore.getState().setWorkspaceInspectorRequest((current) => ({ ...current!, scope: 'project' } as never))
    expect(useUIStore.getState().workspaceInspectorRequest).toMatchObject({ id: 1, scope: 'project' })
    useUIStore.getState().setWorkspaceInspectorRequest(undefined)
    expect(useUIStore.getState().workspaceInspectorRequest).toBeUndefined()
  })

  it('toggle 动作翻转折叠状态', () => {
    useUIStore.getState().toggleProjectsCollapsed()
    expect(useUIStore.getState().projectsCollapsed).toBe(true)
    useUIStore.getState().togglePinnedCollapsed()
    expect(useUIStore.getState().pinnedCollapsed).toBe(true)
    useUIStore.getState().toggleConversationsCollapsed()
    expect(useUIStore.getState().conversationsCollapsed).toBe(true)
  })

  it('请求信号：request 写入带递增 nonce 的信号，clear 清除', () => {
    useUIStore.getState().requestSettingsTab('dreaming')
    const first = useUIStore.getState().settingsTabRequest
    expect(first).toMatchObject({ tab: 'dreaming' })

    // 相同 payload 重复请求也能通过 nonce 变化触发订阅方。
    useUIStore.getState().requestSettingsTab('dreaming')
    const second = useUIStore.getState().settingsTabRequest
    expect(second).not.toBe(first)
    expect(second!.nonce).toBeGreaterThan(first!.nonce)

    useUIStore.getState().clearSettingsTabRequest()
    expect(useUIStore.getState().settingsTabRequest).toBeNull()
  })

  it('artifactPreview / openSession 请求信号语义一致', () => {
    useUIStore.getState().requestArtifactPreview('docs/guide.md', 'markdown')
    expect(useUIStore.getState().artifactPreviewRequest).toMatchObject({ path: 'docs/guide.md', kind: 'markdown' })
    useUIStore.getState().clearArtifactPreviewRequest()
    expect(useUIStore.getState().artifactPreviewRequest).toBeNull()

    useUIStore.getState().requestOpenSession('session-1')
    expect(useUIStore.getState().openSessionRequest).toMatchObject({ sessionId: 'session-1' })
    useUIStore.getState().clearOpenSessionRequest()
    expect(useUIStore.getState().openSessionRequest).toBeNull()
  })

  it('action 引用恒定，非 React 代码可经 getState() 直接调用', () => {
    const { setSidebarOpen, requestSettingsTab } = useUIStore.getState()
    setSidebarOpen(false)
    requestSettingsTab('about')
    const next = useUIStore.getState()
    expect(next.setSidebarOpen).toBe(setSidebarOpen)
    expect(next.requestSettingsTab).toBe(requestSettingsTab)
  })
})
