import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// These tests cover the internally exported pure functions from tools/index.mjs
// and the tool handlers (toolReadFile, toolWriteFile, toolEditFile, etc.)
// using a real temporary directory as the workspace root.
// ---------------------------------------------------------------------------

// We need to import workspace functions to set up the workspace root for tests.
import {
  setWorkspaceRoot,
  getWorkspaceRoot,
} from '../../../server/utils/workspace.mjs'

import {
  toolHandlers,
} from '../../../server/tools/index.mjs'

import {
  loadProjectSkills,
  normalizeSkillNames,
  filterKnownProjectSkillNames,
} from '../../../server/skills.mjs'

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-test-'))
  return dir
}

function makeContext(workspaceRoot) {
  return { workspaceRoot, project: 'test-project' }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skills name normalization', () => {
  it('normalizes uppercase skill names to lowercase canonical names', () => {
    expect(normalizeSkillNames(['SDD', 'sdd', 'Agent-Plan'])).toEqual(['sdd', 'agent-plan'])
  })

  it('loads standard project skills with uppercase names and directories', async () => {
    const tmpDir = await createTempDir()
    try {
      const skillDir = path.join(tmpDir, '.quickforge', 'skills', 'SDD')
      await fs.mkdir(skillDir, { recursive: true })
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---\nname: SDD\ndescription: Software Design Document workflow.\nmetadata:\n  displayName: SDD\n---\nUse SDD instructions.\n`,
        'utf8',
      )

      const skills = await loadProjectSkills(tmpDir)
      expect(skills).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'sdd', displayName: 'SDD' }),
      ]))
      await expect(filterKnownProjectSkillNames(['SDD'], tmpDir)).resolves.toEqual(['sdd'])
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('toolReadFile', () => {
  let tmpDir
  let context

  beforeAll(async () => {
    tmpDir = await createTempDir()
    context = makeContext(tmpDir)
    setWorkspaceRoot(tmpDir)
    await fs.writeFile(path.join(tmpDir, 'hello.txt'), 'line1\nline2\nline3\nline4\nline5', 'utf8')
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('reads the full file with default offset and limit', async () => {
    const result = await toolHandlers.read_file({ path: 'hello.txt' }, context)
    expect(result.content).toContain('line1')
    expect(result.content).toContain('line5')
    expect(result.details.totalLines).toBe(5)
    expect(result.details.path).toBe('hello.txt')
  })

  it('reads with offset', async () => {
    const result = await toolHandlers.read_file({ path: 'hello.txt', offset: 3 }, context)
    expect(result.content).toContain('3: line3')
    expect(result.content).not.toContain('1: line1')
  })

  it('reads with limit', async () => {
    const result = await toolHandlers.read_file({ path: 'hello.txt', limit: 2 }, context)
    expect(result.content).toContain('1: line1')
    expect(result.content).toContain('2: line2')
    expect(result.content).not.toContain('3: line3')
  })

  it('shows truncation notice when not all lines are shown', async () => {
    const result = await toolHandlers.read_file({ path: 'hello.txt', limit: 2 }, context)
    expect(result.content).toContain('showing 2 of 5 lines')
  })

  it('throws for path outside workspace', async () => {
    await expect(
      toolHandlers.read_file({ path: '../../etc/passwd' }, context),
    ).rejects.toThrow()
  })
})

describe('toolWriteFile', () => {
  let tmpDir
  let context

  beforeAll(async () => {
    tmpDir = await createTempDir()
    context = makeContext(tmpDir)
    setWorkspaceRoot(tmpDir)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates a new file', async () => {
    const result = await toolHandlers.write_file(
      { path: 'new.txt', content: 'hello world' },
      context,
    )
    expect(result.content).toContain('Created')
    expect(result.details.created).toBe(true)

    const written = await fs.readFile(path.join(tmpDir, 'new.txt'), 'utf8')
    expect(written).toBe('hello world')
  })

  it('overwrites an existing file', async () => {
    await fs.writeFile(path.join(tmpDir, 'existing.txt'), 'old', 'utf8')
    const result = await toolHandlers.write_file(
      { path: 'existing.txt', content: 'new' },
      context,
    )
    expect(result.content).toContain('Wrote')
    expect(result.details.created).toBe(false)

    const written = await fs.readFile(path.join(tmpDir, 'existing.txt'), 'utf8')
    expect(written).toBe('new')
  })

  it('creates parent directories automatically', async () => {
    await toolHandlers.write_file(
      { path: 'deep/nested/dir/file.txt', content: 'nested' },
      context,
    )
    const written = await fs.readFile(path.join(tmpDir, 'deep', 'nested', 'dir', 'file.txt'), 'utf8')
    expect(written).toBe('nested')
  })

  it('reports diff with added lines', async () => {
    const result = await toolHandlers.write_file(
      { path: 'diff-test.txt', content: 'new line\n' },
      context,
    )
    expect(result.details.diff).toBeDefined()
    expect(result.details.diff.addedLines).toBeGreaterThanOrEqual(0)
  })
})

describe('toolEditFile', () => {
  let tmpDir
  let context

  beforeAll(async () => {
    tmpDir = await createTempDir()
    context = makeContext(tmpDir)
    setWorkspaceRoot(tmpDir)
    await fs.writeFile(path.join(tmpDir, 'edit.txt'), 'hello world\nfoo bar\nbaz\n', 'utf8')
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('replaces a unique substring', async () => {
    const result = await toolHandlers.edit_file(
      { path: 'edit.txt', oldText: 'foo bar', newText: 'FOO BAR' },
      context,
    )
    expect(result.content).toContain('Edited')

    const written = await fs.readFile(path.join(tmpDir, 'edit.txt'), 'utf8')
    expect(written).toContain('FOO BAR')
    expect(written).not.toContain('foo bar')
  })

  it('throws when oldText has zero matches', async () => {
    await expect(
      toolHandlers.edit_file(
        { path: 'edit.txt', oldText: 'nonexistent', newText: 'x' },
        context,
      ),
    ).rejects.toThrow('oldText must match exactly once; found 0 matches')
  })

  it('throws when oldText has multiple matches', async () => {
    await fs.writeFile(path.join(tmpDir, 'multi.txt'), 'aaa\naaa\naaa\n', 'utf8')
    await expect(
      toolHandlers.edit_file(
        { path: 'multi.txt', oldText: 'aaa', newText: 'bbb' },
        context,
      ),
    ).rejects.toThrow('oldText must match exactly once; found 3 matches')
  })

  it('handles single-line file edit', async () => {
    await fs.writeFile(path.join(tmpDir, 'single.txt'), 'only line', 'utf8')
    const result = await toolHandlers.edit_file(
      { path: 'single.txt', oldText: 'only', newText: 'the' },
      context,
    )
    expect(result.content).toContain('Edited')

    const written = await fs.readFile(path.join(tmpDir, 'single.txt'), 'utf8')
    expect(written).toBe('the line')
  })

  it('preserves CRLF line endings', async () => {
    await fs.writeFile(path.join(tmpDir, 'crlf.txt'), 'line1\r\nline2\r\n', 'utf8')
    await toolHandlers.edit_file(
      { path: 'crlf.txt', oldText: 'line1', newText: 'LINE1' },
      context,
    )
    const written = await fs.readFile(path.join(tmpDir, 'crlf.txt'), 'utf8')
    expect(written).toContain('\r\n')
  })

  it('throws for file that does not exist', async () => {
    await expect(
      toolHandlers.edit_file(
        { path: 'no-such-file.txt', oldText: 'x', newText: 'y' },
        context,
      ),
    ).rejects.toThrow()
  })
})

describe('toolGrepFiles — Node fallback', () => {
  let tmpDir
  let context

  beforeAll(async () => {
    tmpDir = await createTempDir()
    context = makeContext(tmpDir)
    setWorkspaceRoot(tmpDir)

    await fs.writeFile(path.join(tmpDir, 'app.js'), 'console.log("hello")\nfunction greet() {}\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'util.ts'), 'export function helper(): string { return "hi" }\n', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'nested'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'nested', 'deep.txt'), 'findme in nested\nother line\n', 'utf8')
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Force Node fallback by mocking resolveRipgrepExecutable to return null.
  // Since resolveRipgrepExecutable is module-scoped, we patch the module-level
  // cache via vi.mock. However, the function is not exported, so instead we
  // test grep via the handler and accept either ripgrep or node backend.
  it('finds matches across files', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'function', path: '.' },
      context,
    )
    // Both app.js and util.ts contain "function"
    expect(result.content).not.toBe('No matches found.')
    expect(result.details.count).toBeGreaterThan(0)
  })

  it('returns "No matches found." for no matches', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'zzz_nonexistent_pattern_zzz' },
      context,
    )
    expect(result.content).toBe('No matches found.')
  })

  it('respects caseSensitive=false by default', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'CONSOLE' },
      context,
    )
    // Should find console.log despite uppercase query
    expect(result.details.count).toBeGreaterThanOrEqual(1)
  })

  it('respects caseSensitive=true', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'CONSOLE', caseSensitive: true },
      context,
    )
    // Uppercase CONSOLE won't match lowercase console.log
    expect(result.content).toBe('No matches found.')
  })

  it('respects regex option', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'func.*\\(\\)', regex: true },
      context,
    )
    expect(result.details.count).toBeGreaterThanOrEqual(1)
  })

  it('throws on invalid regex', async () => {
    await expect(
      toolHandlers.grep_files({ query: '[invalid', regex: true }, context),
    ).rejects.toThrow('Invalid regular expression')
  })

  it('throws when query is empty', async () => {
    await expect(
      toolHandlers.grep_files({ query: '' }, context),
    ).rejects.toThrow('query is required')
  })

  it('supports filesWithMatches mode', async () => {
    const result = await toolHandlers.grep_files(
      { query: 'function', filesWithMatches: true },
      context,
    )
    expect(result.details.count).toBeGreaterThanOrEqual(1)
    // In filesWithMatches mode, content should contain file paths, not line content
    expect(result.content).toMatch(/\.\w+/)
  })
})

describe('toolActivateSkill', () => {
  it('activates skills with uppercase input names', async () => {
    const result = await toolHandlers.activate_skill(
      { name: 'SDD' },
      { globalSkills: [{ name: 'sdd', instructions: 'Use SDD instructions.' }] },
    )

    expect(result.details.skill).toBe('sdd')
    expect(result.content).toContain('Use SDD instructions.')
  })

  it('throws for unknown skill', async () => {
    await expect(
      toolHandlers.activate_skill({ name: 'nonexistent-skill' }, {}),
    ).rejects.toThrow('Unknown or disabled skill')
  })

  it('throws error with 404 status code', async () => {
    try {
      await toolHandlers.activate_skill({ name: 'nope' }, {})
    } catch (error) {
      expect(error.statusCode).toBe(404)
    }
  })
})

describe('toolReadSkillResource', () => {
  it('reads resources with uppercase input skill names', async () => {
    const tmpDir = await createTempDir()
    try {
      await fs.mkdir(path.join(tmpDir, 'references'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'references', 'guide.md'), 'resource content', 'utf8')

      const result = await toolHandlers.read_skill_resource(
        { skill: 'SDD', path: 'references/guide.md' },
        { globalSkills: [{ name: 'sdd', rootDir: tmpDir }] },
      )

      expect(result.details.skill).toBe('sdd')
      expect(result.content).toContain('resource content')
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })

  it('throws for unknown skill', async () => {
    await expect(
      toolHandlers.read_skill_resource({ skill: 'nope', path: 'readme.md' }, {}),
    ).rejects.toThrow('Unknown or disabled skill')
  })
})

describe('abortRunningCommand', () => {
  it('returns false for unknown toolCallId', async () => {
    // Dynamic import to get the function
    const { abortRunningCommand } = await import('../../../server/tools/index.mjs')
    expect(abortRunningCommand('nonexistent-id')).toBe(false)
  })

  it('returns false for empty toolCallId', async () => {
    const { abortRunningCommand } = await import('../../../server/tools/index.mjs')
    expect(abortRunningCommand('')).toBe(false)
  })
})
