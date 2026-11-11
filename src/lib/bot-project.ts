import type { ProjectInfo } from '@/lib/types'

/**
 * bot 的专属目录也被注册成项目（文件工具需要它的 path 当 workspaceRoot），
 * 但它不是「用户的项目」：不该出现在项目切换器、新对话默认项目、顶栏项目
 * 胶囊里。
 *
 * `project-store` 只能过滤「项目列表」这一条通道，过滤不到 `activeProject`、
 * 「会话自带的 project」和「git 状态按 projectId 拉取」这些路径，所以判据
 * 留一个统一出口，避免每个调用点各写一遍 `kind === 'bot'`。
 */
export function isBotProject(project: ProjectInfo | undefined): boolean {
  return project?.kind === 'bot'
}
