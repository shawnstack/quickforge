import { describe, expect, it } from 'vitest'
import {
  composeSubagentSystemPrompt,
  getSubagentDefinition,
} from '../../server/subagents.mjs'

describe('subagent definitions', () => {
  it('allows Explore to run safe inspection commands without file mutation tools', () => {
    const explore = getSubagentDefinition('explore')

    expect(explore.allowedTools).toContain('read_file')
    expect(explore.allowedTools).toContain('grep_files')
    expect(explore.allowedTools).toContain('run_command')
    expect(explore.allowedTools).not.toContain('write_file')
    expect(explore.allowedTools).not.toContain('edit_file')
    expect(explore.allowFileMutations).toBe(false)
  })

  it('does not give Explore conflicting command instructions', () => {
    const prompt = composeSubagentSystemPrompt({
      definition: getSubagentDefinition('explore'),
      parentSystemPrompt: '',
      projectContext: { project: { name: 'test-project' }, workspaceRoot: '/workspace' },
    })

    expect(prompt).toContain('Allowed tools: read_file, grep_files, run_command')
    expect(prompt).toContain('Use run_command only for safe inspection or diagnostic commands.')
    expect(prompt).not.toContain('Do not modify files or run commands.')
    expect(prompt).not.toContain('cannot modify files or run commands')
  })
})
