import { describe, expect, it, beforeEach } from 'vitest'
import { useProjectStore } from '@/stores/project-store'
import type { ProjectInfo } from '@/lib/types'

function project(id: string, patch: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    lastOpenedAt: '',
    ...patch,
  }
}

describe('project store hides bot workspaces', () => {
  beforeEach(() => {
    useProjectStore.setState({ projects: [] })
  })

  it('filters kind === "bot" out of the project switcher list', () => {
    useProjectStore.getState().setProjects([
      project('alpha'),
      project('bot-dir', { kind: 'bot' }),
      project('beta'),
    ])
    expect(useProjectStore.getState().projects.map((item) => item.id)).toEqual(['alpha', 'beta'])
  })

  it('filters function-form updates too', () => {
    useProjectStore.getState().setProjects([project('alpha')])
    useProjectStore.getState().setProjects((previous) => [
      ...previous,
      project('bot-dir', { kind: 'bot' }),
    ])
    expect(useProjectStore.getState().projects.map((item) => item.id)).toEqual(['alpha'])
  })

  it('keeps ordinary projects untouched', () => {
    const list = [project('alpha'), project('beta')]
    useProjectStore.getState().setProjects(list)
    expect(useProjectStore.getState().projects).toHaveLength(2)
  })
})
