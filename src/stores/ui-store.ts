import { create } from 'zustand'
import type { Dispatch, SetStateAction } from 'react'
import type { ProjectInfo, SkillsScope } from '@/lib/types'
import type { SettingsInitialTab } from '@/lib/settings-tabs'
import type { WorkspaceInspectorOpenRequest } from '@/components/workspace/workspace-types'
import type { ArtifactKind } from '@/components/workspace/artifact-preview-utils'

export type ConversationViewScope = { scopeId: string; view: 'chat' | 'trace' }
export type SkillsDialogRequest = { scope: SkillsScope; project?: ProjectInfo }
/** 工具卡片预览请求的 kind（与 artifactPreviewMode 的入参一致）。 */
export type ArtifactPreviewKind = ArtifactKind

interface UIStore {
  sidebarOpen: boolean
  mobileSidebarOpen: boolean
  projectsCollapsed: boolean
  pinnedCollapsed: boolean
  conversationsCollapsed: boolean
  skillsDialog: SkillsDialogRequest | undefined
  shareDialogOpen: boolean
  conversationMenuOpen: boolean
  workspaceInspectorRequest: WorkspaceInspectorOpenRequest | undefined
  artifactPreviewOpen: boolean
  activeArtifactPath: string | undefined
  firstUseGuideDismissed: boolean
  settingsDialogOpen: boolean
  settingsInitialTab: SettingsInitialTab
  settingsCustomProvider: string | undefined
  conversationViewScope: ConversationViewScope | null

  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>
  setProjectsCollapsed: Dispatch<SetStateAction<boolean>>
  setPinnedCollapsed: Dispatch<SetStateAction<boolean>>
  setConversationsCollapsed: Dispatch<SetStateAction<boolean>>
  setSkillsDialog: Dispatch<SetStateAction<SkillsDialogRequest | undefined>>
  setShareDialogOpen: Dispatch<SetStateAction<boolean>>
  setConversationMenuOpen: Dispatch<SetStateAction<boolean>>
  setWorkspaceInspectorRequest: Dispatch<SetStateAction<WorkspaceInspectorOpenRequest | undefined>>
  setArtifactPreviewOpen: Dispatch<SetStateAction<boolean>>
  setActiveArtifactPath: Dispatch<SetStateAction<string | undefined>>
  setFirstUseGuideDismissed: Dispatch<SetStateAction<boolean>>
  setSettingsDialogOpen: Dispatch<SetStateAction<boolean>>
  setSettingsInitialTab: Dispatch<SetStateAction<SettingsInitialTab>>
  setSettingsCustomProvider: Dispatch<SetStateAction<string | undefined>>
  setConversationViewScope: Dispatch<SetStateAction<ConversationViewScope | null>>

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

  openSessionRequest: { sessionId: string; nonce: number } | null
  requestOpenSession: (sessionId: string) => void
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
  settingsInitialTab: 'defaults',
  settingsCustomProvider: undefined,
  conversationViewScope: null,

  setSidebarOpen: (value) =>
    set((s) => ({ sidebarOpen: typeof value === 'function' ? value(s.sidebarOpen) : value })),
  setMobileSidebarOpen: (value) =>
    set((s) => ({ mobileSidebarOpen: typeof value === 'function' ? value(s.mobileSidebarOpen) : value })),
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
  requestOpenSession: (sessionId) => set({ openSessionRequest: { sessionId, nonce: ++requestNonce } }),
  clearOpenSessionRequest: () => set({ openSessionRequest: null }),
}))
