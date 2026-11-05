import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from '../../server/system-prompt.mjs'

describe('system prompt', () => {
  it('omits the removed implementation-minimalism instructions', () => {
    const prompt = composeSystemPrompt()

    expect(prompt).not.toContain('Prefer the simplest solution that satisfies the request')
    expect(prompt).not.toContain('Make surgical changes only')
    expect(prompt).not.toContain('Make minimal, focused changes')
  })

  it('omits the removed scope/style/visual/context-gathering instructions', () => {
    const prompt = composeSystemPrompt()

    expect(prompt).not.toContain('Do not refactor unrelated code')
    expect(prompt).not.toContain('Match existing style')
    expect(prompt).not.toContain('whether an SVG diagram can improve understanding')
    expect(prompt).not.toContain('gather sufficient context')
  })

  it('keeps the todo_write rule outside the project-task-only section', () => {
    const prompt = composeSystemPrompt()
    const todoRuleIndex = prompt.split('\n').findIndex((line) => line.startsWith('- When todo_write is available,'))
    const todoRule = prompt.split('\n')[todoRuleIndex]
    const todoRulePosition = prompt.indexOf(todoRule)
    const projectTasksIndex = prompt.indexOf('For project tasks:')

    expect(todoRuleIndex).toBeGreaterThanOrEqual(0)
    expect(projectTasksIndex).toBeGreaterThan(todoRulePosition)
    expect(prompt.slice(projectTasksIndex)).not.toContain(todoRule)
    expect(prompt.match(/When todo_write is available/g)).toHaveLength(1)
    expect(prompt).not.toContain('For multi-step work, use a brief plan.')
    expect(todoRule).toContain('Before finishing, re-check the todos against what was actually done')
    expect(todoRule).toContain('send a final updated snapshot')
    expect(todoRule).toContain('no stale pending or in_progress items remain')
  })

  it('exempts explicitly authorized /goal execution from repeated confirmation without bypassing planning or safety gates', () => {
    const prompt = composeSystemPrompt()
    const confirmationRule = prompt.split('\n').find((line) => line.startsWith('- Before taking action, confirm with the user.'))
    expect(confirmationRule).toContain('Exception: an explicit /goal request authorizes automatic execution within that goal\'s scope')
    expect(confirmationRule).toContain('do not ask for plan confirmation again')
    expect(confirmationRule).toContain('only after the read-only planning turn ends normally and durable persistence succeeds')
    expect(confirmationRule).toContain('Still ask necessary questions for ambiguous requirements')
    expect(confirmationRule).toContain('do not bypass tool approvals or safety boundaries')
    expect(prompt).toContain('Do not assume requirements. If ambiguous, state assumptions or ask.')
  })

  it('agent approval hook explicitly exempts todo_write and goal_report without classifying them as safe reads', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../server/agent-manager.mjs', import.meta.url), 'utf8'))
    expect(source).toContain("if (toolName === 'ask_user' || toolName === 'todo_write' || toolName === 'goal_report') return undefined")
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

    expect(prompt).toContain('When possible, prefer running commands in the background: set run_command run_in_background to true')
    expect(prompt).toContain('task-notification arrives when it exits')
    expect(prompt).toContain('Do not background commands with shell syntax')
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
    expect(prompt).toContain('already included below as <global_user_memory>')
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
    // No content block when the document is empty; the policy text may still name the tag.
    expect(prompt).not.toContain('<global_user_memory source')
  })

  it('does not include memory context when memory is disabled', () => {
    const prompt = composeSystemPrompt({ globalMemory: null })
    expect(prompt).not.toContain('<memory_policy>')
    expect(prompt).not.toContain('<global_user_memory')
  })

  it('injects the working memory folder and the note rules when enabled', () => {
    const prompt = composeSystemPrompt({
      workingMemory: {
        enabled: true,
        path: '/tmp/qf/working-memory',
        prompt: 'One note per topic <the name is the summary>',
      },
    })

    expect(prompt).toContain('<working_memory>')
    expect(prompt).toContain('/tmp/qf/working-memory')
    expect(prompt).toContain("its file name is the note's summary in one sentence")
    expect(prompt).toContain('Reach it with the memory tools, not the workspace ones')
    expect(prompt).toContain('Open only the notes whose names look relevant')
    // The folder is outside the workspace, so the workspace tools cannot reach it
    // and the prompt has to say so — otherwise the model tries read_file.
    expect(prompt).toContain('read_file / write_file / edit_file cannot reach this folder')
    expect(prompt).toContain('Nothing is ever deleted here')
    // A finished task is the one cue that asks for a look back, and skipping is allowed.
    expect(prompt).toContain('When you feel a task is finished')
    expect(prompt).toContain('an empty folder is perfectly fine')
    expect(prompt).toContain('Never store passwords, keys, tokens, credentials, or sensitive file contents')
    // The note rules are embedded verbatim (escaped for the XML-ish block).
    expect(prompt).toContain('One note per topic &lt;the name is the summary&gt;')
    expect(prompt).not.toContain('<the name is the summary>')
  })

  it('keeps the working memory section out of the prompt while disabled', () => {
    const prompt = composeSystemPrompt({ workingMemory: null })
    expect(prompt).not.toContain('<working_memory>')
    expect(prompt).not.toContain('Working memory is a shared folder')
  })
})
