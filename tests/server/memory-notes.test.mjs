import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXPERIENCE_INDEX_FILE_NAME,
  buildExperienceIndex,
  experiencesDir,
  listArchivedExperiences,
  listExperiences,
  moveExperience,
  readExperienceIndex,
  readExperiencesPrompt,
  stripIndexChrome,
  writeExperience,
} from '../../server/experiences.mjs'
import {
  MAX_NOTE_CONTENT_CHARS,
  NoteStoreError,
  normalizeNoteName,
  noteTitleOfName,
} from '../../server/note-store.mjs'
import {
  listWorkingMemoryNotes,
  moveWorkingMemoryNote,
  readWorkingMemoryNote,
  writeWorkingMemoryNote,
  workingMemoryDir,
} from '../../server/working-memory.mjs'

/**
 * The memory folders are plain files, so the rules that matter are the ones a
 * model cannot talk its way out of: name validation, no empty writes, no delete,
 * and an index that is derived rather than maintained.
 */

let directory

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'qf-memory-notes-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const options = () => ({ dataDir: directory })

const EXPERIENCE_BODY = (title, when) => `# ${title}

- 何时用：${when}
- 怎么做：看一眼就知道
- 坑：无
- 来源：工作记忆
- 候选技能：否
`

describe('note names', () => {
  it('appends the .md suffix and strips it for display', () => {
    expect(normalizeNoteName('构建失败先清 dist')).toBe('构建失败先清 dist.md')
    expect(normalizeNoteName('already.md')).toBe('already.md')
    expect(noteTitleOfName('already.md')).toBe('already')
  })

  it('rejects path separators, Windows-illegal characters and dot-leading names', () => {
    for (const name of ['a/b', 'a\\b', 'a:b', 'a?b', '.hidden', 'a..b', '']) {
      expect(() => normalizeNoteName(name), name).toThrow(NoteStoreError)
    }
  })
})

describe('working memory notes', () => {
  it('writes, lists and reads a note, using the heading as the title', async () => {
    await writeWorkingMemoryNote(options(), '构建先清 dist', '# 构建先清 dist\n\n删掉 dist 再 build。')
    const notes = await listWorkingMemoryNotes(options())
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ name: '构建先清 dist.md', heading: '构建先清 dist' })
    await expect(readWorkingMemoryNote(options(), '构建先清 dist')).resolves.toMatchObject({
      content: expect.stringContaining('删掉 dist 再 build'),
    })
  })

  it('refuses to erase a note by writing an empty body', async () => {
    await writeWorkingMemoryNote(options(), '一', '# 一\n\n原文')
    await expect(writeWorkingMemoryNote(options(), '一', '   ')).rejects.toThrow(/empty/i)
    await expect(readWorkingMemoryNote(options(), '一')).resolves.toMatchObject({
      content: expect.stringContaining('原文'),
    })
  })

  it('requires a title line and enforces the size cap', async () => {
    await expect(writeWorkingMemoryNote(options(), '无标题', '正文')).rejects.toThrow(/# title/)
    await expect(writeWorkingMemoryNote(options(), '过长', `# 过长\n\n${'字'.repeat(MAX_NOTE_CONTENT_CHARS)}`))
      .rejects.toThrow(/longer than/)
  })

  it('retires a note into _archive instead of deleting it', async () => {
    await writeWorkingMemoryNote(options(), '过时', '# 过时\n\n旧结论')
    await moveWorkingMemoryNote(options(), '过时', '_archive/过时')
    expect(await listWorkingMemoryNotes(options())).toHaveLength(0)
    const archived = await readFile(path.join(workingMemoryDir(options()), '_archive', '过时.md'), 'utf8')
    expect(archived).toContain('旧结论')
  })

  it('renames a note and refuses to overwrite the target', async () => {
    await writeWorkingMemoryNote(options(), '旧名', '# 旧名\n\n内容')
    await writeWorkingMemoryNote(options(), '已存在', '# 已存在\n\n另一个')
    await expect(moveWorkingMemoryNote(options(), '旧名', '已存在')).rejects.toThrow(/already exists/)
    await expect(moveWorkingMemoryNote(options(), '旧名', '更准的名字')).resolves.toMatchObject({ changed: true })
    expect((await listWorkingMemoryNotes(options())).map((note) => note.name))
      .toEqual(expect.arrayContaining(['更准的名字.md', '已存在.md']))
  })
})

describe('experience library', () => {
  it('builds the index from the files, not the other way round', async () => {
    await writeExperience(options(), '构建失败先清 dist', EXPERIENCE_BODY('构建失败先清 dist', '构建报奇怪的 chunk 错时'))
    await writeExperience(options(), '改配置前先备份', EXPERIENCE_BODY('改配置前先备份', '动 config 目录前'))

    const index = await readExperienceIndex(options())
    expect(index.entries).toHaveLength(2)
    expect(index.markdown).toContain('- 构建失败先清 dist —— 构建报奇怪的 chunk 错时')
    expect(index.markdown).toContain('- 改配置前先备份 —— 动 config 目录前')

    // The file on disk is a view of the folder, so a hand edit must not survive.
    await writeFile(path.join(experiencesDir(options()), EXPERIENCE_INDEX_FILE_NAME), 'stale', 'utf8')
    const rebuilt = await readExperienceIndex(options())
    expect(rebuilt.changed).toBe(true)
    expect(rebuilt.markdown).not.toBe('stale')
  })

  it('marks candidate skills with a star and never touches the skills folder', async () => {
    await writeExperience(options(), '可升级', '# 可升级\n\n- 何时用：某天\n- 候选技能：是')
    await writeExperience(options(), '不可升级', '# 不可升级\n\n- 何时用：另一天\n- 候选技能：否')
    const entries = await listExperiences(options())
    const star = entries.find((entry) => entry.title === '可升级')
    expect(star?.candidateSkill).toBe(true)
    expect(buildExperienceIndex(entries)).toContain('★ 可升级')
  })

  it('keeps the index bounded even when the folder is not', async () => {
    const entries = Array.from({ length: 210 }, (_, index) => ({
      name: `e${index}.md`,
      title: `经验 ${index}`,
      whenToUse: '总是',
      candidateSkill: false,
      chars: 40,
      updatedAt: 1000 + index,
    }))
    const markdown = buildExperienceIndex(entries)
    const bulletLines = markdown.split('\n').filter((line) => line.startsWith('- '))
    // 200 entries plus the "older ones not listed" footer line.
    expect(bulletLines).toHaveLength(201)
    expect(markdown).toContain('还有 10 条较旧的经验没进索引')
  })

  it('lets the full 200 lines through before the character cap bites', async () => {
    const entries = Array.from({ length: 200 }, (_, index) => ({
      name: `e${index}.md`,
      title: `经验 ${index}`,
      whenToUse: '遇到这个情况时'.padEnd(60, '照'),
      candidateSkill: false,
      chars: 40,
      updatedAt: 1000 + index,
    }))
    const markdown = buildExperienceIndex(entries)
    // The line cap is useless if the char cap truncates first: the oldest entry
    // (index 0 sorts last) has to survive intact.
    expect(markdown).toContain('- 经验 0 —— ')
    expect(markdown.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(200)
    expect(markdown.length).toBeLessThanOrEqual(20000)
  })

  it('returns null instead of an empty block when there is nothing to inject', async () => {
    await expect(readExperiencesPrompt(options())).resolves.toBeNull()
  })

  it('injects only the bullet lines, not the file title or its comments', () => {
    const markdown = '# 经验库索引\n\n<!-- 自动生成 -->\n\n- 一 —— 某天\n'
    expect(stripIndexChrome(markdown)).toBe('- 一 —— 某天')
  })

  it('gives the prompt the same pointer the file holds', async () => {
    await writeExperience(options(), '构建失败先清 dist', EXPERIENCE_BODY('构建失败先清 dist', '构建报错时'))
    const prompt = await readExperiencesPrompt(options())
    // The heading lives in the file for humans; the prompt pays only for the lines
    // the model can actually act on.
    expect(prompt.index).toBe('- 构建失败先清 dist —— 构建报错时')
    expect(prompt.index).not.toContain('经验库索引')
    expect(prompt.index).not.toContain('<!--')
  })

  it('renames and archives without ever deleting the text', async () => {
    await writeExperience(options(), '旧结论', '# 旧结论\n\n- 何时用：以前')
    await moveExperience(options(), '旧结论', '新结论')
    expect((await listExperiences(options())).map((entry) => entry.name)).toEqual(['新结论.md'])
    await moveExperience(options(), '新结论', '_archive/新结论')
    expect(await listExperiences(options())).toHaveLength(0)
    const archived = await listArchivedExperiences(options())
    expect(archived.map((note) => note.name)).toEqual(['新结论.md'])
  })

  it('does not list the generated index as an experience', async () => {
    await mkdir(experiencesDir(options()), { recursive: true })
    await writeFile(path.join(experiencesDir(options()), EXPERIENCE_INDEX_FILE_NAME), '# 索引\n', 'utf8')
    expect(await listExperiences(options())).toHaveLength(0)
  })
})
