import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBotProject } from '../../src/lib/bot-project'
import type { ProjectInfo } from '../../src/lib/types'

/**
 * bot 目录是注册项目（工具要 workspaceRoot），但它不是「用户的项目」。
 * `project-store` 只过滤了列表这一条通道，`activeProject`、「当前会话自带的
 * project」和「git 状态按 projectId 拉取」都绕过了它。这里锁住另外三处：
 *
 * - 新对话默认项目 / 空态自动进项目会话：跳过 bot 项目；
 * - 顶栏项目胶囊、分支菜单、空态项目胶囊：bot 项目与 bot 模式都不显示；
 * - 切进 bot 模式：先等列表加载完，再自动打开第一个 bot。
 */
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const useProjectSource = readFileSync(new URL('../../src/hooks/useProject.ts', import.meta.url), 'utf8')
const recoverySource = readFileSync(new URL('../../src/lib/deleted-project-recovery.ts', import.meta.url), 'utf8')

function project(id: string, patch: Partial<ProjectInfo> = {}): ProjectInfo {
  return { id, name: id, path: `/tmp/${id}`, lastOpenedAt: '', ...patch }
}

describe('isBotProject', () => {
  it('只认 kind === "bot"', () => {
    expect(isBotProject(project('bot-1', { kind: 'bot' }))).toBe(true)
    expect(isBotProject(project('real-1'))).toBe(false)
    expect(isBotProject(undefined)).toBe(false)
  })
})

describe('新建对话不落到 bot 目录', () => {
  it('startNewDefaultSession 跳过 bot 的 activeProject', () => {
    expect(appSource).toContain('if (activeProject && !isBotProject(activeProject))')
  })

  it('空态的「自动进项目会话」同样跳过 bot', () => {
    expect(appSource).toContain('!activeProject || isBotProject(activeProject) || agentManager.chatScope !== \'global\'')
  })

  it('useProject 写入「当前项目」的唯一出口拒绝 bot', () => {
    expect(useProjectSource).toContain('const applyActiveProject = useCallback(')
    expect(useProjectSource).toContain('isBotProject(project) ? current : project')
    expect(useProjectSource).not.toContain('setActiveProject(payload.project)')
  })
})

describe('bot 语境不展示项目与分支', () => {
  it('顶栏项目与分支由 headerProject / headerGit 收敛', () => {
    expect(appSource).toContain('const headerProject = botMode || isBotProject(agentManager.currentToolProject)')
    expect(appSource).toContain('const headerGitRepository = !botMode && Boolean(titleGitStatus?.isGitRepository)')
    expect(appSource).toContain('projectName={headerProject?.name}')
    expect(appSource).toContain('projectId={headerProject?.id}')
    expect(appSource).toContain('gitBranch={headerGitBranch}')
  })

  it('空态项目胶囊在 bot 模式、以及 bot 项目下都不渲染', () => {
    expect(appSource).toContain('{showNewChatEmptyState && !botMode ? (')
    expect(appSource).toContain("const emptyStateProject = agentManager.chatScope === 'project' && !botMode && !isBotProject(agentManager.currentToolProject)")
  })

  it('切进 bot 模式先刷新再自动打开第一个 bot', () => {
    expect(appSource).toContain('const toggleBotMode = useCallback(async () => {')
    expect(appSource).toContain('const list = bots.length > 0 ? bots : await refreshBots()')
    expect(appSource).toContain('if (!belongsToBot && first) await openBotSession(first)')
    expect(appSource).toContain('const refreshBots = useCallback(async (): Promise<BotSummary[]> => {')
  })
})

describe('退出 bot 模式不把 bot 的对话留在主区', () => {
  const exitEffect = appSource.slice(
    appSource.indexOf('const previousBotModeRef = useRef(botMode)'),
    appSource.indexOf('const openNewBotDialog = useCallback('),
  )

  it('当前会话属于某个 bot 时落到新对话空态', () => {
    expect(exitEffect).toContain('if (!wasBotMode || botMode || needsModelSetup) return')
    expect(exitEffect).toContain('if (bots.some((bot) => bot.sessionId === currentBotSessionId)) startNewDefaultSession()')
  })

  it('补偿延后一个任务执行，避免 effect 内同步 setState', () => {
    expect(exitEffect).toContain('const timer = setTimeout(() => {')
    expect(exitEffect).toContain('clearTimeout(timer)')
    // 反向补偿不能塞回 toggleBotMode：那里读 agentManager.currentSessionId
    // 会被 react-hooks/refs 判成 render 期间读 ref。
    const toggleBody = appSource.slice(
      appSource.indexOf('const toggleBotMode = useCallback('),
      appSource.indexOf('const previousBotModeRef = useRef(botMode)'),
    )
    expect(toggleBody).toContain('if (!next) return')
  })
})

describe('「项目被删除」恢复不认 bot 目录', () => {
  it('App 把整个 currentToolProject 交给恢复判据（而不是只传 id）', () => {
    // 只传 id 时判据只能问「在不在 projects 列表里」；bot 项目按设计永远不在，
    // 会被误判成「已删除」→ 新建空会话顶掉 bot 对话（历史看起来就没了）。
    expect(appSource).toContain('currentToolProject: agentManager.currentToolProject,')
  })

  it('恢复判据本身先排除 bot 项目', () => {
    expect(recoverySource).toContain('if (isBotProject(currentToolProject)) return { type: \'none\' }')
  })
})
