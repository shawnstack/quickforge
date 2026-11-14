import type { ComponentProps } from 'react'
import { BotSettingsDialog, NewBotDialog } from '@/components/bots/BotDialogs'
import { GitCommitPushDialog } from '@/components/git/GitCommitPushDialog'
import { GitGraphDialog } from '@/components/git/GitGraphDialog'
import { ProjectDirectoryPicker } from '@/components/project-directory-picker'
import { ShareConversationDialog } from '@/components/share/ShareConversationDialog'
import { SkillsDialog } from '@/components/skills'
import { ToastContainer } from '@/components/ui/toast'
import type { ProjectInfo } from '@/lib/types'
import type { SkillsDialogRequest } from '@/stores/ui-store'

// App.tsx 的「对话框层」，按原 JSX 的两处落点拆成两个导出，DOM 顺序与搬出来之前一致：
//   - AppGitDialogs：主区 div 内（Git 图形 / 提交）
//   - AppOverlays：StartupSplash 之后（目录选择 / 技能 / 新建 bot / bot 设置 / 分享 / toast）
// 全部是 props 透传，自身不持有状态、不加条件渲染（开合条件仍由 App.tsx 传进来的状态决定）。
//
// 注意：TurnRollbackDialog 与 StartupSplash 故意留在 App.tsx —— 它们被
// tests/frontend 的源码子串断言钉住，不在这一层里；AppOverlays 排回它们之后，
// 只为让 DOM 顺序与搬出之前逐字一致。TurnRollbackDialog 是原生 showModal 模态、
// 层级来自 top layer，与 DOM 顺序无关——这里追求的是结构保真，不是层级。

type GitDialogsProps = {
  graphOpen: boolean
  onGraphOpenChange: (open: boolean) => void
  commitOpen: boolean
  onCommitOpenChange: (open: boolean) => void
  project?: ProjectInfo
  status?: ComponentProps<typeof GitCommitPushDialog>['status']
  onStatusChange: ComponentProps<typeof GitCommitPushDialog>['onStatusChange']
  onCheckout: ComponentProps<typeof GitCommitPushDialog>['onCheckout']
  onRefreshStatus: ComponentProps<typeof GitCommitPushDialog>['onRefreshStatus']
  onCompleted: ComponentProps<typeof GitCommitPushDialog>['onCompleted']
}

type SkillsDialogGroupProps = {
  dialog?: SkillsDialogRequest
  onDialogChange: (dialog: SkillsDialogRequest | undefined) => void
  onSaved: ComponentProps<typeof SkillsDialog>['onSaved']
}

type BotDialogsProps = {
  newBotOpen: boolean
  newBotPending?: boolean
  newBotError?: string | null
  onCancelNewBot: ComponentProps<typeof NewBotDialog>['onCancel']
  onCreateBot: ComponentProps<typeof NewBotDialog>['onCreate']
  settings: ComponentProps<typeof BotSettingsDialog>['bot']
  onCloseSettings: (bot: ComponentProps<typeof BotSettingsDialog>['bot']) => void
  onSettingsChanged: ComponentProps<typeof BotSettingsDialog>['onChanged']
  onDeleteBot: ComponentProps<typeof BotSettingsDialog>['onDeleted']
}

export function AppGitDialogs({ git }: { git: GitDialogsProps }) {
  const project = git.project

  return (
    <>
      {git.graphOpen && project?.id ? (
        <GitGraphDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => git.onGraphOpenChange(false)}
        />
      ) : null}
      {git.commitOpen ? (
        <GitCommitPushDialog
          key={project?.id ?? 'git-commit'}
          open
          projectId={project?.id}
          status={git.status}
          onClose={() => git.onCommitOpenChange(false)}
          onCheckout={git.onCheckout}
          onRefreshStatus={git.onRefreshStatus}
          onStatusChange={git.onStatusChange}
          onCompleted={git.onCompleted}
        />
      ) : null}
    </>
  )
}

export function AppOverlays({
  picker,
  skills,
  bot,
  share,
  toast,
}: {
  picker: ComponentProps<typeof ProjectDirectoryPicker>
  skills: SkillsDialogGroupProps
  bot: BotDialogsProps
  share: ComponentProps<typeof ShareConversationDialog>
  toast: ComponentProps<typeof ToastContainer>
}) {
  return (
    <>
      <ProjectDirectoryPicker {...picker} />
      <SkillsDialog
        open={Boolean(skills.dialog)}
        scope={skills.dialog?.scope ?? 'global'}
        project={skills.dialog?.project}
        onOpenChange={(open) => {
          if (!open) skills.onDialogChange(undefined)
        }}
        onSaved={skills.onSaved}
      />
      <NewBotDialog
        key={bot.newBotOpen ? 'new-bot-open' : 'new-bot-closed'}
        open={bot.newBotOpen}
        pending={bot.newBotPending}
        error={bot.newBotError}
        onCancel={bot.onCancelNewBot}
        onCreate={(name) => { void bot.onCreateBot(name) }}
      />
      <BotSettingsDialog
        key={bot.settings?.id ?? 'no-bot'}
        bot={bot.settings}
        onClose={() => { bot.onCloseSettings(null) }}
        onChanged={bot.onSettingsChanged}
        onDeleted={(botId) => { void bot.onDeleteBot(botId) }}
      />
      <ShareConversationDialog {...share} />
      <ToastContainer {...toast} />
    </>
  )
}
