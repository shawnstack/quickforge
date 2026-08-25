import { describe, expect, it } from 'vitest'
import {
  commandFromFile,
  formatAgentCommandPrompt,
  formatCommandList,
  formatHelpText,
  formatSkillCommandPrompt,
  handleInternalCommand,
  parseInternalCommandInvocation,
} from '../../server/custom-commands.mjs'
import { commandToolPermissionError, safeReadTools } from '../../server/approval-store.mjs'

describe('internal slash commands', () => {
  it('parses /init without arguments', () => {
    expect(parseInternalCommandInvocation('/init')).toEqual({ type: 'init' })
  })

  it('rejects arguments for /init', () => {
    expect(parseInternalCommandInvocation('/init overwrite')).toEqual({ type: 'invalid-init-args' })
  })

  it('handles /init as an internal workspace command', async () => {
    await expect(handleInternalCommand({ type: 'init' }, process.cwd(), '')).resolves.toEqual({ init: true })
  })

  it('requires an active workspace for /init', async () => {
    await expect(handleInternalCommand({ type: 'init' }, null, '')).resolves.toBe('Initialization requires an active project chat.')
  })

  it('returns usage guidance when /init receives arguments', async () => {
    await expect(handleInternalCommand({ type: 'invalid-init-args' }, process.cwd(), '')).resolves.toBe('Usage: /init')
  })

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

  it('parses /commit without a message', () => {
    expect(parseInternalCommandInvocation('/commit')).toEqual({ type: 'commit', args: '' })
  })

  it('parses /commit with a message', () => {
    expect(parseInternalCommandInvocation('/commit feat: add commit command')).toEqual({
      type: 'commit',
      args: 'feat: add commit command',
    })
  })

  it('handles /commit as a project-only internal command', async () => {
    await expect(handleInternalCommand({ type: 'commit', args: 'test message' }, process.cwd(), '')).resolves.toEqual({
      commit: true,
      args: 'test message',
    })
    await expect(handleInternalCommand({ type: 'commit', args: '' }, null, '')).resolves.toBe('Commit requires an active project chat.')
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

  it('parses /skill without arguments', () => {
    expect(parseInternalCommandInvocation('/skill')).toEqual({ type: 'skill', args: '' })
  })

  it('parses /skill with a name and task', () => {
    expect(parseInternalCommandInvocation('/skill skill-creator build a docs skill')).toEqual({
      type: 'skill',
      args: 'skill-creator build a docs skill',
    })
  })

  it('parses /skill case-insensitively and preserves inner whitespace', () => {
    expect(parseInternalCommandInvocation('  /SKILL   Skill-Creator  build it  ')).toEqual({
      type: 'skill',
      args: 'Skill-Creator  build it',
    })
  })

  it('does not match the plural /skills form', () => {
    expect(parseInternalCommandInvocation('/skills')).toBeNull()
    expect(parseInternalCommandInvocation('/skills list all')).toBeNull()
  })

  it('parses /agent with a name and task', () => {
    expect(parseInternalCommandInvocation('/agent explore inspect the repo')).toEqual({
      type: 'agent',
      args: 'explore inspect the repo',
    })
  })

  it('parses /agent without arguments case-insensitively', () => {
    expect(parseInternalCommandInvocation('/Agent')).toEqual({ type: 'agent', args: '' })
  })

  it('does not match the plural /agents form', () => {
    expect(parseInternalCommandInvocation('/agents')).toBeNull()
    expect(parseInternalCommandInvocation('/agents explore')).toBeNull()
  })

  it('formats the /skill prompt with activation instructions and the task', () => {
    const prompt = formatSkillCommandPrompt('skill-creator', 'build a docs skill')

    expect(prompt).toContain('<skill_invocation name="skill-creator" source="slash">')
    expect(prompt).toContain('First call the activate_skill tool with name="skill-creator"')
    expect(prompt).toContain('Task:\nbuild a docs skill')
    expect(prompt).toContain('</skill_invocation>')
  })

  it('falls back to a none-task marker for /skill without a task', () => {
    const prompt = formatSkillCommandPrompt('skill-creator', '')

    expect(prompt).toMatch(/Task:\n\(none [^\n]*ask the user[^\n]*\)\n/)
  })

  it('escapes XML in /skill prompt attributes', () => {
    const prompt = formatSkillCommandPrompt('a<b>&c', 'task text')

    expect(prompt.split('name="a&lt;b&gt;&amp;c"').length - 1).toBe(2)
    expect(prompt).toContain('task text')
  })

  it('formats the /agent prompt with run_subagent instructions and the task', () => {
    const prompt = formatAgentCommandPrompt('explore', 'find entry points')

    expect(prompt).toContain('<subagent_invocation name="explore" source="slash">')
    expect(prompt).toContain('Call the run_subagent tool with subagent="explore"')
    expect(prompt).toContain('Task:\nfind entry points')
    expect(prompt).toContain('</subagent_invocation>')
  })

  it('escapes XML in /agent prompt attributes', () => {
    const prompt = formatAgentCommandPrompt('x"&y', 'do the work')

    expect(prompt).toContain('name="x&quot;&amp;y"')
    expect(prompt).toContain('subagent="x&quot;&amp;y"')
    expect(prompt).toContain('do the work')
  })

  it('allows edits, commands, and subagents for /init permission state', () => {
    const session = {
      activeCommandName: 'init',
      activeCommandPermissions: { allowEdit: true, allowCommands: true, allowSubagents: true },
    }

    expect(commandToolPermissionError(session, 'read_file')).toBeNull()
    expect(commandToolPermissionError(session, 'run_subagent')).toBeNull()
    expect(commandToolPermissionError(session, 'run_command')).toBeNull()
    expect(commandToolPermissionError(session, 'edit_file')).toBeNull()
    expect(commandToolPermissionError(session, 'write_file')).toBeNull()
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
    expect(safeReadTools.has('todo_write')).toBe(false)
    expect(commandToolPermissionError(session, 'todo_write')).toBe('Command /plan is read-only and cannot use todo_write.')
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

  it('allows commands but blocks edits and subagents for /commit permission state', () => {
    const session = {
      activeCommandName: 'commit',
      activeCommandPermissions: { allowEdit: false, allowCommands: true, allowSubagents: false },
    }

    expect(commandToolPermissionError(session, 'run_command')).toBeNull()
    expect(commandToolPermissionError(session, 'run_subagent')).toBe('Command /commit does not allow running subagents.')
    expect(commandToolPermissionError(session, 'edit_file')).toBe('Command /commit does not allow editing files.')
    expect(commandToolPermissionError(session, 'write_file')).toBe('Command /commit does not allow editing files.')
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
    expect(result).toContain('`/init`')
    expect(result).toContain('`/plan [task]`')
    expect(result).toContain('`/review [scope]`')
    expect(result).toContain('`/commit [message]`')
    expect(result).toContain('`/summary`')
    expect(result).toContain('`/compact`')
    expect(result).toContain('`/clear`')
    expect(result).toContain('`/help`')
    expect(result).toContain('`/command new <name>`')
  })

  it('includes permission notes for plan, review, and commit', async () => {
    const result = await handleInternalCommand({ type: 'help' }, null, '')
    expect(result).toContain('read-only')
    expect(result).toContain('no edits')
    expect(result).toContain('commands allowed; no edits or subagents')
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
    expect(text).toContain('`/init`')
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
