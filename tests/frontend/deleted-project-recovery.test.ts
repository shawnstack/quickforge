import { describe, expect, it } from 'vitest'
import { getDeletedProjectRecoveryDecision } from '../../src/lib/deleted-project-recovery'
import type { ProjectInfo } from '../../src/lib/types'

function project(id: string): ProjectInfo {
  return {
    id,
    name: id,
    path: `C:\\workspaces\\${id}`,
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('getDeletedProjectRecoveryDecision', () => {
  it('does nothing before project state is ready', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: false,
      currentToolProjectId: 'project-a',
      projects: [],
    })).toEqual({ type: 'none' })
  })

  it('does nothing when a different project was deleted', () => {
    const currentProject = project('project-a')

    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProjectId: currentProject.id,
      projects: [currentProject],
      activeProject: currentProject,
    })).toEqual({ type: 'none' })
  })

  it('recovers into the successor project when the current project was deleted', () => {
    const successor = project('project-b')

    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProjectId: 'project-a',
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
      currentToolProjectId: 'project-a',
      projects: [],
    })).toEqual({
      type: 'global',
      deletedProjectId: 'project-a',
    })
  })

  it('does not recover the default workspace', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProjectId: 'default',
      projects: [],
    })).toEqual({ type: 'none' })
  })

  it('does not start duplicate recovery for the same deleted project', () => {
    expect(getDeletedProjectRecoveryDecision({
      ready: true,
      currentToolProjectId: 'project-a',
      projects: [],
      recoveringProjectId: 'project-a',
    })).toEqual({ type: 'none' })
  })
})
