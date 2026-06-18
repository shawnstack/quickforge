import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from '../../server/system-prompt.mjs'

describe('system prompt', () => {
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
})
