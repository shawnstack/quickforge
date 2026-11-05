import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir } from './storage.mjs'
import {
  ARCHIVE_DIR_NAME,
  copyNoteDir,
  listArchivedNoteFiles,
  listNoteFiles,
  moveNoteFile,
  noteTitleOfName,
  readNoteFile,
  writeNoteFile,
} from './note-store.mjs'

/**
 * The experience library: the long-lived, machine-curated half of memory.
 *
 * Working memory answers "what is going on in this project right now" and is
 * allowed to be messy. Experiences answer "how do I do X here, because I have
 * done it before" and are meant to be readable months later. The migration rule
 * is simple: a note that keeps earning its place in working memory gets promoted
 * into this folder, where it stops being project chatter and becomes a procedure.
 *
 * The folder is global (shared by every project) and lives next to MEMORY.md.
 * `index.md` is generated from the files, never hand-written: every entry carries
 * a `- 何时用：` line, and the index is that line plus the file name. Because both
 * come from the same file there is nothing to keep in sync.
 */

export const EXPERIENCES_DIR_NAME = 'experiences'
export const EXPERIENCE_INDEX_FILE_NAME = 'index.md'
export const EXPERIENCES_DISPLAY_PATH = '~/.quickforge/experiences'
export const MAX_EXPERIENCE_INDEX_LINES = 200
// ~100 characters per line, so the two caps run out at roughly the same point:
// the line cap keeps the shape of the index, the character cap bounds the token bill.
export const MAX_EXPERIENCE_INDEX_CHARS = 20000
export const EXPERIENCE_INDEX_HEADER = `# 经验库索引

<!-- 这个文件由程序扫描目录生成，手工修改会在下次生成时被覆盖。 -->
<!-- 一条一行：文件名 —— 什么时候用这条经验。带 ★ 的是够格升级成技能的经验。 -->
`

const CANDIDATE_SKILL_PATTERN = /^\s*[-*]\s*(?:候选技能|candidate skill)\s*[:：]\s*(?:是|yes|true)/im

export function experiencesDir(options = {}) {
  return path.join(options.dataDir || dataDir, EXPERIENCES_DIR_NAME)
}

export async function ensureExperiencesDir(options = {}) {
  const dir = experiencesDir(options)
  await fs.mkdir(path.join(dir, ARCHIVE_DIR_NAME), { recursive: true })
  return dir
}

/** Enough of a note to build one index line and to render a list in Settings. */
export function experienceEntryOf(note) {
  return {
    name: note.name,
    title: note.heading || noteTitleOfName(note.name),
    whenToUse: note.whenToUse || '',
    candidateSkill: false,
    chars: note.chars,
    updatedAt: note.updatedAt,
  }
}

export async function listExperiences(options = {}) {
  const dir = experiencesDir(options)
  const notes = await listNoteFiles(dir)
  const entries = []
  for (const note of notes) {
    if (note.name === EXPERIENCE_INDEX_FILE_NAME) continue
    entries.push({
      ...experienceEntryOf(note),
      candidateSkill: CANDIDATE_SKILL_PATTERN.test(note.content || ''),
    })
  }
  return entries
}

/**
 * Render the index.
 *
 * Newest first, capped at `MAX_EXPERIENCE_INDEX_LINES`: the index is injected into
 * every system prompt, so its size is a permanent cost paid on every message of
 * every session. When the cap is hit the older entries fall off the index but stay
 * on disk, which is the intended failure mode — the index is a pointer, not a copy.
 */
export function buildExperienceIndex(entries) {
  const ordered = [...entries].sort((left, right) => right.updatedAt - left.updatedAt)
  const lines = ordered.slice(0, MAX_EXPERIENCE_INDEX_LINES).map((entry) => {
    const marker = entry.candidateSkill ? '★ ' : ''
    const when = entry.whenToUse ? ` —— ${entry.whenToUse}` : ''
    return `- ${marker}${entry.title}${when}`
  })
  if (ordered.length > MAX_EXPERIENCE_INDEX_LINES) {
    lines.push(`- （还有 ${ordered.length - MAX_EXPERIENCE_INDEX_LINES} 条较旧的经验没进索引，需要时直接看目录）`)
  }
  const markdown = `${EXPERIENCE_INDEX_HEADER}\n${lines.join('\n')}\n`
  return markdown.length > MAX_EXPERIENCE_INDEX_CHARS
    ? `${markdown.slice(0, MAX_EXPERIENCE_INDEX_CHARS)}\n`
    : markdown
}

export async function readExperienceIndex(options = {}) {
  const dir = experiencesDir(options)
  const entries = await listExperiences(options)
  const markdown = buildExperienceIndex(entries)
  const file = path.join(dir, EXPERIENCE_INDEX_FILE_NAME)
  let changed
  try {
    const current = await fs.readFile(file, 'utf8')
    changed = current !== markdown
  } catch {
    changed = true
  }
  // Regenerated on read, written only when it differs: the file exists so a human
  // can `cat` it, but nothing depends on it being written to be correct.
  if (changed) {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, markdown, 'utf8')
  }
  return { markdown, entries, changed, file }
}

export async function countExperiences(options = {}) {
  return (await listNoteFiles(experiencesDir(options))).filter((note) => note.name !== EXPERIENCE_INDEX_FILE_NAME).length
}

export async function readExperience(options = {}, name) {
  return readNoteFile(experiencesDir(options), name)
}

export async function writeExperience(options = {}, name, content) {
  const written = await writeNoteFile(experiencesDir(options), name, content)
  await readExperienceIndex(options).catch(() => null)
  return written
}

export async function archiveExperience(options = {}, name) {
  return moveExperience(options, name, `${ARCHIVE_DIR_NAME}/${name}`)
}

/** Rename an experience, or move it to `_archive/`. Refreshes the index either way. */
export async function moveExperience(options = {}, from, to) {
  const moved = await moveNoteFile(experiencesDir(options), from, to)
  await readExperienceIndex(options).catch(() => null)
  return moved
}

export async function listArchivedExperiences(options = {}) {
  return listArchivedNoteFiles(experiencesDir(options))
}

/**
 * The block injected into the system prompt.
 *
 * Only the index goes in: enough for the model to notice that a relevant
 * experience exists, not enough to make it think it already knows the details.
 * The block says so explicitly, otherwise models tend to answer from the index
 * line instead of opening the file.
 */
export async function readExperiencesPrompt(options = {}) {
  const { markdown, entries } = await readExperienceIndex(options)
  if (entries.length === 0) return null
  return {
    path: experiencesDir(options),
    displayPath: EXPERIENCES_DISPLAY_PATH,
    // The file keeps its title and its "generated, do not edit" comments for the
    // humans who cat it; the prompt gets neither. Everything injected is paid for
    // on every message, and an escaped `&lt;!--` reads as noise to the model.
    index: stripIndexChrome(markdown),
    count: entries.length,
  }
}

/** The part of `index.md` worth spending prompt tokens on: just the bullet lines. */
export function stripIndexChrome(markdown) {
  return String(markdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !/^#\s/.test(line.trim()))
    .join('\n')
    .trim()
}

export async function getExperiencesRevision(options = {}) {
  const entries = await listExperiences(options).catch(() => [])
  const signature = entries
    .map((entry) => `${entry.name}:${entry.updatedAt}:${entry.candidateSkill ? 1 : 0}`)
    .join('|')
  return createHash('sha256').update(signature).digest('hex')
}

/** Snapshot helper: the Dreaming runner copies the folder before it lets an agent edit it. */
export async function snapshotExperiences(options = {}, target) {
  return copyNoteDir(experiencesDir(options), target)
}
