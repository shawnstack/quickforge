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
    toggleProjectsCollapsed,
    togglePinnedCollapsed,
    toggleConversationsCollapsed,
  } as const
}
