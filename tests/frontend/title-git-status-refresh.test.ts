import { describe, expect, it } from 'vitest'
import { shouldRefreshTitleGitStatusOnToolEnd } from '../../src/lib/title-git-status-refresh'

const currentSessionId = 'session-a'
const currentProjectId = 'project-a'

function shouldRefresh(toolName: string, overrides: Record<string, unknown> = {}) {
  return shouldRefreshTitleGitStatusOnToolEnd({
    type: 'tool_execution_end',
    sessionId: currentSessionId,
    toolName,
    ...overrides,
  }, currentSessionId, currentProjectId)
}

describe('shouldRefreshTitleGitStatusOnToolEnd', () => {
  it.each([
    'write_file',
    'edit_file',
    'run_command',
    'run_subagent',
  ])('refreshes after the write-capable tool %s ends', (toolName) => {
    expect(shouldRefresh(toolName)).toBe(true)
  })

  it.each([
    'read_file',
    'grep_files',
    'present_files',
    'activate_skill',
    'read_skill_resource',
  ])('does not refresh after the read-only tool %s ends', (toolName) => {
    expect(shouldRefresh(toolName)).toBe(false)
  })

  it('ignores events from another session', () => {
    expect(shouldRefresh('write_file', { sessionId: 'session-b' })).toBe(false)
  })

  it('ignores non-completion events', () => {
    expect(shouldRefresh('write_file', { type: 'tool_execution_start' })).toBe(false)
  })

  it('does not refresh without a current project', () => {
    expect(shouldRefreshTitleGitStatusOnToolEnd({
      type: 'tool_execution_end',
      sessionId: currentSessionId,
      toolName: 'write_file',
    }, currentSessionId, undefined)).toBe(false)
  })

  it('refreshes even when a write-capable tool reports an error', () => {
    expect(shouldRefresh('run_command', { isError: true })).toBe(true)
  })
})
