import { describe, expect, it } from 'vitest'
import { getDeletedProjectRecoveryDecision } from '../../src/lib/deleted-project-recovery'
import type { ProjectInfo } from '../../src/lib/types'

function project(id: string, patch: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    path: `C:\\workspaces\\${id}`,
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

describe('getDeletedProjectRecoveryDecision', () => {
  it('does nothing before project state is ready', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: false,
      currentToolProject: project('project-a'),
      projects: [],
    })).toEqual({ type: 'none' })
  })

  it('does nothing when a different project was deleted', () => {
    const currentProject = project('project-a')

    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: currentProject,
      projects: [currentProject],
      activeProject: currentProject,
    })).toEqual({ type: 'none' })
  })

  it('recovers into the successor project when the current project was deleted', () => {
    const successor = project('project-b')

    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: project('project-a'),
      projects: [successor],
      activeProject: successor,
    })).toEqual({
      type: 'project',
      deletedProjectId: 'project-a',
      project: successor,
    })
  })

  it('recovers globally after deleting the last project', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: project('project-a'),
      projects: [],
    })).toEqual({
      type: 'global',
      deletedProjectId: 'project-a',
    })
  })

  it('does not recover the default workspace', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: project('default'),
      projects: [],
    })).toEqual({ type: 'none' })
  })

  it('does not start duplicate recovery for the same deleted project', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: project('project-a'),
      projects: [],
      recoveringProjectId: 'project-a',
    })).toEqual({ type: 'none' })
  })

  it('never treats a bot directory as a deleted project', () => {
    // bot 目录被注册成项目但按设计不在 projects 列表里——「不在列表」不等于被删。
    const botProject = project('bot-1', { kind: 'bot' })

    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: botProject,
      projects: [project('project-a')],
      activeProject: project('project-a'),
    })).toEqual({ type: 'none' })

    // 没有真实项目可回落时也不能退化成 global——否则同样会顶掉 bot 的对话。
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProject: botProject,
      projects: [],
    })).toEqual({ type: 'none' })
  })
})
