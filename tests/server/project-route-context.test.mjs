import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveRequestedProject, workspaceRootAfterProjectDeletion } from '../../server/project-route-context.mjs'

const projectA = { id: 'project-a', name: 'A', path: 'C:\\workspaces\\a' }
const projectB = { id: 'project-b', name: 'B', path: 'C:\\workspaces\\b' }

function config(overrides = {}) {
  return {
    activeProjectId: 'project-a',
    projects: [projectA, projectB],
    ...overrides,
  }
}

describe('project route context', () => {
  it('resolves the active project when no explicit project id is provided', () => {
    expect(resolveRequestedProject(config(), undefined, 'C:\\default')).toBe(projectA)
  })

  it('resolves the synthetic default workspace explicitly', () => {
    expect(resolveRequestedProject(config(), 'default', 'C:\\default')).toMatchObject({
      id: 'default',
      path: 'C:\\default',
    })
  })

  it('rejects an explicit deleted or unknown project instead of falling back', () => {
    expect(() => resolveRequestedProject(config(), 'deleted-project', 'C:\\default')).toThrowError(
      expect.objectContaining({ message: 'Unknown project', statusCode: 404 }),
    )
  })

  it('falls back to the first project only when no explicit id is provided', () => {
    expect(resolveRequestedProject(config({ activeProjectId: 'missing' }), undefined, 'C:\\default')).toBe(projectA)
  })

  it('uses the successor project root after deletion', () => {
    expect(workspaceRootAfterProjectDeletion(projectB, 'C:\\default')).toBe(path.resolve(projectB.path))
  })

  it('uses the default workspace root after deleting the last project', () => {
    expect(workspaceRootAfterProjectDeletion(undefined, 'C:\\default')).toBe(path.resolve('C:\\default'))
  })
})
