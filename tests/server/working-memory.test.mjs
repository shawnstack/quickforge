import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_WORKING_MEMORY_PROMPT,
  DEFAULT_WORKING_MEMORY_SETTINGS,
  MAX_WORKING_MEMORY_PROMPT_CHARS,
  WORKING_MEMORY_DISPLAY_PATH,
  WORKING_MEMORY_SETTINGS_KEY,
  ensureWorkingMemoryDir,
  getWorkingMemoryRevision,
  normalizeWorkingMemorySettings,
  readWorkingMemoryDocument,
  readWorkingMemoryPrompt,
  saveWorkingMemorySettings,
  workingMemoryDir,
} from '../../server/working-memory.mjs'

const tempDirs = []

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-working-memory-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('working memory settings', () => {
  it('is off by default and ships the plain-language note prompt', () => {
    expect(DEFAULT_WORKING_MEMORY_SETTINGS.enabled).toBe(false)
    expect(normalizeWorkingMemorySettings(undefined)).toEqual({
      enabled: false,
      prompt: DEFAULT_WORKING_MEMORY_PROMPT,
    })
    // The default prompt is a colloquial rewrite, not the compaction summary prompt,
    // and it states principles instead of a fixed section template.
    expect(DEFAULT_WORKING_MEMORY_PROMPT).toContain('plain words, short lines')
    expect(DEFAULT_WORKING_MEMORY_PROMPT).toContain('One note per topic')
    expect(DEFAULT_WORKING_MEMORY_PROMPT).toContain('The first line is the summary and also the file name')
    expect(DEFAULT_WORKING_MEMORY_PROMPT).not.toContain('Compact Conversation Summary')
    expect(DEFAULT_WORKING_MEMORY_PROMPT).not.toContain('## 下一步')
  })

  it('only enables on an explicit boolean true', () => {
    expect(normalizeWorkingMemorySettings({ enabled: true }).enabled).toBe(true)
    expect(normalizeWorkingMemorySettings({ enabled: 'true' }).enabled).toBe(false)
    expect(normalizeWorkingMemorySettings({ enabled: false }).enabled).toBe(false)
    expect(normalizeWorkingMemorySettings([])).toEqual({ enabled: false, prompt: DEFAULT_WORKING_MEMORY_PROMPT })
  })

  it('trims and caps the editable prompt, falling back to the default when empty', () => {
    expect(normalizeWorkingMemorySettings({ enabled: true, prompt: '  写短点  ' }).prompt).toBe('写短点')
    expect(normalizeWorkingMemorySettings({ enabled: true, prompt: '   ' }).prompt).toBe(DEFAULT_WORKING_MEMORY_PROMPT)
    expect(normalizeWorkingMemorySettings({ enabled: true, prompt: 42 }).prompt).toBe(DEFAULT_WORKING_MEMORY_PROMPT)
    const long = 'A'.repeat(MAX_WORKING_MEMORY_PROMPT_CHARS + 50)
    expect(normalizeWorkingMemorySettings({ enabled: true, prompt: long }).prompt).toHaveLength(MAX_WORKING_MEMORY_PROMPT_CHARS)
  })

  it('exposes the shared settings key and display path used by the settings tab', () => {
    expect(WORKING_MEMORY_SETTINGS_KEY).toBe('working-memory-settings')
    expect(WORKING_MEMORY_DISPLAY_PATH).toBe('~/.quickforge/working-memory')
  })
})

describe('working memory prompt payload', () => {
  it('returns null while disabled', async () => {
    await expect(readWorkingMemoryPrompt({ settings: { enabled: false, prompt: 'x' } })).resolves.toBeNull()
  })

  it('returns the absolute folder plus the editable rules when enabled', async () => {
    const dataDir = await createTempDir()
    const payload = await readWorkingMemoryPrompt({
      dataDir,
      settings: { enabled: true, prompt: '一个文件一件事' },
    })

    expect(payload).toEqual({
      enabled: true,
      path: workingMemoryDir({ dataDir }),
      displayPath: WORKING_MEMORY_DISPLAY_PATH,
      prompt: '一个文件一件事',
    })
    expect(path.isAbsolute(payload.path)).toBe(true)
  })

  it('keeps the note prompt out of the settings payload', async () => {
    const document = await readWorkingMemoryDocument({ settings: { enabled: true, prompt: '自定义' } })
    expect(document).toEqual({ enabled: true, path: WORKING_MEMORY_DISPLAY_PATH })
    expect(document).not.toHaveProperty('prompt')
    expect(document).not.toHaveProperty('defaultPrompt')
  })

  it('saves the switch while preserving the engineer-only prompt override', async () => {
    const dataDir = await createTempDir()
    let written = null
    const saved = await saveWorkingMemorySettings({ enabled: true }, {
      dataDir,
      settings: { enabled: false, prompt: '自定义' },
      writeSettings: async (next) => { written = next },
    })

    expect(saved).toEqual({ enabled: true, prompt: '自定义' })
    expect(written).toEqual({ enabled: true, prompt: '自定义' })
    await expect(fs.stat(workingMemoryDir({ dataDir }))).resolves.toBeDefined()
  })

  it('changes the revision when the switch or the prompt changes', async () => {
    const base = await getWorkingMemoryRevision({ settings: { enabled: true, prompt: 'a' } })
    const same = await getWorkingMemoryRevision({ settings: { enabled: true, prompt: 'a' } })
    const otherPrompt = await getWorkingMemoryRevision({ settings: { enabled: true, prompt: 'b' } })
    const disabled = await getWorkingMemoryRevision({ settings: { enabled: false, prompt: 'a' } })

    expect(base).toBe(same)
    expect(otherPrompt).not.toBe(base)
    expect(disabled).not.toBe(base)
  })
})

describe('working memory folder', () => {
  it('creates the folder lazily under the QuickForge data directory', async () => {
    const dataDir = await createTempDir()
    const dir = await ensureWorkingMemoryDir({ dataDir })

    expect(dir).toBe(path.join(dataDir, 'working-memory'))
    await expect(fs.stat(dir)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })
})
