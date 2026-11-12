import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectInfo, SkillsScope } from '@/lib/types'
import type { SettingsInitialTab } from '@/lib/settings-tab-definitions'
import type { WorkspaceInspectorOpenRequest } from '@/components/workspace/workspace-types'
import type { ArtifactKind } from '@/components/workspace/artifact-preview-utils'

export type ConversationViewScope = { scopeId: string; view: 'chat' | 'trace' }
export type SkillsDialogRequest = { scope: SkillsScope; project?: ProjectInfo }
/** 工具卡片预览请求的 kind（与 artifactPreviewMode 的入参一致）。 */
export type ArtifactPreviewKind = ArtifactKind

interface UIStore {
  sidebarOpen: boolean
  mobileSidebarOpen: boolean
  /** 左侧栏实测宽度（ChatSidebar 经 ResizeObserver 上报的影子值的唯一权威源）。 */
  sidebarWidth: number
  projectsCollapsed: boolean
  pinnedCollapsed: boolean
  conversationsCollapsed: boolean
  skillsDialog: SkillsDialogRequest | undefined
  shareDialogOpen: boolean
  conversationMenuOpen: boolean
  workspaceInspectorRequest: WorkspaceInspectorOpenRequest | undefined
  /** 工作区检查器的「打开者」scope（在哪个 runtimeScope 里打开的）；派生 open = scopeId 与当前 scope 相等。 */
  workspaceInspectorOpenScopeId: string | null
  artifactPreviewOpen: boolean
  activeArtifactPath: string | undefined
  firstUseGuideDismissed: boolean
  settingsDialogOpen: boolean
  settingsInitialTab: SettingsInitialTab
  settingsCustomProvider: string | undefined
  conversationViewScope: ConversationViewScope | null
  /** Bot 模式：侧栏切成 bot 列表，新建按钮变成「创建 bot」。 */
  botMode: boolean

  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>
  setSidebarWidth: Dispatch<SetStateAction<number>>
  setProjectsCollapsed: Dispatch<SetStateAction<boolean>>
  setPinnedCollapsed: Dispatch<SetStateAction<boolean>>
  setConversationsCollapsed: Dispatch<SetStateAction<boolean>>
  setSkillsDialog: Dispatch<SetStateAction<SkillsDialogRequest | undefined>>
  setShareDialogOpen: Dispatch<SetStateAction<boolean>>
  setConversationMenuOpen: Dispatch<SetStateAction<boolean>>
  setWorkspaceInspectorRequest: Dispatch<SetStateAction<WorkspaceInspectorOpenRequest | undefined>>
  setWorkspaceInspectorOpenScopeId: Dispatch<SetStateAction<string | null>>
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
  setActiveArtifactPath: Dispatch<SetStateAction<string | undefined>>
  setFirstUseGuideDismissed: Dispatch<SetStateAction<boolean>>
  setSettingsDialogOpen: Dispatch<SetStateAction<boolean>>
  setSettingsInitialTab: Dispatch<SetStateAction<SettingsInitialTab>>
  setSettingsCustomProvider: Dispatch<SetStateAction<string | undefined>>
  setConversationViewScope: Dispatch<SetStateAction<ConversationViewScope | null>>
  setBotMode: Dispatch<SetStateAction<boolean>>

  toggleProjectsCollapsed: () => void
  togglePinnedCollapsed: () => void
  toggleConversationsCollapsed: () => void

  /**
   * 树外 / 模块级代码（tab 工厂、tool-renderer、OS 通知回调）向 React 侧
   * 发起的请求信号，替代原 window CustomEvent 桥。
   * nonce 保证相同 payload 的重复请求也能触发订阅方 effect。
   */
  settingsTabRequest: { tab: SettingsInitialTab; nonce: number } | null
  requestSettingsTab: (tab: SettingsInitialTab) => void
  clearSettingsTabRequest: () => void

  artifactPreviewRequest: { path: string; kind?: ArtifactPreviewKind; nonce: number } | null
  requestArtifactPreview: (path: string, kind?: ArtifactPreviewKind) => void
  clearArtifactPreviewRequest: () => void

  openSessionRequest: { sessionId: string; nonce: number; skipMetadataPrecheck?: boolean } | null
  /** skipMetadataPrecheck：打开一个还没落盘的空会话（bot 的会话在第一次发言前就是这样）。 */
  requestOpenSession: (sessionId: string, options?: { skipMetadataPrecheck?: boolean }) => void
  clearOpenSessionRequest: () => void
}

let requestNonce = 0

/** App 级纯 UI 状态的单一数据源（侧栏/对话框/overlay/inspector/视图切换）。
 *
 *  setter 与 useState 的 Dispatch<SetStateAction<T>> 签名兼容（支持函数式更新），
 *  action 引用恒定；React 侧经 `useUIState()` 兼容层或 selector 订阅消费，
 *  非 React 代码直接 `useUIStore.getState().xxx`。
 */
export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  mobileSidebarOpen: false,
  sidebarWidth: 320,
  projectsCollapsed: false,
  pinnedCollapsed: false,
  conversationsCollapsed: false,
  skillsDialog: undefined,
  shareDialogOpen: false,
  conversationMenuOpen: false,
  workspaceInspectorRequest: undefined,
  workspaceInspectorOpenScopeId: null,
  artifactPreviewOpen: false,
  activeArtifactPath: undefined,
  firstUseGuideDismissed: false,
  settingsDialogOpen: false,
  settingsInitialTab: 'defaults',
  settingsCustomProvider: undefined,
  conversationViewScope: null,
  botMode: false,

  setSidebarOpen: (value) =>
    set((s) => ({ sidebarOpen: typeof value === 'function' ? value(s.sidebarOpen) : value })),
  setMobileSidebarOpen: (value) =>
    set((s) => ({ mobileSidebarOpen: typeof value === 'function' ? value(s.mobileSidebarOpen) : value })),
  setSidebarWidth: (value) =>
    set((s) => ({ sidebarWidth: typeof value === 'function' ? value(s.sidebarWidth) : value })),
  setProjectsCollapsed: (value) =>
    set((s) => ({ projectsCollapsed: typeof value === 'function' ? value(s.projectsCollapsed) : value })),
  setPinnedCollapsed: (value) =>
    set((s) => ({ pinnedCollapsed: typeof value === 'function' ? value(s.pinnedCollapsed) : value })),
  setConversationsCollapsed: (value) =>
    set((s) => ({ conversationsCollapsed: typeof value === 'function' ? value(s.conversationsCollapsed) : value })),
  setSkillsDialog: (value) =>
    set((s) => ({ skillsDialog: typeof value === 'function' ? value(s.skillsDialog) : value })),
  setShareDialogOpen: (value) =>
    set((s) => ({ shareDialogOpen: typeof value === 'function' ? value(s.shareDialogOpen) : value })),
  setConversationMenuOpen: (value) =>
    set((s) => ({ conversationMenuOpen: typeof value === 'function' ? value(s.conversationMenuOpen) : value })),
  setWorkspaceInspectorRequest: (value) =>
    set((s) => ({
      workspaceInspectorRequest:
        typeof value === 'function' ? value(s.workspaceInspectorRequest) : value,
    })),
  setWorkspaceInspectorOpenScopeId: (value) =>
    set((s) => ({
      workspaceInspectorOpenScopeId:
        typeof value === 'function' ? value(s.workspaceInspectorOpenScopeId) : value,
    })),
  setArtifactPreviewOpen: (value) =>
    set((s) => ({ artifactPreviewOpen: typeof value === 'function' ? value(s.artifactPreviewOpen) : value })),
  setActiveArtifactPath: (value) =>
    set((s) => ({ activeArtifactPath: typeof value === 'function' ? value(s.activeArtifactPath) : value })),
  setFirstUseGuideDismissed: (value) =>
    set((s) => ({ firstUseGuideDismissed: typeof value === 'function' ? value(s.firstUseGuideDismissed) : value })),
  setSettingsDialogOpen: (value) =>
    set((s) => ({ settingsDialogOpen: typeof value === 'function' ? value(s.settingsDialogOpen) : value })),
  setSettingsInitialTab: (value) =>
    set((s) => ({ settingsInitialTab: typeof value === 'function' ? value(s.settingsInitialTab) : value })),
  setSettingsCustomProvider: (value) =>
    set((s) => ({ settingsCustomProvider: typeof value === 'function' ? value(s.settingsCustomProvider) : value })),
  setConversationViewScope: (value) =>
    set((s) => ({ conversationViewScope: typeof value === 'function' ? value(s.conversationViewScope) : value })),
  setBotMode: (value) =>
    set((s) => ({ botMode: typeof value === 'function' ? value(s.botMode) : value })),

  toggleProjectsCollapsed: () => set((s) => ({ projectsCollapsed: !s.projectsCollapsed })),
  togglePinnedCollapsed: () => set((s) => ({ pinnedCollapsed: !s.pinnedCollapsed })),
  toggleConversationsCollapsed: () => set((s) => ({ conversationsCollapsed: !s.conversationsCollapsed })),

  settingsTabRequest: null,
  requestSettingsTab: (tab) => set({ settingsTabRequest: { tab, nonce: ++requestNonce } }),
  clearSettingsTabRequest: () => set({ settingsTabRequest: null }),

  artifactPreviewRequest: null,
  requestArtifactPreview: (path, kind) =>
    set({ artifactPreviewRequest: { path, kind, nonce: ++requestNonce } }),
  clearArtifactPreviewRequest: () => set({ artifactPreviewRequest: null }),

  openSessionRequest: null,
  requestOpenSession: (sessionId, options) =>
    set({
      openSessionRequest: {
        sessionId,
        nonce: ++requestNonce,
        skipMetadataPrecheck: options?.skipMetadataPrecheck === true,
      },
    }),
  clearOpenSessionRequest: () => set({ openSessionRequest: null }),
}))
