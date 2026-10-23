import { useCallback, useState } from 'react'
import type { SkillsScope } from '@/lib/types'
import type { SettingsInitialTab } from '@/lib/settings-tabs'
import type { ProjectInfo } from '@/lib/types'
import type { WorkspaceInspectorOpenRequest } from '@/components/workspace/workspace-types'

/**
 * Pure UI state — sidebar, dialogs, overlays, inspector, and reader toggles.
 *
 * Kept separate from business-logic hooks (useAgentManager, useAppBootstrap, etc.)
 * so that App.tsx can stay focused on orchestration.
 */
export function useUIState() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false)
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false)
  const [skillsDialog, setSkillsDialog] = useState<{ scope: SkillsScope; project?: ProjectInfo }>()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const [workspaceInspectorRequest, setWorkspaceInspectorRequest] = useState<WorkspaceInspectorOpenRequest>()
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false)
  const [activeArtifactPath, setActiveArtifactPath] = useState<string>()
  const [firstUseGuideDismissed, setFirstUseGuideDismissed] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsInitialTab>('defaults')
  const [settingsCustomProvider, setSettingsCustomProvider] = useState<string>()
  /**
   * 对话区视图选择，绑定到打开它的会话作用域（runtimeScopeId）。
   *
   * 存成 { scopeId, view } 而不是裸字符串，是为了「切会话自动回到对话视图」：
   * App 用 scopeId 是否等于当前 runtimeScopeId 派生实际视图，不需要在 effect 里
   * setState 重置（那会被 react-hooks/set-state-in-effect 判 error，也与
   * workspaceInspectorOpenScopeId 的既有做法一致）。
   */
  const [conversationViewScope, setConversationViewScope] = useState<{ scopeId: string; view: 'chat' | 'trace' } | null>(null)

  const toggleProjectsCollapsed = useCallback(() => setProjectsCollapsed(v => !v), [])
  const togglePinnedCollapsed = useCallback(() => setPinnedCollapsed(v => !v), [])
  const toggleConversationsCollapsed = useCallback(() => setConversationsCollapsed(v => !v), [])

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
