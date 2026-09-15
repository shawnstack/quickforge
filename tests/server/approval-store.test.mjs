import { afterEach, describe, expect, it } from 'vitest'
import {
  APPROVAL_TIMEOUT_MS,
  commandRestrictedTools,
  commandToolPermissionError,
  createCommandToolPermissions,
  getPendingApprovalForSession,
  getPendingAutoCompactApprovalForSession,
  pendingApprovals,
  pendingAutoCompactApprovals,
  planAllowedTools,
  safeReadTools,
} from '../../server/approval-store.mjs'

afterEach(() => {
  pendingApprovals.clear()
  pendingAutoCompactApprovals.clear()
})

describe('approval store constants', () => {
  it('keeps the tool approval timeout at five minutes', () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })

  it('marks exactly the mutation-capable built-in tools as command restricted', () => {
    expect([...commandRestrictedTools].sort()).toEqual([
      'edit_file',
      'manage_global_memory',
      'run_command',
      'run_subagent',
      'write_file',
    ])
    // Free-tier read tools must never appear in the restricted set.
    for (const tool of safeReadTools) {
      expect(commandRestrictedTools.has(tool)).toBe(false)
    }
  })

  it('allows only read-only and coordination tools under /plan', () => {
    expect([...planAllowedTools].sort()).toEqual([
      'activate_skill',
      'ask_user',
      'goal_report',
      'grep_files',
      'read_file',
      'read_skill_resource',
      'run_subagent',
    ])
    for (const tool of planAllowedTools) {
      if (tool !== 'run_subagent') {
        expect(commandRestrictedTools.has(tool)).toBe(false)
      }
    }
  })

  it('keeps the free-permission read whitelist to read_file and grep_files', () => {
    expect([...safeReadTools].sort()).toEqual(['grep_files', 'read_file'])
  })
})

describe('pending approval queues', () => {
  it('returns a projection of the first pending approval for a session', () => {
    pendingApprovals.set('call-1', {
      resolve: () => {},
      reject: () => {},
      sessionId: 'session-1',
      toolName: 'write_file',
      args: { path: 'a.txt' },
      source: 'agent',
      requestedAt: 100,
      expiresAt: 100 + APPROVAL_TIMEOUT_MS,
    })
    pendingApprovals.set('call-2', {
      resolve: () => {},
      reject: () => {},
      sessionId: 'session-1',
      toolName: 'run_command',
      args: { command: 'ls' },
      source: 'agent',
      requestedAt: 200,
      expiresAt: 200 + APPROVAL_TIMEOUT_MS,
    })

    const pending = getPendingApprovalForSession('session-1')
    expect(pending).toEqual({
      toolCallId: 'call-1',
      toolName: 'write_file',
      args: { path: 'a.txt' },
      source: 'agent',
      requestedAt: 100,
      expiresAt: 100 + APPROVAL_TIMEOUT_MS,
    })
    expect(Object.keys(pending)).not.toContain('resolve')
    expect(Object.keys(pending)).not.toContain('reject')
    expect(getPendingApprovalForSession('session-2')).toBeNull()
  })

  it('returns a projection of the pending auto-compact approval for a session', () => {
    pendingAutoCompactApprovals.set('approval-1', {
      resolve: () => {},
      reject: () => {},
      sessionId: 'session-9',
      usage: { totalTokens: 1234 },
      thresholdPercent: 85,
      keepRecentTurns: 4,
      requestedAt: 10,
      expiresAt: 10 + APPROVAL_TIMEOUT_MS,
    })

    expect(getPendingAutoCompactApprovalForSession('session-9')).toEqual({
      approvalId: 'approval-1',
      usage: { totalTokens: 1234 },
      thresholdPercent: 85,
      keepRecentTurns: 4,
      requestedAt: 10,
      expiresAt: 10 + APPROVAL_TIMEOUT_MS,
    })
    expect(getPendingAutoCompactApprovalForSession('missing')).toBeNull()
  })
})

describe('commandToolPermissionError', () => {
  const planPermissions = { allowCommands: false, allowSubagents: false, allowEdit: false }

  it('returns null when the session has no active command permissions', () => {
    expect(commandToolPermissionError(null, 'write_file')).toBeNull()
    expect(commandToolPermissionError({}, 'write_file')).toBeNull()
    expect(commandToolPermissionError({ activeCommandPermissions: null }, 'write_file')).toBeNull()
    // Even an active /plan command only enforces read-only when permissions exist.
    expect(commandToolPermissionError({ activeCommandName: 'plan' }, 'write_file')).toBeNull()
  })

  it('forces the /plan read-only whitelist before any other rule', () => {
    const session = { sessionId: 's1', activeCommandName: 'plan', activeCommandPermissions: planPermissions }
    expect(commandToolPermissionError(session, 'write_file'))
      .toBe('Command /plan is read-only and cannot use write_file.')
    expect(commandToolPermissionError(session, 'edit_file'))
      .toBe('Command /plan is read-only and cannot use edit_file.')
    expect(commandToolPermissionError(session, 'run_command'))
      .toBe('Command /plan is read-only and cannot use run_command.')
    // Non-restricted but non-whitelisted tools are still blocked under /plan.
    expect(commandToolPermissionError(session, 'list_sessions'))
      .toBe('Command /plan is read-only and cannot use list_sessions.')
    // Whitelisted tools pass the plan gate and fall through to the restricted check.
    expect(commandToolPermissionError(session, 'read_file')).toBeNull()
    expect(commandToolPermissionError(session, 'grep_files')).toBeNull()
    expect(commandToolPermissionError(session, 'ask_user')).toBeNull()
    expect(commandToolPermissionError(session, 'goal_report')).toBeNull()
  })

  it('leaves unrestricted tools free regardless of permissions', () => {
    const session = { sessionId: 's1', activeCommandName: 'review', activeCommandPermissions: planPermissions }
    expect(commandToolPermissionError(session, 'read_file')).toBeNull()
    expect(commandToolPermissionError(session, 'grep_files')).toBeNull()
    expect(commandToolPermissionError(session, 'list_sessions')).toBeNull()
  })

  it('blocks run_command only when allowCommands is explicitly false', () => {
    const base = { sessionId: 's1', activeCommandName: 'review' }
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: { allowCommands: false } },
      'run_command',
    )).toBe('Command /review does not allow running shell commands.')
    // Undefined (unset) means allowed — only an explicit false denies.
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: {} },
      'run_command',
    )).toBeNull()
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: { allowCommands: true } },
      'run_command',
    )).toBeNull()
  })

  it('blocks run_subagent only when allowSubagents is explicitly false', () => {
    const base = { sessionId: 's1', activeCommandName: 'review' }
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: { allowSubagents: false } },
      'run_subagent',
    )).toBe('Command /review does not allow running subagents.')
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: {} },
      'run_subagent',
    )).toBeNull()
  })

  it('blocks file edits and global-memory edits only when allowEdit is explicitly false', () => {
    const base = { sessionId: 's1', activeCommandName: 'review' }
    for (const toolName of ['write_file', 'edit_file']) {
      expect(commandToolPermissionError(
        { ...base, activeCommandPermissions: { allowEdit: false } },
        toolName,
      )).toBe('Command /review does not allow editing files.')
    }
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: { allowEdit: false } },
      'manage_global_memory',
    )).toBe('Command /review does not allow editing global memory.')
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: {} },
      'write_file',
    )).toBeNull()
    expect(commandToolPermissionError(
      { ...base, activeCommandPermissions: {} },
      'manage_global_memory',
    )).toBeNull()
  })

  it('keeps the plan whitelist ahead of explicit run_subagent permissions', () => {
    // run_subagent is plan-whitelisted, so under /plan it falls through to the
    // allowSubagents === false check.
    const session = { sessionId: 's1', activeCommandName: 'plan', activeCommandPermissions: { allowSubagents: false } }
    expect(commandToolPermissionError(session, 'run_subagent'))
      .toBe('Command /plan does not allow running subagents.')
    const permissivePlan = { sessionId: 's1', activeCommandName: 'plan', activeCommandPermissions: {} }
    expect(commandToolPermissionError(permissivePlan, 'run_subagent')).toBeNull()
  })

  it('createCommandToolPermissions returns a session-bound checker', () => {
    const session = { sessionId: 's1', activeCommandName: 'plan', activeCommandPermissions: planPermissions }
    const check = createCommandToolPermissions(session)
    expect(check('write_file')).toBe('Command /plan is read-only and cannot use write_file.')
    expect(check('read_file')).toBeNull()
  })
})
