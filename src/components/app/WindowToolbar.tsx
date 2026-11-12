import type { RefObject } from 'react'
import {
  PanelRight,
  SquareTerminal,
} from 'lucide-react'
import { ProjectOpenMenu } from '@/components/project/ProjectOpenMenu'
import { Button } from '@/components/ui/button'
import { GitToolsPinnedSummary } from '@/components/git/GitToolsPinnedSummary'
import type { BackgroundCommandSummary, TodoWriteItem } from '@/components/chat/panel-decoration'
import type { GitStatusResponse, WorkspaceInspectorOpenRequestInput, WorkspaceInspectorRuntimeScope } from '@/components/workspace/workspace-types'
import type { GoalAction, GoalActionOptions } from '@/lib/goal'
import type { GoalState } from '@/lib/goal'
import { shouldClosePinnedSummaryBeforeInspectorOpen } from '@/lib/pinned-summary-drag'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'

/** 右上角窗口工具条（原 MainApp 内联 JSX）：项目打开菜单、置顶摘要（git 工具 /
 *  subagent / 后台命令 / goal）、终端开关与右侧面板开关。纯装配 + 回调转发，
 *  状态与动作全部来自 MainApp。 */
export function WindowToolbar(props: {
  fullscreen: boolean
  remoteClient: boolean
  mobileShell: boolean
  workspaceInspectorOpen: boolean
  workspaceInspectorRuntimeScopeId: string
  workspaceInspectorProjectId: string
  needsModelSetup: boolean
  terminalDockOpen: boolean
  gitToolsExpanded: boolean
  pinnedSummarySuspended: boolean
  canSuspendPinnedSummaryOnInspectorOpen: boolean
  currentToolProject: ProjectInfo | undefined
  currentAgentSessionId: string | undefined
  titleGitStatus: GitStatusResponse | undefined
  conversationHeaderRef: RefObject<HTMLElement | null>
  pinnedSummaryTodos: TodoWriteItem[]
  pinnedSummarySubagentRuns: SubagentRunPayload[]
  pinnedSummaryRunningSubagentRuns: SubagentRunPayload[]
  pinnedSummaryBackgroundCommands: BackgroundCommandSummary[]
  pinnedSummaryGoal: GoalState | null
  pinnedSummaryGoalSessionId: string
  onGoalAction: (action: GoalAction, objective?: string, options?: GoalActionOptions) => Promise<void>
  onCheckout: (branch: string) => Promise<void>
  onBranchCreated: (status: GitStatusResponse) => void
  onSetGitToolsExpanded: (value: boolean) => void
  onSetGitCommitDialogOpen: (value: boolean) => void
  onSetGitGraphOpen: (value: boolean) => void
  onOpenSubagentRun: (payload: SubagentRunPayload) => void
  onOpenWorkspaceGitChanges: () => void
  onOpenProjectInExplorerWithFeedback: (project: ProjectInfo) => void
  onOpenProjectInVSCodeWithFeedback: (project: ProjectInfo) => void
  onOpenProjectInIDEAWithFeedback: (project: ProjectInfo) => void
  onSetTerminalDockOpen: (value: boolean | ((current: boolean) => boolean)) => void
  onSetArtifactPreviewOpen: (value: boolean) => void
  onSetWorkspaceInspectorOpenScopeId: (value: string | null) => void
  onRequestWorkspaceInspector: (request: WorkspaceInspectorOpenRequestInput, scope?: WorkspaceInspectorRuntimeScope) => boolean
}) {
  const {
    fullscreen,
    remoteClient,
    mobileShell,
    workspaceInspectorOpen,
    workspaceInspectorRuntimeScopeId,
    workspaceInspectorProjectId,
    needsModelSetup,
    terminalDockOpen,
    gitToolsExpanded,
    pinnedSummarySuspended,
    canSuspendPinnedSummaryOnInspectorOpen,
    currentToolProject,
    currentAgentSessionId,
    titleGitStatus,
    conversationHeaderRef,
    pinnedSummaryTodos,
    pinnedSummarySubagentRuns,
    pinnedSummaryRunningSubagentRuns,
    pinnedSummaryBackgroundCommands,
    pinnedSummaryGoal,
    pinnedSummaryGoalSessionId,
    onGoalAction,
    onCheckout,
    onBranchCreated,
    onSetGitToolsExpanded,
    onSetGitCommitDialogOpen,
    onSetGitGraphOpen,
    onOpenSubagentRun,
    onOpenWorkspaceGitChanges,
    onOpenProjectInExplorerWithFeedback,
    onOpenProjectInVSCodeWithFeedback,
    onOpenProjectInIDEAWithFeedback,
    onSetTerminalDockOpen,
    onSetArtifactPreviewOpen,
    onSetWorkspaceInspectorOpenScopeId,
    onRequestWorkspaceInspector,
  } = props

  return (
    <div
      className={cn(
        'quickforge-window-toolbar fixed right-2 z-30 flex items-center gap-1',
        fullscreen && 'pointer-events-none invisible',
      )}
      aria-hidden={fullscreen || undefined}
      aria-label={t('workspacePanel')}
    >
      {!remoteClient && !workspaceInspectorOpen ? (
        <ProjectOpenMenu
          project={currentToolProject}
          disabled={needsModelSetup}
          onOpenInExplorer={onOpenProjectInExplorerWithFeedback}
          onOpenInVSCode={onOpenProjectInVSCodeWithFeedback}
          onOpenInIDEA={onOpenProjectInIDEAWithFeedback}
        />
      ) : null}
      {(
        !workspaceInspectorOpen
        || pinnedSummarySuspended
      ) && (
        pinnedSummaryTodos.length > 0
        || pinnedSummarySubagentRuns.length > 0
        || pinnedSummaryRunningSubagentRuns.length > 0
        || pinnedSummaryBackgroundCommands.length > 0
        || titleGitStatus?.isGitRepository
        || Boolean(pinnedSummaryGoal)
      ) ? (
        <GitToolsPinnedSummary
          projectId={currentToolProject?.id}
          status={titleGitStatus}
          todos={pinnedSummaryTodos}
          runningSubagentRuns={pinnedSummaryRunningSubagentRuns}
          finishedSubagentRuns={pinnedSummarySubagentRuns}
          backgroundCommands={pinnedSummaryBackgroundCommands}
          onStopBackgroundCommand={(command) => {
            const sessionId = command.sessionId || currentAgentSessionId
            if (!sessionId || !command.toolCallId) return
            void fetch(`/api/agents/${encodeURIComponent(sessionId)}/abort-tool`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ toolCallId: command.toolCallId }),
            })
          }}
          onOpenBackgroundTasks={() => {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              onSetGitToolsExpanded(false)
            }
            onRequestWorkspaceInspector({ projectId: workspaceInspectorProjectId, kind: 'background-tasks' })
          }}
          goal={pinnedSummaryGoal}
          goalSessionId={pinnedSummaryGoalSessionId}
          onGoalAction={onGoalAction}
          expanded={gitToolsExpanded}
          suspended={pinnedSummarySuspended}
          onExpandedChange={onSetGitToolsExpanded}
          onOpenSubagentRun={(payload) => {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              onSetGitToolsExpanded(false)
            }
            onOpenSubagentRun(payload)
          }}
          onOpenChanges={() => {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              onSetGitToolsExpanded(false)
            }
            onOpenWorkspaceGitChanges()
          }}
          onOpenCommitPush={() => {
            onSetGitToolsExpanded(false)
            onSetGitCommitDialogOpen(true)
          }}
          onCheckout={onCheckout}
          onCreated={onBranchCreated}
          onOpenGraph={() => onSetGitGraphOpen(true)}
          mobileShell={mobileShell}
          initialAnchorRef={conversationHeaderRef}
        />
      ) : null}
      {!remoteClient ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            onSetArtifactPreviewOpen(false)
            onSetTerminalDockOpen((value) => !value)
          }}
          disabled={!currentToolProject?.id || needsModelSetup}
          aria-label={terminalDockOpen ? t('terminalCollapse') : t('rightPanelTerminal')}
          title={terminalDockOpen ? t('terminalCollapse') : t('rightPanelTerminal')}
          className={cn(
            'rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40',
            terminalDockOpen ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground' : undefined,
          )}
        >
          <SquareTerminal className="size-[18px] stroke-[1.85]" />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          onSetArtifactPreviewOpen(false)
          if (workspaceInspectorOpen) {
            onSetWorkspaceInspectorOpenScopeId(null)
          } else {
            if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {
              onSetGitToolsExpanded(false)
            }
            onSetWorkspaceInspectorOpenScopeId(workspaceInspectorRuntimeScopeId)
          }
        }}
        data-pinned-summary-inspector-toggle="true"
        disabled={needsModelSetup}
        aria-label={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        title={workspaceInspectorOpen ? t('workspaceCollapseRightPanel') : t('workspaceExpandRightPanel')}
        className={cn(
          'rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40 inline-flex',
          workspaceInspectorOpen ? 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground' : undefined,
        )}
      >
        <PanelRight className="size-[18px] stroke-[1.85]" />
      </Button>
    </div>
  )
}
