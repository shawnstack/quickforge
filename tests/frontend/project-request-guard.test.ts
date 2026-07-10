import { describe, expect, it } from 'vitest'
import { isCurrentProjectRequest } from '../../src/lib/project-request-guard'

describe('isCurrentProjectRequest', () => {
  it('accepts the latest request for the current project', () => {
    expect(isCurrentProjectRequest({ projectId: 'project-a', requestId: 3 }, 'project-a', 3)).toBe(true)
  })

  it('rejects a request after switching projects', () => {
    expect(isCurrentProjectRequest({ projectId: 'project-a', requestId: 3 }, 'project-b', 4)).toBe(false)
  })

  it('rejects an old A request after A to B to A', () => {
    expect(isCurrentProjectRequest({ projectId: 'project-a', requestId: 3 }, 'project-a', 5)).toBe(false)
  })
})
