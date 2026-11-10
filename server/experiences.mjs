import { promises as fs } from 'node:fs'
import path from 'node:path'
import { dataDir } from './storage.mjs'
import {
  ARCHIVE_DIR_NAME,
  NoteStoreError,
  listArchivedNoteFiles,
  listNoteFiles,
  moveNoteFile,
  noteTitleOfName,
  readNoteFile,
  revealNoteFile,
  writeNoteFile,
} from './note-store.mjs'
import { firstString, parseFrontmatter } from './frontmatter.mjs'
import { openPathInFileManager } from './utils/platform.mjs'

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
 * `index.md` is generated from the files, never hand-written: one bullet per note,
 * and that bullet is the file name. The name already is the conclusion in one
 * sentence, so the index repeats nothing, and because it is read from the file there
 * is nothing to keep in sync.
 */

export const EXPERIENCES_DIR_NAME = 'experiences'
export const EXPERIENCE_INDEX_FILE_NAME = 'index.md'
export const EXPERIENCES_DISPLAY_PATH = '~/.quickforge/experiences'
export const MAX_EXPERIENCE_INDEX_LINES = 200
// A hard ceiling on a string that is injected into every system prompt. With the
// 200-line cap above and the 60-character file-name cap, it cannot fire from real
// notes (200 × ~68 characters lands around 14k), so the line cap is the one that
// binds. It stays because it bounds a per-message cost: raising the line cap, or a
// caller passing hand-made entries, must not be able to make the index unbounded.
export const MAX_EXPERIENCE_INDEX_CHARS = 20000
export const EXPERIENCE_INDEX_HEADER = `# 经验库索引

<!-- 这个文件由程序扫描目录生成，手工修改会在下次生成时被覆盖。 -->
<!-- 一条一行，只放文件名：★ = 够格升级成技能；「（特殊）」= 只对某个项目或场景成立。 -->
`

// The flags used to live in the body as `- 候选技能：是` bullets. Front matter is
// where they belong now, but the old form is still read so a half-migrated library
// keeps working.
const LEGACY_CANDIDATE_SKILL_PATTERN = /^\s*[-*]\s*(?:候选技能|candidate skill)\s*[:：]\s*(?:是|yes|true)/im

// `firstOptionalBoolean` only knows `true` / `false`, which is the right contract for
// the shared front matter parser. It is the wrong one for these two flags, because
// the curator writes Chinese: `general: 否` is the most natural way to say "special",
// and a strict parser reads it as "no value" and falls back to the `true` default —
// silently turning a special note into a general one, which is the exact failure
// this axis exists to prevent. The negative and positive spellings are recognised
// here instead, next to the flags that need them.
const NEGATIVE_FLAG = /^(?:false|no|off|0|否|不是)$/i
const POSITIVE_FLAG = /^(?:true|yes|on|1|是)$/i

function flagOf(...values) {
  for (const value of values) {
    if (value === true || value === false) return value
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (NEGATIVE_FLAG.test(normalized)) return false
    if (POSITIVE_FLAG.test(normalized)) return true
  }
  return undefined
}

/**
 * The machine-readable header of one experience.
 *
 * `general` is the axis that decides whether a reader may follow the note as
 * written or has to swap parts of it out first. The default is `true` because
 * notes written before the field existed are mostly general, and because `true` is
 * the value the index does not have to print: only `（特殊）` earns characters.
 *
 * `candidateSkill` cannot be true without `general`: a skill is loaded into every
 * project, so promoting a special experience would bake one project's details into
 * everyone's defaults. `candidateSkillClaimed` is the value the file actually asks
 * for, so the writer can refuse the contradiction instead of quietly dropping half
 * of what the file says.
 */
export function experienceMetaOf(content) {
  const { metadata } = parseFrontmatter(content)
  const general = flagOf(metadata.general, metadata['通用'])
  const declared = flagOf(
    metadata.candidate_skill,
    metadata.candidateSkill,
    metadata['候选技能'],
  )
  const resolvedGeneral = general === undefined ? true : general
  const legacyCandidate = LEGACY_CANDIDATE_SKILL_PATTERN.test(String(content ?? ''))
  return {
    description: firstString(metadata.description, metadata.summary, metadata['描述']) || '',
    general: resolvedGeneral,
    candidateSkillClaimed: declared === true || legacyCandidate,
    candidateSkill: (declared === true || legacyCandidate) && resolvedGeneral,
  }
}

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
  const meta = experienceMetaOf(note.content || '')
  return {
    name: note.name,
    title: note.heading || noteTitleOfName(note.name),
    // Front matter `description` is the current home; `whenToUse` is the bullet the
    // older notes used, kept as the fallback so both spellings render the same line.
    description: meta.description || note.whenToUse || '',
    general: meta.general,
    candidateSkill: meta.candidateSkill,
    chars: note.chars,
    updatedAt: note.updatedAt,
  }
}

export async function listExperiences(options = {}) {
  const dir = experiencesDir(options)
  const notes = await listNoteFiles(dir)
  return notes.filter((note) => note.name !== EXPERIENCE_INDEX_FILE_NAME).map(experienceEntryOf)
}

/**
 * Render the index.
 *
 * Newest first, capped at `MAX_EXPERIENCE_INDEX_LINES`: the index is injected into
 * every system prompt, so its size is a permanent cost paid on every message of
 * every session. Only the title goes in — the note's own file name already is the
 * conclusion, and repeating its `description` under it would pay twice for the same
 * sentence. The one thing worth the extra characters is the `（特殊）` mark, because
 * it is the only signal that says "do not follow this as written".
 *
 * When the cap is hit the older entries fall off the index but stay on disk, which
 * is the intended failure mode — the index is a pointer, not a copy.
 */
export function buildExperienceIndex(entries) {
  const ordered = [...entries].sort((left, right) => right.updatedAt - left.updatedAt)
  const lines = ordered.slice(0, MAX_EXPERIENCE_INDEX_LINES).map((entry) => {
    const marker = entry.candidateSkill ? '★ ' : ''
    const scope = entry.general === false ? '（特殊）' : ''
    return `- ${marker}${entry.title}${scope}`
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

/**
 * Reveal one experience in the system file manager.
 *
 * Same contract as the working memory note list: the client sends a name, the
 * server validates it and builds the path itself.
 */
export async function openExperience(options = {}, name) {
  return revealNoteFile(experiencesDir(options), name, options)
}

/**
 * Reveal the library folder itself.
 *
 * The folder (and its `_archive/`) is created first: "open the library" has to
 * work on a fresh install where the curator has not written anything yet.
 */
export async function openExperiencesFolder(options = {}) {
  const dir = await ensureExperiencesDir(options)
  const reveal = options.openPath || openPathInFileManager
  await reveal(dir)
  return { ok: true, path: EXPERIENCES_DISPLAY_PATH }
}

export async function writeExperience(options = {}, name, content) {
  // Refuse the contradiction rather than half-honour it. Silently reading a special
  // note as a non-candidate would mean the file says one thing and every reader sees
  // another; the note has to pick one.
  const meta = experienceMetaOf(content)
  if (meta.candidateSkillClaimed && !meta.general) {
    throw new NoteStoreError(
      'An experience marked `candidate_skill: true` must also be `general: true`: a skill is loaded into every project, so a special one cannot become a skill. Describe the project-specific parts in the note instead.',
    )
  }
  const written = await writeNoteFile(experiencesDir(options), name, content)
  await readExperienceIndex(options).catch(() => null)
  return written
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
