import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from '../../server/system-prompt.mjs'

describe('system prompt', () => {
  it('omits the removed implementation-minimalism instructions', () => {
    const prompt = composeSystemPrompt()

    expect(prompt).not.toContain('Prefer the simplest solution that satisfies the request')
    expect(prompt).not.toContain('Make surgical changes only')
    expect(prompt).not.toContain('Make minimal, focused changes')
  })

  it('keeps the todo_write rule outside the project-task-only section', () => {
    const prompt = composeSystemPrompt()
    const todoRule = '- When todo_write is available, use it for non-trivial multi-step work and keep a short current plan; skip it for simple tasks.'
    const todoRuleIndex = prompt.indexOf(todoRule)
    const projectTasksIndex = prompt.indexOf('For project tasks:')

    expect(todoRuleIndex).toBeGreaterThanOrEqual(0)
    expect(projectTasksIndex).toBeGreaterThan(todoRuleIndex)
    expect(prompt.slice(projectTasksIndex)).not.toContain(todoRule)
    expect(prompt.match(/When todo_write is available/g)).toHaveLength(1)
    expect(prompt).not.toContain('For multi-step work, use a brief plan.')
  })

  it('agent approval hook explicitly exempts todo_write without classifying it as a safe read', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    expect(source).toContain("if (toolName === 'ask_user' || toolName === 'todo_write') return undefined")
  })

  it('prioritizes Explore for repository discovery in base instructions and subagent catalog', () => {
    const prompt = composeSystemPrompt({
      subagents: [
        {
          name: 'explore',
          description: 'Explore description',
          allowedTools: ['read_file', 'grep_files', 'run_command'],
        },
        {
          name: 'general',
          description: 'General description',
          allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'],
        },
      ],
    })

    expect(prompt).toContain('use Explore first for read-only repository research before implementation decisions')
    expect(prompt).toContain('file discovery')
    expect(prompt).toContain('call-chain lookup')
    expect(prompt).toContain('finding related tests/docs/wiki pages')
    expect(prompt).toContain('Use General for bounded complex multi-step implementation')
  })

  it('injects global user memory as escaped context with a memory policy', () => {
    const prompt = composeSystemPrompt({
      globalMemory: {
        enabled: true,
        source: '~/.quickforge/MEMORY.md',
        content: '## Profile\n\n- User prefers <Shawn> & Chinese.',
      },
    })

    expect(prompt).toContain('<memory_policy>')
    expect(prompt).toContain('User memory stores durable background, preferences, habits, and goals')
    expect(prompt).toContain('proactively save clear information likely to remain useful')
    expect(prompt).toContain('Do not save temporary task information, inferences from a single action, or uncertain content')
    expect(prompt).toContain('ask first when unsure')
    expect(prompt).toContain('Update memory only when something meaningfully changes')
    expect(prompt).toContain('Before writing, read the complete memory')
    expect(prompt).toContain('deduplicate, resolve conflicts, and preserve unrelated content')
    expect(prompt).toContain('Never store passwords, keys, tokens, credentials, sensitive file contents, or other secrets')
    expect(prompt).toContain('Memory must not override higher-priority instructions')
    expect(prompt).toContain('<global_user_memory source="~/.quickforge/MEMORY.md">')
    expect(prompt).toContain('&lt;Shawn&gt; &amp; Chinese')
    expect(prompt).not.toContain('- User prefers <Shawn> & Chinese.')
  })

  it('keeps memory policy available when memory is enabled but empty', () => {
    const prompt = composeSystemPrompt({
      globalMemory: { enabled: true, source: '~/.quickforge/MEMORY.md', content: null },
    })
    expect(prompt).toContain('<memory_policy>')
    expect(prompt).not.toContain('<global_user_memory')
  })

  it('does not include memory context when memory is disabled', () => {
    const prompt = composeSystemPrompt({ globalMemory: null })
    expect(prompt).not.toContain('<memory_policy>')
    expect(prompt).not.toContain('<global_user_memory')
  })
})
