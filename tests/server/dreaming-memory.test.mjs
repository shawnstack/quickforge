import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DREAMING_SECTION_BEGIN,
  DREAMING_SECTION_END,
  composeMemoryDocument,
  globalMemoryFilePath,
  readGlobalMemory,
  splitMemorySections,
  writeDreamingMemorySection,
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

describe('MEMORY.md dreaming section', () => {
  it('appends an auto section without touching manual bytes', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingMemorySection('## 自动记忆\n\n- [fact] 使用 SQLite FTS5', { dataDir, allowSensitive: true })
    const { markdown } = await readGlobalMemory({ dataDir })
    expect(markdown.startsWith(MANUAL.trimEnd())).toBe(true)
    expect(markdown).toContain(DREAMING_SECTION_BEGIN)
    expect(markdown).toContain(DREAMING_SECTION_END)
    const sections = splitMemorySections(markdown)
    expect(sections.manual.trim()).toBe(MANUAL.trim())
    expect(sections.auto).toContain('SQLite FTS5')
  })

  it('rewrites the auto section in place on a second pass', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingMemorySection('- first pass', { dataDir, allowSensitive: true })
    await writeDreamingMemorySection('- second pass', { dataDir, allowSensitive: true })
    const sections = splitMemorySections((await readGlobalMemory({ dataDir })).markdown)
    expect(sections.auto).toBe('- second pass')
    expect(sections.manual.trim()).toBe(MANUAL.trim())
    expect((await readGlobalMemory({ dataDir })).markdown.match(/dreaming:auto:begin/g)).toHaveLength(1)
  })

  it('preserves manual edits made between runs', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingMemorySection('- auto one', { dataDir, allowSensitive: true })
    const withEdit = composeMemoryDocument(`${MANUAL}\n新增手工条目。`, '- auto one')
    await writeFile(globalMemoryFilePath(dataDir), withEdit, 'utf8')
    await writeDreamingMemorySection('- auto two', { dataDir, allowSensitive: true })
    const { markdown } = await readGlobalMemory({ dataDir })
    expect(markdown).toContain('新增手工条目。')
    expect(splitMemorySections(markdown).auto).toBe('- auto two')
  })

  it('removes the section when given empty content', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await writeDreamingMemorySection('- auto', { dataDir, allowSensitive: true })
    await writeDreamingMemorySection('', { dataDir, allowSensitive: true })
    const { markdown } = await readGlobalMemory({ dataDir })
    expect(markdown).not.toContain(DREAMING_SECTION_BEGIN)
    expect(markdown.trim()).toBe(MANUAL.trim())
  })

  it('refuses secrets when sensitive content is not allowed', async () => {
    await writeFile(globalMemoryFilePath(dataDir), MANUAL, 'utf8')
    await expect(writeDreamingMemorySection('- token: sk-abcdefghijklmnopqrstuv', { dataDir, allowSensitive: false }))
      .rejects.toThrow(/Sensitive/i)
    expect((await readFile(globalMemoryFilePath(dataDir), 'utf8')).trim()).toBe(MANUAL.trim())
  })

  it('caps the auto section size', async () => {
    await expect(writeDreamingMemorySection('x'.repeat(5000), { dataDir, allowSensitive: true }))
      .rejects.toThrow(/size limit/i)
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
