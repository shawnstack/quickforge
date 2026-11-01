import { useUIStore } from '@/stores/ui-store'

/**
 * UI 状态已迁入 useUIStore（zustand）。
 * 本 hook 保留为兼容层：字段与旧实现完全一致（含 useState 风格的
 * Dispatch<SetStateAction<T>> setter 签名），App.tsx 及 useMobileSidebar
 * 的既有接线/类型引用不变；action 引用恒定，等价于旧 useCallback([])。
 *
 * 注意：conversationViewScope 保持 { scopeId, view } 结构（而非裸字符串），
 * 以维持「切会话自动回到对话视图」的派生设计（App 用 scopeId 与当前
 * runtimeScopeId 比较派生实际视图，不在 effect 里 setState 重置）。
 */
export function useUIState() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen)
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)
  const projectsCollapsed = useUIStore((s) => s.projectsCollapsed)
  const setProjectsCollapsed = useUIStore((s) => s.setProjectsCollapsed)
  const pinnedCollapsed = useUIStore((s) => s.pinnedCollapsed)
  const setPinnedCollapsed = useUIStore((s) => s.setPinnedCollapsed)
  const conversationsCollapsed = useUIStore((s) => s.conversationsCollapsed)
  const setConversationsCollapsed = useUIStore((s) => s.setConversationsCollapsed)
  const skillsDialog = useUIStore((s) => s.skillsDialog)
  const setSkillsDialog = useUIStore((s) => s.setSkillsDialog)
  const shareDialogOpen = useUIStore((s) => s.shareDialogOpen)
  const setShareDialogOpen = useUIStore((s) => s.setShareDialogOpen)
  const conversationMenuOpen = useUIStore((s) => s.conversationMenuOpen)
  const setConversationMenuOpen = useUIStore((s) => s.setConversationMenuOpen)
  const workspaceInspectorRequest = useUIStore((s) => s.workspaceInspectorRequest)
  const setWorkspaceInspectorRequest = useUIStore((s) => s.setWorkspaceInspectorRequest)
  const artifactPreviewOpen = useUIStore((s) => s.artifactPreviewOpen)
  const setArtifactPreviewOpen = useUIStore((s) => s.setArtifactPreviewOpen)
  const activeArtifactPath = useUIStore((s) => s.activeArtifactPath)
  const setActiveArtifactPath = useUIStore((s) => s.setActiveArtifactPath)
  const firstUseGuideDismissed = useUIStore((s) => s.firstUseGuideDismissed)
  const setFirstUseGuideDismissed = useUIStore((s) => s.setFirstUseGuideDismissed)
  const settingsDialogOpen = useUIStore((s) => s.settingsDialogOpen)
  const setSettingsDialogOpen = useUIStore((s) => s.setSettingsDialogOpen)
  const settingsInitialTab = useUIStore((s) => s.settingsInitialTab)
  const setSettingsInitialTab = useUIStore((s) => s.setSettingsInitialTab)
  const settingsCustomProvider = useUIStore((s) => s.settingsCustomProvider)
  const setSettingsCustomProvider = useUIStore((s) => s.setSettingsCustomProvider)
  const conversationViewScope = useUIStore((s) => s.conversationViewScope)
  const setConversationViewScope = useUIStore((s) => s.setConversationViewScope)
  const toggleProjectsCollapsed = useUIStore((s) => s.toggleProjectsCollapsed)
  const togglePinnedCollapsed = useUIStore((s) => s.togglePinnedCollapsed)
  const toggleConversationsCollapsed = useUIStore((s) => s.toggleConversationsCollapsed)

  return {
    sidebarOpen, setSidebarOpen,
    mobileSidebarOpen, setMobileSidebarOpen,
    projectsCollapsed, setProjectsCollapsed,
    pinnedCollapsed, setPinnedCollapsed,
    conversationsCollapsed, setConversationsCollapsed,
    skillsDialog, setSkillsDialog,
    shareDialogOpen, setShareDialogOpen,
    conversationMenuOpen, setConversationMenuOpen,
    workspaceInspectorRequest, setWorkspaceInspectorRequest,
    artifactPreviewOpen, setArtifactPreviewOpen,
    activeArtifactPath, setActiveArtifactPath,
    firstUseGuideDismissed, setFirstUseGuideDismissed,
    settingsDialogOpen, setSettingsDialogOpen,
    settingsInitialTab, setSettingsInitialTab,
    settingsCustomProvider, setSettingsCustomProvider,
    conversationViewScope, setConversationViewScope,
    toggleProjectsCollapsed,
    togglePinnedCollapsed,
    toggleConversationsCollapsed,
  } as const
}
