import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DREAMING_NOTES_FILE_NAME,
  dreamingNotesFilePath,
  globalMemoryFilePath,
  readDreamingNotes,
  readDreamingNotesPrompt,
  readGlobalMemory,
  readGlobalMemoryDocument,
  saveGlobalMemoryDocument,
  writeDreamingNotes,
} from '../../server/global-memory.mjs'
import {
  DEFAULT_DREAMING_SETTINGS,
  normalizeDreamingSettings,
} from '../../server/dreaming/settings.mjs'
import { computeWindow, nextScheduledRunAt } from '../../server/dreaming/runner.mjs'

let dataDir

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'qf-dreaming-memory-'))
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const MANUAL = '# 我的记忆\n\n我主要使用中文沟通。\n'

describe('two memory files', () => {
  it('writes Dreaming notes to their own file and leaves MEMORY.md byte-identical', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingNotes('## 记忆笔记\n\n- [fact] 使用 SQLite', { dataDir, allowSensitive: true })

    // The human file is untouched: no markers, no spliced block.
    expect((await readGlobalMemory({ dataDir })).markdown).toBe(MANUAL)
    // The notes are in their own file, and that is what the return value points at.
    expect(await readDreamingNotes({ dataDir })).toContain('- [fact] 使用 SQLite')
    expect(dreamingNotesFilePath(dataDir).endsWith(DREAMING_NOTES_FILE_NAME)).toBe(true)
  })

  it('rewrites the notes file wholesale on a second pass', async () => {
    await writeDreamingNotes('- first pass', { dataDir, allowSensitive: true })
    await writeDreamingNotes('- second pass', { dataDir, allowSensitive: true })
    const notes = await readDreamingNotes({ dataDir })
    expect(notes).toContain('- second pass')
    expect(notes).not.toContain('- first pass')
  })

  it('treats empty notes as "delete the content", never as "keep the old version"', async () => {
    await writeDreamingNotes('- something durable', { dataDir, allowSensitive: true })
    const result = await writeDreamingNotes('', { dataDir, allowSensitive: true })
    expect(result.changed).toBe(true)
    expect((await readDreamingNotes({ dataDir })).trim()).toBe('')
  })

  it('reports no change when the notes are identical', async () => {
    await writeDreamingNotes('- same', { dataDir, allowSensitive: true })
    await expect(writeDreamingNotes('- same', { dataDir, allowSensitive: true })).resolves.toMatchObject({ changed: false })
  })

  it('refuses secrets unless sensitive content is explicitly allowed', async () => {
    await expect(writeDreamingNotes('- 令牌 sk-live-abcdefghijklmnopqrstuvwxyz', { dataDir, allowSensitive: false }))
      .rejects.toThrow(/Sensitive/)
    // With the setting on, the worker is allowed to store what it extracted.
    await expect(writeDreamingNotes('- 令牌 sk-live-abcdefghijklmnopqrstuvwxyz', { dataDir, allowSensitive: true }))
      .resolves.toMatchObject({ changed: true })
  })

  it('caps the notes file size', async () => {
    await expect(writeDreamingNotes(`- ${'x'.repeat(9000)}`, { dataDir, allowSensitive: true }))
      .rejects.toThrow(/size limit/)
  })

  it('returns both documents, with the notes read-only', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingNotes('- 一条笔记', { dataDir, allowSensitive: true })

    const document = await readGlobalMemoryDocument({ dataDir, enabled: true })
    expect(document.markdown).toBe(MANUAL)
    expect(document.dreaming).toContain('一条笔记')
    expect(document.path).toBe('~/.quickforge/MEMORY.md')
    expect(document.dreamingPath).toBe('~/.quickforge/DREAMING.md')
  })

  it('injects the notes as a separate prompt block', async () => {
    await expect(readDreamingNotesPrompt({ dataDir, enabled: true })).resolves.toMatchObject({ content: null })
    await writeDreamingNotes('- 一条笔记', { dataDir, allowSensitive: true })
    await expect(readDreamingNotesPrompt({ dataDir, enabled: true })).resolves.toMatchObject({
      source: '~/.quickforge/DREAMING.md',
      content: expect.stringContaining('一条笔记'),
    })
    await expect(readDreamingNotesPrompt({ dataDir, enabled: false })).resolves.toBeNull()
  })

  it('saves the human file without merging anything back in', async () => {
    await writeDreamingNotes('- 机器笔记', { dataDir, allowSensitive: true })
    const saved = await saveGlobalMemoryDocument('# 重写后的人工记忆', { dataDir, enabled: true })
    expect(saved.markdown).toBe('# 重写后的人工记忆')
    // Saving the human file cannot touch the notes, and vice versa.
    expect((await readDreamingNotes({ dataDir })).trim()).toBe('- 机器笔记')
  })

  it('keeps the notes file independent of the human file on disk', async () => {
    await saveGlobalMemoryDocument(MANUAL, { dataDir, enabled: true })
    await writeDreamingNotes('- 笔记', { dataDir, allowSensitive: true })
    const manualFile = await readFile(globalMemoryFilePath(dataDir), 'utf8')
    const notesFile = await readFile(dreamingNotesFilePath(dataDir), 'utf8')
    expect(manualFile).not.toContain('笔记')
    expect(notesFile).not.toContain('我的记忆')
  })
})

describe('dreaming settings', () => {
  it('defaults to disabled with a daily 03:00 schedule', () => {
    expect(normalizeDreamingSettings(null)).toEqual(DEFAULT_DREAMING_SETTINGS)
    expect(normalizeDreamingSettings(undefined).enabled).toBe(false)
    expect(normalizeDreamingSettings(undefined).allowSensitive).toBe(true)
  })

  it('defaults the content language to auto and rejects unknown values', () => {
    expect(normalizeDreamingSettings(null).contentLanguage).toBe('auto')
    expect(normalizeDreamingSettings({ contentLanguage: 'zh' }).contentLanguage).toBe('zh')
    expect(normalizeDreamingSettings({ contentLanguage: 'en' }).contentLanguage).toBe('en')
    expect(normalizeDreamingSettings({ contentLanguage: 'klingon' }).contentLanguage).toBe('auto')
  })

  it('normalizes the execute time and rejects bad values', () => {
    expect(normalizeDreamingSettings({ executeTime: '5:7' }).executeTime).toBe('05:07')
    expect(normalizeDreamingSettings({ executeTime: '99:99' }).executeTime).toBe('03:00')
    expect(normalizeDreamingSettings({ executeTime: 'nonsense' }).executeTime).toBe('03:00')
  })
})

describe('dreaming window', () => {
  it('starts at local midnight when there is no previous run', () => {
    const now = new Date('2026-10-27T15:30:00').getTime()
    const { periodFrom, periodTo } = computeWindow({ now, lastPeriodTo: null })
    const expected = new Date('2026-10-27T00:00:00').getTime()
    expect(periodFrom).toBe(expected)
    expect(periodTo).toBe(now)
  })

  it('resumes from the last completed run instead of re-scanning', () => {
    const now = new Date('2026-10-27T15:30:00').getTime()
    const last = new Date('2026-10-26T15:00:00').getTime()
    expect(computeWindow({ now, lastPeriodTo: last })).toEqual({ periodFrom: last, periodTo: now })
  })

  it('schedules the next daily run forward, never into the past', () => {
    const base = new Date('2026-10-27T03:00:00')
    const next = new Date(nextScheduledRunAt('03:00', base))
    expect(next.getTime()).toBeGreaterThan(base.getTime())
    expect(next.getDate()).toBe(28)
  })
})
