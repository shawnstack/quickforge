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

  it('describes Explore as the preferred repository discovery subagent', () => {
    const explore = getSubagentDefinition('explore')
    const general = getSubagentDefinition('general')

    expect(explore.description).toContain('preferred subagent')
    expect(explore.description).toContain('file discovery')
    expect(explore.description).toContain('call-chain lookup')
    expect(explore.description).toContain('tests/docs/wiki discovery')
    expect(explore.description).toContain('impact analysis')
    expect(general.description).toContain('Prefer Explore for focused read-only repository discovery')
  })

  it('describes inherited capability tools dynamically and removes unavailable skills catalog', () => {
    const definition = getSubagentDefinition('explore')
    const disabled = composeSubagentSystemPrompt({ definition, parentSystemPrompt: '<available_skills>fake</available_skills>', effectiveAllowedTools: definition.allowedTools })
    expect(disabled).not.toContain('fake')
    const enabled = composeSubagentSystemPrompt({ definition, parentSystemPrompt: '<available_skills>real</available_skills>', effectiveAllowedTools: [...definition.allowedTools, 'mcp__server__tool', 'activate_skill'] })
    expect(enabled).toContain('real')
    expect(enabled).toContain('mcp__server__tool')
    expect(enabled).toContain('MCP tools inherited from the parent session')
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

  it('constrains Explore systemPrompt to evidence-only research without solutioning', () => {
    const explore = getSubagentDefinition('explore')
    const prompt = explore.systemPrompt

    expect(prompt).toContain('repository evidence')
    expect(prompt).toContain('Do not design solutions or propose implementation, architecture, refactoring, or code changes')
    expect(prompt).toContain('verified facts, reasonable inferences, and unknowns')
    expect(prompt).toContain('never present an inference as a verified fact')
    expect(prompt).toContain('do not provide an implementation plan, recommendations, or suggested next steps')
  })
})
