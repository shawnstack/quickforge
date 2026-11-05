import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { openPathInFileManager } from './utils/platform.mjs'

/**
 * File operations for the two memory folders: working memory and experiences.
 *
 * Both folders are "one note per file, the file name is the note's summary in one
 * sentence". They live outside the workspace, so the agent can only reach them
 * through the `*_memory_note` tools, which are locked to these two directories.
 * That is the whole point of this module: every write goes through one place that
 * validates the name and the size, so no tool can escape the folder or blank a
 * note by accident.
 *
 * There is deliberately no delete. Retiring a note means moving it into the
 * `_archive/` subfolder, so a bad Dreaming run can always be undone by hand.
 */

export const NOTE_FILE_EXTENSION = '.md'
export const ARCHIVE_DIR_NAME = '_archive'
export const MAX_NOTE_NAME_CHARS = 60
export const MAX_NOTE_CONTENT_CHARS = 4000
export const MAX_NOTES_PER_SCOPE = 200

// Characters that are illegal in a file name on at least one of the three
// platforms QuickForge runs on. `/` and `\` are the path separators; the rest
// are Windows-only but excluding them everywhere keeps a synced folder portable.
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*]/
// Control characters are rejected separately so the rule does not need a
// character range full of unprintable escapes.
const CONTROL_CHARS = /[\p{Cc}]/u

export class NoteStoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'NoteStoreError'
    this.statusCode = statusCode
  }
}

/**
 * Normalize a user/model supplied note name into a safe `*.md` file name.
 *
 * The `.md` suffix is optional on input: the model writes "构建失败先清 dist",
 * and forcing it to remember the extension produced names that differed only by
 * the suffix. Everything else is rejected rather than repaired — silently
 * rewriting a name would make the note harder to find than refusing the write.
 */
export function normalizeNoteName(value) {
  const raw = String(value ?? '').trim()
  if (!raw) throw new NoteStoreError('Note name is required.')
  if (ILLEGAL_NAME_CHARS.test(raw) || CONTROL_CHARS.test(raw)) {
    throw new NoteStoreError('Note name cannot contain any of < > : " / \\ | ? * or control characters.')
  }
  if (raw.startsWith('.')) throw new NoteStoreError('Note name cannot start with a dot.')
  if (raw.includes('..')) throw new NoteStoreError('Note name cannot contain "..".')
  const name = raw.toLowerCase().endsWith(NOTE_FILE_EXTENSION) ? raw : `${raw}${NOTE_FILE_EXTENSION}`
  if (name.length > MAX_NOTE_NAME_CHARS + NOTE_FILE_EXTENSION.length) {
    throw new NoteStoreError(`Note name is longer than ${MAX_NOTE_NAME_CHARS} characters.`)
  }
  return name
}

/** Strip the extension for display and for matching what the user sees. */
export function noteTitleOfName(name) {
  const value = String(name ?? '')
  return value.toLowerCase().endsWith(NOTE_FILE_EXTENSION)
    ? value.slice(0, -NOTE_FILE_EXTENSION.length)
    : value
}

/** First `# heading` of a note, falling back to the file name. */
export function noteHeadingOf(content, fallback = '') {
  for (const line of String(content ?? '').split('\n')) {
    const match = /^#\s+(.+?)\s*$/.exec(line)
    if (match) return match[1]
  }
  return fallback
}

/**
 * The one-line "when to use this" summary.
 *
 * The experience format reserves a `- 何时用：` / `- When to use:` bullet for it.
 * The index is built from this field, so the index never drifts from the file:
 * both are read from the same place.
 */
export function noteWhenToUseOf(content) {
  for (const line of String(content ?? '').split('\n')) {
    const match = /^\s*[-*]\s*(?:何时用|什么时候用|when to use)\s*[:：]\s*(.+?)\s*$/i.exec(line)
    if (match) return match[1]
  }
  return ''
}

function isNoteFileName(name) {
  return typeof name === 'string' && name.toLowerCase().endsWith(NOTE_FILE_EXTENSION) && !name.startsWith('.')
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

/**
 * Every note in the folder, newest-first by last write.
 *
 * `_archive/` is skipped on purpose: archived notes are retired history, and
 * listing them would make the model think they are still in play.
 */
export async function listNoteFiles(dir, { limit = MAX_NOTES_PER_SCOPE } = {}) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const notes = []
  for (const entry of entries) {
    if (!entry.isFile() || !isNoteFileName(entry.name)) continue
    const file = path.join(dir, entry.name)
    try {
      const stat = await fs.stat(file)
      const content = await fs.readFile(file, 'utf8')
      notes.push({
        name: entry.name,
        title: noteTitleOfName(entry.name),
        heading: noteHeadingOf(content, noteTitleOfName(entry.name)),
        whenToUse: noteWhenToUseOf(content),
        // The content is already in memory from the read above; returning it here
        // avoids a second pass over every file when the index is rebuilt.
        content,
        chars: content.length,
        updatedAt: stat.mtimeMs,
      })
    } catch {
      // A note that vanished between readdir and stat is not an error: the next
      // call sees the folder as it is.
    }
  }
  notes.sort((left, right) => right.updatedAt - left.updatedAt)
  return notes.slice(0, limit)
}

/**
 * One page of note summaries: names and last-write times only, no bodies.
 *
 * `listNoteFiles` reads every file because the tool layer rebuilds its index from
 * the content. The Settings page only renders titles, so paging here skips the
 * reads on purpose: a 200-note folder costs one `stat` per file per page.
 */
export async function listNotePage(dir, { offset = 0, limit = 20 } = {}) {
  const start = Math.max(0, Math.trunc(Number(offset) || 0))
  const size = Math.max(0, Math.trunc(Number(limit) || 0))
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return { notes: [], total: 0 }
    throw error
  }
  const notes = []
  for (const entry of entries) {
    if (!entry.isFile() || !isNoteFileName(entry.name)) continue
    try {
      const stat = await fs.stat(path.join(dir, entry.name))
      notes.push({
        name: entry.name,
        title: noteTitleOfName(entry.name),
        updatedAt: stat.mtimeMs,
      })
    } catch {
      // Same rule as listNoteFiles: a note that vanished mid-scan is simply not listed.
    }
  }
  notes.sort((left, right) => right.updatedAt - left.updatedAt)
  return { notes: notes.slice(start, start + size), total: notes.length }
}

export async function readNoteFile(dir, name) {
  const fileName = normalizeNoteName(name)
  try {
    const content = await fs.readFile(path.join(dir, fileName), 'utf8')
    return { name: fileName, title: noteTitleOfName(fileName), content }
  } catch (error) {
    if (error?.code === 'ENOENT') throw new NoteStoreError(`Note "${noteTitleOfName(fileName)}" does not exist.`, 404)
    throw error
  }
}

/**
 * Reveal one note in the system file manager.
 *
 * Shared by both folders: "open" means the same thing in Settings whether the row
 * is a working note or an experience. The name goes through the same validation as
 * a write and the path is built from the folder here, never accepted from the
 * caller, so this cannot be used to open arbitrary files.
 */
export async function revealNoteFile(dir, name, options = {}) {
  const fileName = normalizeNoteName(name)
  const file = path.join(dir, fileName)
  try {
    await fs.access(file)
  } catch {
    throw new NoteStoreError(`Note "${noteTitleOfName(fileName)}" does not exist.`, 404)
  }
  const reveal = options.openPath || openPathInFileManager
  await reveal(file)
  return { ok: true, name: fileName }
}

/**
 * Write a note, creating or replacing it.
 *
 * Empty content is rejected: "delete by writing nothing" is the one destructive
 * operation this layer refuses to offer, because a truncated model reply would
 * otherwise silently erase a note.
 */
export async function writeNoteFile(dir, name, content) {
  const fileName = normalizeNoteName(name)
  const text = String(content ?? '').replace(/\r\n/g, '\n').trim()
  if (!text) throw new NoteStoreError('Note content is required; writing an empty note would erase it.')
  if (text.length > MAX_NOTE_CONTENT_CHARS) {
    throw new NoteStoreError(`Note content is longer than ${MAX_NOTE_CONTENT_CHARS} characters (got ${text.length}).`)
  }
  if (!/^#\s+\S+/m.test(text)) {
    throw new NoteStoreError('Note content must start with a "# title" line; the title is the file name in one sentence.')
  }
  await ensureDir(dir)
  const file = path.join(dir, fileName)
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${text}\n`, 'utf8')
  await fs.rename(temporary, file)
  return {
    name: fileName,
    title: noteTitleOfName(fileName),
    heading: noteHeadingOf(text, noteTitleOfName(fileName)),
    chars: text.length,
  }
}

/**
 * Rename a note, or retire it by moving it into `_archive/`.
 *
 * This is the only way a note can leave the folder, and it never destroys text:
 * the worst case is a file sitting in `_archive/`, which is still readable.
 */
export async function moveNoteFile(dir, from, to) {
  const fromName = normalizeNoteName(from)
  const toRaw = String(to ?? '').trim()
  if (!toRaw) throw new NoteStoreError('Destination name is required.')
  const archived = toRaw.startsWith(`${ARCHIVE_DIR_NAME}/`) || toRaw.startsWith(`${ARCHIVE_DIR_NAME}\\`)
  const toName = archived
    ? normalizeNoteName(toRaw.slice(ARCHIVE_DIR_NAME.length + 1))
    : normalizeNoteName(toRaw)
  if (fromName === toName && !archived) return { changed: false, name: fromName }

  const sourceFile = path.join(dir, fromName)
  const targetDir = archived ? path.join(dir, ARCHIVE_DIR_NAME) : dir
  const targetFile = path.join(targetDir, toName)
  if (sourceFile === targetFile) return { changed: false, name: toName }

  try {
    await fs.access(sourceFile)
  } catch {
    throw new NoteStoreError(`Note "${noteTitleOfName(fromName)}" does not exist.`, 404)
  }
  await ensureDir(targetDir)
  // Refuse to overwrite: a merge is "read both, write the merged note, then
  // archive the source", and an accidental overwrite would lose the target.
  try {
    await fs.access(targetFile)
    throw new NoteStoreError(`Target note "${noteTitleOfName(toName)}" already exists; merge by writing the merged note instead.`)
  } catch (error) {
    if (error instanceof NoteStoreError) throw error
    if (error?.code !== 'ENOENT') throw error
  }
  await fs.rename(sourceFile, targetFile)
  return { changed: true, name: toName, archived }
}

/** Archived notes, newest first. Used by the settings page to show what was retired. */
export async function listArchivedNoteFiles(dir, { limit = 50 } = {}) {
  return listNoteFiles(path.join(dir, ARCHIVE_DIR_NAME), { limit })
}

/** Copy a whole folder into a snapshot directory; used before a Dreaming run. */
export async function copyNoteDir(source, target) {
  try {
    await fs.access(source)
  } catch {
    return { copied: 0, skipped: true }
  }
  await fs.mkdir(target, { recursive: true })
  let copied = 0
  const walk = async (from, to) => {
    const entries = await fs.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      const sourcePath = path.join(from, entry.name)
      const targetPath = path.join(to, entry.name)
      if (entry.isDirectory()) {
        await fs.mkdir(targetPath, { recursive: true })
        await walk(sourcePath, targetPath)
        continue
      }
      if (!entry.isFile()) continue
      await fs.copyFile(sourcePath, targetPath)
      copied += 1
    }
  }
  await walk(source, target)
  return { copied, skipped: false }
}

/** Restore a folder from a snapshot, replacing whatever is there now. */
export async function replaceNoteDirFromSnapshot(snapshot, target) {
  try {
    await fs.access(snapshot)
  } catch {
    throw new NoteStoreError('Snapshot for this run is no longer on disk.', 409)
  }
  await fs.rm(target, { recursive: true, force: true })
  await fs.mkdir(target, { recursive: true })
  return copyNoteDir(snapshot, target)
}
