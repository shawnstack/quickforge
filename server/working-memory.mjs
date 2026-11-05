import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicUpdate, dataDir, readStore } from './storage.mjs'
import {
  ARCHIVE_DIR_NAME,
  copyNoteDir,
  listArchivedNoteFiles,
  listNoteFiles,
  listNotePage,
  moveNoteFile,
  readNoteFile,
  revealNoteFile,
  writeNoteFile,
} from './note-store.mjs'
import { openPathInFileManager } from './utils/platform.mjs'

// Working memory (beta): a folder of small Markdown notes shared by every chat
// and project. The AI reads and writes it through the `*_memory_note` tools (the
// folder lives outside the workspace sandbox), so this module owns the settings,
// the note-writing prompt injected into the system prompt, the folder path, and
// the thin wrapper over the shared note-store operations.

export const WORKING_MEMORY_SETTINGS_KEY = 'working-memory-settings'
export const WORKING_MEMORY_DIR_NAME = 'working-memory'
export const WORKING_MEMORY_DISPLAY_PATH = '~/.quickforge/working-memory'
export const MAX_WORKING_MEMORY_PROMPT_CHARS = 4000

// Deliberately a plain-language rewrite of COMPACT_SYSTEM_PROMPT: same intent
// (keep what later work needs) but shorter, colloquial, and written for a
// single note per topic instead of one big rolling summary. Kept to a couple
// of principles on purpose — a long checklist of rules makes notes read like a
// filled-in form instead of something a colleague would actually reread.
export const DEFAULT_WORKING_MEMORY_PROMPT = `Write it the way you would explain it to a colleague later: plain words, short lines, no jargon.

One note per topic, not one big catch-all. The first line is the summary and also the file name, so rename the file when that summary changes. Keep notes current — rewrite what is out of date, and fold notes that say the same thing into one instead of piling new ones on top.`

export const DEFAULT_WORKING_MEMORY_SETTINGS = {
  // Beta feature: off until the user turns it on.
  enabled: false,
  prompt: DEFAULT_WORKING_MEMORY_PROMPT,
}

function normalizePrompt(value) {
  if (typeof value !== 'string') return DEFAULT_WORKING_MEMORY_PROMPT
  const trimmed = value.trim()
  if (!trimmed) return DEFAULT_WORKING_MEMORY_PROMPT
  return trimmed.slice(0, MAX_WORKING_MEMORY_PROMPT_CHARS)
}

export function normalizeWorkingMemorySettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_WORKING_MEMORY_SETTINGS }
  }
  return {
    enabled: value.enabled === true,
    prompt: normalizePrompt(value.prompt),
  }
}

export async function readWorkingMemorySettings() {
  const settings = await readStore('settings')
  return normalizeWorkingMemorySettings(settings?.[WORKING_MEMORY_SETTINGS_KEY])
}

export async function isWorkingMemoryEnabled() {
  return (await readWorkingMemorySettings()).enabled
}

export function workingMemoryDir(options = {}) {
  return path.join(options.dataDir || dataDir, WORKING_MEMORY_DIR_NAME)
}

export async function ensureWorkingMemoryDir(options = {}) {
  const dir = workingMemoryDir(options)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export async function saveWorkingMemorySettings(patch = {}, options = {}) {
  const current = options.settings || await readWorkingMemorySettings()
  const next = normalizeWorkingMemorySettings({
    enabled: patch.enabled === undefined ? current.enabled : patch.enabled === true,
    // `prompt` is not exposed in Settings; it stays writable through
    // `settings.json` as an engineer-only escape hatch.
    prompt: patch.prompt === undefined ? current.prompt : patch.prompt,
  })
  if (typeof options.writeSettings === 'function') {
    await options.writeSettings(next)
  } else {
    await atomicUpdate('settings', (data) => ({ ...data, [WORKING_MEMORY_SETTINGS_KEY]: next }))
  }
  if (next.enabled) await ensureWorkingMemoryDir(options)
  return next
}

export async function getWorkingMemoryRevision(options = {}) {
  const settings = options.settings || await readWorkingMemorySettings()
  return createHash('sha256')
    .update(`${settings.enabled ? 1 : 0}\n${settings.prompt}`)
    .digest('hex')
}

export async function readWorkingMemoryPrompt(options = {}) {
  const settings = options.settings || await readWorkingMemorySettings()
  if (!settings.enabled) return null
  return {
    enabled: true,
    path: workingMemoryDir(options),
    displayPath: WORKING_MEMORY_DISPLAY_PATH,
    prompt: settings.prompt,
  }
}

// Settings-page payload: deliberately excludes the note-writing prompt so the
// internal contract never leaks into the UI.
export async function readWorkingMemoryDocument(options = {}) {
  const settings = options.settings || await readWorkingMemorySettings()
  return {
    enabled: settings.enabled,
    path: WORKING_MEMORY_DISPLAY_PATH,
  }
}

/**
 * Note operations.
 *
 * These are thin wrappers so the tool layer never has to know where the folder
 * is. Validation (name, size, "no empty writes") lives in `note-store.mjs` and is
 * shared with the experience library on purpose: both folders obey the same rules.
 */
export async function listWorkingMemoryNotes(options = {}) {
  return listNoteFiles(workingMemoryDir(options))
}

/**
 * Read-only listing for the Settings page: newest-first, one page at a time.
 *
 * Unlike the tool-facing list above this never exposes note bodies, so the page
 * cannot accidentally become a place to edit notes.
 */
export async function listWorkingMemoryNotePage(options = {}, { offset = 0, limit = 20 } = {}) {
  return listNotePage(workingMemoryDir(options), { offset, limit })
}

/**
 * Reveal one note in the system file manager.
 *
 * The name/path rules live in `note-store.mjs` and are shared with the experience
 * library, so both folders answer "open" the same way.
 */
export async function openWorkingMemoryNote(options = {}, name) {
  return revealNoteFile(workingMemoryDir(options), name, options)
}

/**
 * Reveal the notes folder itself.
 *
 * Created first, for the same reason as the experience library: "open the folder"
 * has to work before the first note exists.
 */
export async function openWorkingMemoryFolder(options = {}) {
  const dir = await ensureWorkingMemoryDir(options)
  const reveal = options.openPath || openPathInFileManager
  await reveal(dir)
  return { ok: true, path: WORKING_MEMORY_DISPLAY_PATH }
}

export async function readWorkingMemoryNote(options = {}, name) {
  return readNoteFile(workingMemoryDir(options), name)
}

export async function writeWorkingMemoryNote(options = {}, name, content) {
  return writeNoteFile(workingMemoryDir(options), name, content)
}

export async function moveWorkingMemoryNote(options = {}, from, to) {
  return moveNoteFile(workingMemoryDir(options), from, to)
}

export async function listArchivedWorkingMemoryNotes(options = {}) {
  return listArchivedNoteFiles(workingMemoryDir(options))
}

export async function snapshotWorkingMemory(options = {}, target) {
  return copyNoteDir(workingMemoryDir(options), target)
}

export { ARCHIVE_DIR_NAME }
