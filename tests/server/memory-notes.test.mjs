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
    // Only the file name goes in: the name is the conclusion, and the description
    // would pay twice for the same sentence.
    expect(index.markdown).toContain('- 构建失败先清 dist')
    expect(index.markdown).toContain('- 改配置前先备份')
    expect(index.markdown).not.toContain('构建报奇怪的 chunk 错时')

    // The file on disk is a view of the folder, so a hand edit must not survive.
    await writeFile(path.join(experiencesDir(options()), EXPERIENCE_INDEX_FILE_NAME), 'stale', 'utf8')
    const rebuilt = await readExperienceIndex(options())
    expect(rebuilt.changed).toBe(true)
    expect(rebuilt.markdown).not.toBe('stale')
  })

  it('still reads the flags from notes written before front matter existed', async () => {
    await writeExperience(options(), '可升级', '# 可升级\n\n- 何时用：某天\n- 候选技能：是')
    await writeExperience(options(), '不可升级', '# 不可升级\n\n- 何时用：另一天\n- 候选技能：否')
    const entries = await listExperiences(options())
    const star = entries.find((entry) => entry.title === '可升级')
    expect(star?.candidateSkill).toBe(true)
    expect(star?.description).toBe('某天')
    expect(buildExperienceIndex(entries)).toContain('★ 可升级')
  })

  it('reads general and candidate_skill from front matter and marks special entries', async () => {
    await writeExperience(options(), '通用做法', `---
title: 通用做法
description: 任何项目都这么做时
general: true
candidate_skill: true
---

- 怎么做：照做
`)
    await writeExperience(options(), '本项目做法', `---
title: 本项目做法
description: 只在这个仓库成立
general: false
candidate_skill: false
---

- 怎么做：先改 src/app.ts 里那个函数
`)

    const entries = await listExperiences(options())
    const byTitle = Object.fromEntries(entries.map((entry) => [entry.title, entry]))
    expect(byTitle['通用做法']).toMatchObject({
      general: true,
      candidateSkill: true,
      description: '任何项目都这么做时',
    })
    expect(byTitle['本项目做法']).toMatchObject({ general: false, candidateSkill: false })

    const markdown = buildExperienceIndex(entries)
    expect(markdown).toContain('- ★ 通用做法')
    expect(markdown).toContain('- 本项目做法（特殊）')
    expect(markdown).not.toContain('只在这个仓库成立')
  })

  it('refuses to mark a special experience as a skill candidate', async () => {
    // Reading it as "not a candidate" would mean the file says one thing and every
    // reader sees another, so the write has to fail instead.
    await expect(writeExperience(options(), '特殊还想当技能', `---
title: 特殊还想当技能
general: false
candidate_skill: true
---

- 怎么做：x
`)).rejects.toThrow(/must also be `general: true`/)
    expect(await listExperiences(options())).toHaveLength(0)
  })

  it('reads 是 / 否 as booleans, because that is how the curator writes them', async () => {
    // `general: 否` read as "no value" would fall back to the general default and
    // quietly turn a special note into one nobody is warned about.
    await writeExperience(options(), '中文否', `---
title: 中文否
general: 否
---

- 怎么做：x
`)
    await writeExperience(options(), '英文否', `---
title: 英文否
general: no
---

- 怎么做：x
`)
    const entries = await listExperiences(options())
    const byTitle = Object.fromEntries(entries.map((entry) => [entry.title, entry]))
    expect(byTitle['中文否'].general).toBe(false)
    expect(byTitle['英文否'].general).toBe(false)
    expect(buildExperienceIndex(entries)).toContain('- 中文否（特殊）')
  })

  it('defaults to general when the header is missing or unreadable', async () => {
    // Unterminated front matter: the parser sees no header at all, so the note is
    // read the old way instead of failing the whole listing.
    await writeExperience(options(), '坏头部', '---\ntitle: 坏头部\ngeneral: false\n\n# 坏头部\n\n- 怎么做：x')
    const [entry] = await listExperiences(options())
    expect(entry).toMatchObject({ title: '坏头部', general: true })
    expect(buildExperienceIndex([entry])).toContain('- 坏头部')
    expect(buildExperienceIndex([entry])).not.toContain('- 坏头部（特殊）')
  })

  it('rejects a front matter title that disagrees with the file name', async () => {
    await expect(writeExperience(options(), '文件名', '---\ntitle: 另一个标题\n---\n\n- 怎么做：x'))
      .rejects.toThrow(/must equal the note name/)
  })

  it('keeps the index bounded even when the folder is not', async () => {
    const entries = Array.from({ length: 210 }, (_, index) => ({
      name: `e${index}.md`,
      title: `经验 ${index}`,
      description: '总是',
      general: true,
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

  it('fits the worst-case line at the line cap without the character cap biting', () => {
    // 60 characters is the note-name cap, and this is the widest a line can get:
    // star + full-length title + the special mark.
    const entries = Array.from({ length: 200 }, (_, index) => ({
      name: `e${index}.md`,
      title: `经验 ${index}`.padEnd(60, '照'),
      description: '',
      general: false,
      candidateSkill: true,
      chars: 40,
      updatedAt: 1000 + index,
    }))
    const markdown = buildExperienceIndex(entries)
    expect(markdown).toContain('（特殊）')
    expect(markdown.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(200)
    expect(markdown.length).toBeLessThanOrEqual(20000)
  })

  it('still truncates at the character cap if the line cap is ever raised', () => {
    // Unreachable from real notes (names cap at 60 characters), so this drives the
    // branch with hand-made entries: the guard has to keep working if the line cap
    // grows, or the index stops being bounded by anything.
    const entries = Array.from({ length: 200 }, (_, index) => ({
      name: `e${index}.md`,
      title: '长'.repeat(400),
      description: '',
      general: true,
      candidateSkill: false,
      chars: 40,
      updatedAt: 1000 + index,
    }))
    const markdown = buildExperienceIndex(entries)
    expect(markdown.length).toBe(20001)
  })

  it('returns null instead of an empty block when there is nothing to inject', async () => {
    await expect(readExperiencesPrompt(options())).resolves.toBeNull()
  })

  it('injects only the bullet lines, not the file title or its comments', () => {
    const markdown = '# 经验库索引\n\n<!-- 自动生成 -->\n\n- 一\n'
    expect(stripIndexChrome(markdown)).toBe('- 一')
  })

  it('gives the prompt the same pointer the file holds', async () => {
    await writeExperience(options(), '构建失败先清 dist', EXPERIENCE_BODY('构建失败先清 dist', '构建报错时'))
    const prompt = await readExperiencesPrompt(options())
    // The heading lives in the file for humans; the prompt pays only for the lines
    // the model can actually act on.
    expect(prompt.index).toBe('- 构建失败先清 dist')
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
