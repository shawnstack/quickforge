import { describe, expect, it } from 'vitest'
import {
  handleInternalCommand,
  parseInternalCommandInvocation,
} from '../../server/custom-commands.mjs'
import { commandToolPermissionError } from '../../server/approval-store.mjs'

describe('internal slash commands', () => {
  it('parses /review without arguments', () => {
    expect(parseInternalCommandInvocation('/review')).toEqual({ type: 'review', args: '' })
  })

  it('parses /review with a scope', () => {
    expect(parseInternalCommandInvocation('/review staged changes only')).toEqual({
      type: 'review',
      args: 'staged changes only',
    })
  })

  it('handles /review as a project-only internal command', async () => {
    await expect(handleInternalCommand({ type: 'review', args: 'staged' }, process.cwd(), '')).resolves.toEqual({
      review: true,
      args: 'staged',
    })
  })

  it('requires an active project for /review', async () => {
    await expect(handleInternalCommand({ type: 'review', args: '' }, null, '')).resolves.toBe('Review requires an active project chat.')
  })

  it('allows subagents but blocks edits and commands for /plan permission state', () => {
    const session = {
      activeCommandName: 'plan',
      activeCommandPermissions: { allowEdit: false, allowCommands: false, allowSubagents: true },
    }

    expect(commandToolPermissionError(session, 'read_file')).toBeNull()
    expect(commandToolPermissionError(session, 'grep_files')).toBeNull()
    expect(commandToolPermissionError(session, 'run_subagent')).toBeNull()
    expect(commandToolPermissionError(session, 'run_command')).toBe('Command /plan does not allow running shell commands.')
    expect(commandToolPermissionError(session, 'edit_file')).toBe('Command /plan does not allow editing files.')
    expect(commandToolPermissionError(session, 'write_file')).toBe('Command /plan does not allow editing files.')
  })

  it('allows commands but blocks edits for /review permission state', () => {
    const session = {
      activeCommandName: 'review',
      activeCommandPermissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
    }

    expect(commandToolPermissionError(session, 'run_command')).toBeNull()
    expect(commandToolPermissionError(session, 'run_subagent')).toBe('Command /review does not allow running subagents.')
    expect(commandToolPermissionError(session, 'edit_file')).toBe('Command /review does not allow editing files.')
    expect(commandToolPermissionError(session, 'write_file')).toBe('Command /review does not allow editing files.')
  })
})
