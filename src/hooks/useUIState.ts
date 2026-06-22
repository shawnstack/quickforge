import { useCallback, useState } from 'react'
import type { SkillsScope } from '@/lib/types'
import type { ProjectInfo } from '@/lib/types'
import type { WorkspaceFileResponse, WorkspaceInspectorFocusTarget, WorkspacePanelView } from '@/components/workspace/workspace-types'

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
  const [conversationsCollapsed, setConversationsCollapsed] = useState(false)
  const [mcpServersDialogOpen, setMcpServersDialogOpen] = useState(false)
  const [skillsDialog, setSkillsDialog] = useState<{ scope: SkillsScope; project?: ProjectInfo }>()
  const [shareDialogOpen, setShareDialogOpen] = useState(false)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const [workspaceInspectorOpen, setWorkspaceInspectorOpen] = useState(false)
  const [workspacePanelView, setWorkspacePanelView] = useState<WorkspacePanelView>('overview')
  const [workspaceInspectorFocusTarget, setWorkspaceInspectorFocusTarget] = useState<WorkspaceInspectorFocusTarget>()
  const [webPreviewUrl, setWebPreviewUrl] = useState('')
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(false)
  const [activeArtifactPath, setActiveArtifactPath] = useState<string>()
  const [inlineReaderOpen, setInlineReaderOpen] = useState(false)
  const [inlineReaderFile, setInlineReaderFile] = useState<WorkspaceFileResponse>()
  const [inlineReaderLoading, setInlineReaderLoading] = useState(false)
  const [inlineReaderError, setInlineReaderError] = useState<string>()
  const [firstUseGuideDismissed, setFirstUseGuideDismissed] = useState(false)

  const toggleProjectsCollapsed = useCallback(() => setProjectsCollapsed(v => !v), [])
  const toggleConversationsCollapsed = useCallback(() => setConversationsCollapsed(v => !v), [])

  return {
    sidebarOpen, setSidebarOpen,
    mobileSidebarOpen, setMobileSidebarOpen,
    projectsCollapsed, setProjectsCollapsed,
    conversationsCollapsed, setConversationsCollapsed,
    mcpServersDialogOpen, setMcpServersDialogOpen,
    skillsDialog, setSkillsDialog,
    shareDialogOpen, setShareDialogOpen,
    conversationMenuOpen, setConversationMenuOpen,
    workspaceInspectorOpen, setWorkspaceInspectorOpen,
    workspacePanelView, setWorkspacePanelView,
    workspaceInspectorFocusTarget, setWorkspaceInspectorFocusTarget,
    webPreviewUrl, setWebPreviewUrl,
    artifactPreviewOpen, setArtifactPreviewOpen,
    activeArtifactPath, setActiveArtifactPath,
    inlineReaderOpen, setInlineReaderOpen,
    inlineReaderFile, setInlineReaderFile,
    inlineReaderLoading, setInlineReaderLoading,
    inlineReaderError, setInlineReaderError,
    firstUseGuideDismissed, setFirstUseGuideDismissed,
    toggleProjectsCollapsed,
    toggleConversationsCollapsed,
  } as const
}
