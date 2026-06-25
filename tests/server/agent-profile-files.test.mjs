import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentProfileFromMarkdown, loadFileAgentProfiles } from '../../server/agent-profile-files.mjs'

const tempDirs = []

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qf-agent-profiles-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('file-based agent profiles', () => {
  it('parses Markdown frontmatter into an Agent Profile', () => {
    const profile = agentProfileFromMarkdown('/workspace/.claude/agents/checker.md', `---
name: checker
label: Checker
description: Run validation checks
tools: Read, Grep, Bash
enabled-as-subagent: true
max-runtime-ms: 60000
max-tool-calls: 12
---
Run all checks and report failures.
`)

    expect(profile).toMatchObject({
      id: 'file:checker',
      name: 'checker',
      label: 'Checker',
      description: 'Run validation checks',
      allowedTools: ['read_file', 'grep_files', 'run_command'],
      enabledAsSubagent: true,
      maxRuntimeMs: 60000,
      maxToolCalls: 12,
      readonly: true,
      source: 'file',
    })
    expect(profile.systemPrompt).toBe('Run all checks and report failures.')
    expect(profile.allowFileMutations).toBe(false)
  })

  it('maps mutation tool aliases and marks file mutations as allowed', () => {
    const profile = agentProfileFromMarkdown('/workspace/.quickforge/agents/builder.md', `---
description: Build the requested change
tools: Read, Edit, Write, Bash
---
Implement focused changes.
`)

    expect(profile.name).toBe('builder')
    expect(profile.allowedTools).toEqual(['read_file', 'edit_file', 'write_file', 'run_command'])
    expect(profile.allowFileMutations).toBe(true)
  })

  it('does not load file agents with reserved builtin names', () => {
    const profile = agentProfileFromMarkdown('/workspace/.claude/agents/explore.md', `---
description: Attempt to override Explore
---
Override.
`, { reservedNames: new Set(['general', 'explore']) })

    expect(profile).toBeNull()
  })

  it('loads project file agents after user agents so project definitions win', async () => {
    const root = await tempDir()
    await mkdir(path.join(root, '.claude', 'agents'), { recursive: true })
    await mkdir(path.join(root, '.quickforge', 'agents'), { recursive: true })
    await writeFile(path.join(root, '.claude', 'agents', 'reviewer.md'), `---
description: Claude reviewer
---
Claude instructions.
`)
    await writeFile(path.join(root, '.quickforge', 'agents', 'reviewer.md'), `---
description: QuickForge reviewer
---
QuickForge instructions.
`)

    const profiles = await loadFileAgentProfiles(root)
    const reviewer = profiles.find((profile) => profile.name === 'reviewer')

    expect(reviewer.description).toBe('QuickForge reviewer')
    expect(reviewer.source).toBe('project')
    expect(reviewer.relativePath).toBe('.quickforge/agents/reviewer.md')
  })
})
