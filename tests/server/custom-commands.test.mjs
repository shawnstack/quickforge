import { describe, expect, it } from 'vitest'
import {
  commandFromFile,
  formatCommandList,
  formatHelpText,
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

  it('parses /plan with a task', () => {
    expect(parseInternalCommandInvocation('/plan implement feature')).toEqual({
      type: 'plan',
      args: 'implement feature',
    })
  })

  it('requires a task for /plan', async () => {
    await expect(handleInternalCommand({ type: 'plan', args: '' }, process.cwd(), '')).resolves.toBe('Usage: /plan <task>')
  })

  it('handles /plan with a task', async () => {
    await expect(handleInternalCommand({ type: 'plan', args: 'implement feature' }, process.cwd(), '')).resolves.toEqual({
      plan: true,
      args: 'implement feature',
    })
  })

  it('parses /summary with arguments', () => {
    expect(parseInternalCommandInvocation('/summary keep=2')).toEqual({
      type: 'summary',
      args: 'keep=2',
    })
  })

  it('handles /summary as the new-chat summary command', async () => {
    await expect(handleInternalCommand({ type: 'summary', args: 'keep=2' }, process.cwd(), '')).resolves.toEqual({
      summary: true,
      args: 'keep=2',
    })
  })

  it('parses /compact as the in-place compaction command', () => {
    expect(parseInternalCommandInvocation('/compact')).toEqual({ type: 'compact', args: '' })
  })

  it('handles /compact as the in-place compaction command', async () => {
    await expect(handleInternalCommand({ type: 'compact', args: '' }, process.cwd(), '')).resolves.toEqual({
      compact: true,
      args: '',
    })
  })

  it('allows subagents but blocks edits and commands for /plan permission state', () => {
    const session = {
      activeCommandName: 'plan',
      activeCommandPermissions: { allowEdit: false, allowCommands: false, allowSubagents: true },
    }

    expect(commandToolPermissionError(session, 'read_file')).toBeNull()
    expect(commandToolPermissionError(session, 'grep_files')).toBeNull()
    expect(commandToolPermissionError(session, 'activate_skill')).toBeNull()
    expect(commandToolPermissionError(session, 'read_skill_resource')).toBeNull()
    expect(commandToolPermissionError(session, 'run_subagent')).toBeNull()
    expect(commandToolPermissionError(session, 'run_command')).toBe('Command /plan is read-only and cannot use run_command.')
    expect(commandToolPermissionError(session, 'edit_file')).toBe('Command /plan is read-only and cannot use edit_file.')
    expect(commandToolPermissionError(session, 'write_file')).toBe('Command /plan is read-only and cannot use write_file.')
    expect(commandToolPermissionError(session, 'plugin__example__mutate')).toBe('Command /plan is read-only and cannot use plugin__example__mutate.')
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

describe('/help command', () => {
  it('parses /help', () => {
    expect(parseInternalCommandInvocation('/help')).toEqual({ type: 'help' })
  })

  it('parses /? as an alias for /help', () => {
    expect(parseInternalCommandInvocation('/?')).toEqual({ type: 'help' })
  })

  it('parses /help with trailing arguments', () => {
    expect(parseInternalCommandInvocation('/help plan')).toEqual({ type: 'help' })
  })

  it('returns help text containing built-in commands', async () => {
    const result = await handleInternalCommand({ type: 'help' }, null, '')
    expect(typeof result).toBe('string')
    expect(result).toContain('QuickForge command reference')
    expect(result).toContain('`/plan [task]`')
    expect(result).toContain('`/review [scope]`')
    expect(result).toContain('`/summary`')
    expect(result).toContain('`/compact`')
    expect(result).toContain('`/clear`')
    expect(result).toContain('`/help`')
    expect(result).toContain('`/command new <name>`')
  })

  it('includes permission notes for plan and review', async () => {
    const result = await handleInternalCommand({ type: 'help' }, null, '')
    expect(result).toContain('read-only')
    expect(result).toContain('no edits')
  })

  it('shows the /? alias in the output', async () => {
    const result = await handleInternalCommand({ type: 'help' }, null, '')
    expect(result).toContain('alias: /?')
  })
})

describe('/commands (list)', () => {
  it('parses /commands', () => {
    expect(parseInternalCommandInvocation('/commands')).toEqual({ type: 'list' })
  })

  it('works without a project (user-level commands are global)', async () => {
    const result = await handleInternalCommand({ type: 'list' }, null, '')
    expect(typeof result).toBe('string')
  })
})

describe('formatHelpText', () => {
  it('includes built-in commands section when no custom commands exist', () => {
    const text = formatHelpText([])
    expect(text).toContain('Built-in commands:')
    expect(text).toContain('`/plan [task]`')
    expect(text).toContain('No custom commands found')
  })

  it('includes custom commands section when commands exist', () => {
    const commands = [
      { name: 'deploy', description: 'Deploy the app', argumentHint: '[env]', allowEdit: false, allowCommands: true },
    ]
    const text = formatHelpText(commands)
    expect(text).toContain('Built-in commands:')
    expect(text).toContain('Custom commands:')
    expect(text).toContain('`/deploy [env]`')
  })
})

describe('formatCommandList', () => {
  it('shows empty guidance when no commands', () => {
    const text = formatCommandList([])
    expect(text).toContain('No custom commands found.')
    expect(text).toContain('~/.quickforge/commands/')
  })

  it('lists commands with permissions', () => {
    const commands = [
      { name: 'lint', description: 'Run linter', argumentHint: '', allowEdit: false, allowCommands: true },
    ]
    const text = formatCommandList(commands)
    expect(text).toContain('`/lint`')
    expect(text).toContain('allow_edit=false')
    expect(text).toContain('allow_commands=true')
  })
})

describe('commandFromFile', () => {
  it('parses frontmatter and body', () => {
    const file = '/tmp/test-cmd.md'
    const text = `---
name: deploy
description: Deploy the project
argument-hint: "[environment]"
allow_edit: false
allow_commands: true
---

Deploy steps:
$ARGUMENTS
`
    const command = commandFromFile(file, text)
    expect(command).not.toBeNull()
    expect(command.name).toBe('deploy')
    expect(command.description).toBe('Deploy the project')
    expect(command.argumentHint).toBe('[environment]')
    expect(command.allowEdit).toBe(false)
    expect(command.allowCommands).toBe(true)
    expect(command.body).toContain('Deploy steps:')
  })

  it('falls back to filename for name when metadata is absent', () => {
    const command = commandFromFile('/tmp/my-command.md', 'Just a body')
    expect(command).not.toBeNull()
    expect(command.name).toBe('my-command')
  })

  it('defaults allowEdit and allowCommands to undefined when not declared', () => {
    const command = commandFromFile('/tmp/cmd.md', '---\ndescription: test\n---\nbody')
    expect(command).not.toBeNull()
    expect(command.allowEdit).toBeUndefined()
    expect(command.allowCommands).toBeUndefined()
  })

  it('returns null for empty body', () => {
    const command = commandFromFile('/tmp/empty.md', '')
    expect(command).toBeNull()
  })
})
