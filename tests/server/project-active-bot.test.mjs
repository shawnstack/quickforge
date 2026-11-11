import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getActiveProject } from '../../server/project-config.mjs'

/**
 * bot 目录也会被注册成项目（文件工具要它的 path 当 workspaceRoot），但它不是
 * 「用户的当前项目」。这个约束一旦破了，打开一次 bot 之后：终端默认目录、
 * 无 projectId 的工具、新对话的默认项目都会跑到 bot 目录里，而且切回普通
 * 对话后没人记得切回来。
 *
 * 这里锁两个出口：
 * 1. `getActiveProject` 的 activeProjectId 命中与兜底都不落在 bot 上；
 * 2. `POST /api/project/active` 对 bot 项目只返回项目、不改写 activeProjectId。
 */
const projectConfigSource = readFileSync(new URL('../../server/project-config.mjs', import.meta.url), 'utf8')
const projectRouteSource = readFileSync(new URL('../../server/routes/project.mjs', import.meta.url), 'utf8')

function project(id, patch = {}) {
  return { id, name: id, path: `/tmp/${id}`, lastOpenedAt: '', ...patch }
}

describe('bot 目录不参与「当前项目」', () => {
  it('activeProjectId 指向 bot 时返回真正的项目', () => {
    const config = {
      activeProjectId: 'bot-1',
      projects: [project('real-1'), project('bot-1', { kind: 'bot' })],
    }
    expect(getActiveProject(config)?.id).toBe('real-1')
  })

  it('activeProjectId 失效时兜底也跳过 bot', () => {
    const config = {
      activeProjectId: null,
      projects: [project('bot-1', { kind: 'bot' }), project('real-1')],
    }
    expect(getActiveProject(config)?.id).toBe('real-1')
  })

  it('只有 bot 项目时保留原来的「第一个」兜底，不返回 undefined', () => {
    const config = {
      activeProjectId: null,
      projects: [project('bot-1', { kind: 'bot' })],
    }
    expect(getActiveProject(config)?.id).toBe('bot-1')
  })

  it('getActiveProject 的兜底链明确排除 kind === "bot"', () => {
    expect(projectConfigSource).toContain("project.kind !== 'bot'")
    expect(projectConfigSource).toContain('|| config.projects[0]')
  })

  it('激活 bot 项目时不改写 activeProjectId，但把项目本身返回给调用方', () => {
    expect(projectRouteSource).toContain("if (selected.kind === 'bot') {")
    expect(projectRouteSource).toContain('project: selected, projects: config.projects')
    // setActiveProjectPath 里同样的守卫：不活化、也不把 bot 项目改名成目录名。
    expect(projectConfigSource).toContain("if (project?.kind === 'bot') return config")
  })
})
