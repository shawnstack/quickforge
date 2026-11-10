import { Type } from 'typebox'
import {
  listArchivedExperiences,
  listExperiences,
  moveExperience,
  readExperience,
  writeExperience,
} from '../experiences.mjs'
import {
  listArchivedWorkingMemoryNotes,
  listWorkingMemoryNotes,
  moveWorkingMemoryNote,
  readWorkingMemoryNote,
  writeWorkingMemoryNote,
} from '../working-memory.mjs'
import { noteTitleOfName } from '../note-store.mjs'

/**
 * The four tools that reach the memory folders.
 *
 * They exist because the folders live outside the workspace, and a background
 * agent cannot be handed a shell: `run_command` would mean "approve every call"
 * (nobody is awake at 03:00) or "give it the whole disk". These tools are locked
 * to the two directories, and there is no delete among them on purpose — retiring
 * a note means moving it into `_archive/`, which stays readable.
 */

export const MEMORY_NOTE_SCOPES = Object.freeze(['working', 'experience'])

const SCOPE_DESCRIPTION = 'Which folder: "working" = the current project\'s working memory (~/.quickforge/working-memory), "experience" = the shared experience library (~/.quickforge/experiences).'

function scopeLabel(scope) {
  return scope === 'experience' ? 'experience library' : 'working memory'
}

function normalizeScope(value) {
  const scope = String(value ?? '').trim().toLowerCase()
  if (scope === 'experience' || scope === 'experiences' || scope === '经验') return 'experience'
  if (scope === 'working' || scope === 'working-memory' || scope === '工作') return 'working'
  const error = new Error(`Unknown memory scope "${value}". Use "working" or "experience".`)
  error.statusCode = 400
  throw error
}

export const listMemoryNotesTool = {
  name: 'list_memory_notes',
  label: 'List memory notes',
  description: 'List the notes in the working memory folder or the experience library. Each file is one note and its file name is the note\'s summary in one sentence, so this listing is the cheapest way to see what is already known before writing something new.',
  parameters: Type.Object({
    scope: Type.Union([Type.Literal('working'), Type.Literal('experience')], { description: SCOPE_DESCRIPTION }),
  }, { additionalProperties: false }),
  executionMode: 'sequential',
}

export const readMemoryNoteTool = {
  name: 'read_memory_note',
  label: 'Read memory note',
  description: 'Read one note in full. Use this instead of guessing a note\'s content from its file name: names are summaries, not the text.',
  parameters: Type.Object({
    scope: Type.Union([Type.Literal('working'), Type.Literal('experience')], { description: SCOPE_DESCRIPTION }),
    name: Type.String({ description: 'Note name, with or without the .md suffix.' }),
  }, { additionalProperties: false }),
  executionMode: 'sequential',
}

export const writeMemoryNoteTool = {
  name: 'write_memory_note',
  label: 'Write memory note',
  description: 'Create or replace one memory note. The file name is the note\'s one-sentence summary, so pass a name that reads like the conclusion; the content must start with a "# title" line and is capped at 4000 characters. Writing an empty body is refused — to retire a note, move it into _archive/ instead.',
  parameters: Type.Object({
    scope: Type.Union([Type.Literal('working'), Type.Literal('experience')], { description: SCOPE_DESCRIPTION }),
    name: Type.String({ description: 'File name without the .md suffix; it must be the note\'s summary in one sentence.' }),
    content: Type.String({ description: 'Full Markdown body, starting with "# <title>".' }),
  }, { additionalProperties: false }),
  executionMode: 'sequential',
}

export const moveMemoryNoteTool = {
  name: 'move_memory_note',
  label: 'Move memory note',
  description: 'Rename a note, or retire it by moving it to "_archive/<name>". This is the only way a note leaves the folder: nothing is ever deleted, so an archived note stays readable and a bad cleanup can be undone.',
  parameters: Type.Object({
    scope: Type.Union([Type.Literal('working'), Type.Literal('experience')], { description: SCOPE_DESCRIPTION }),
    from: Type.String({ description: 'Current note name.' }),
    to: Type.String({ description: 'New name, or "_archive/<name>" to retire it.' }),
  }, { additionalProperties: false }),
  executionMode: 'sequential',
}

export const memoryNoteTools = [
  listMemoryNotesTool,
  readMemoryNoteTool,
  writeMemoryNoteTool,
  moveMemoryNoteTool,
]

export const MEMORY_NOTE_TOOL_NAMES = Object.freeze(memoryNoteTools.map((tool) => tool.name))

function formatEntry(entry, scope) {
  if (scope !== 'experience') return `- ${entry.title} (${entry.chars} chars)`
  const scopeMark = entry.general === false ? '（特殊：复用前要先换掉本项目专有的名字、路径或命令）' : ''
  const when = entry.description ? ` —— ${entry.description}` : ''
  return `- ${entry.title}${scopeMark}${when} (${entry.chars} chars)`
}

export async function toolListMemoryNotes(params = {}) {
  const scope = normalizeScope(params.scope)
  const entries = scope === 'experience'
    ? await listExperiences()
    : await listWorkingMemoryNotes()
  const label = scopeLabel(scope)
  if (entries.length === 0) {
    return {
      content: `The ${label} is empty.`,
      details: { type: 'memory_notes_list', scope, count: 0, notes: [] },
    }
  }
  return {
    content: [
      `${entries.length} note${entries.length === 1 ? '' : 's'} in ${label}:`,
      ...entries.map((entry) => formatEntry(entry, scope)),
      '',
      'Open one with read_memory_note when its name looks relevant.',
    ].join('\n'),
    details: { type: 'memory_notes_list', scope, count: entries.length, notes: entries },
  }
}

export async function toolReadMemoryNote(params = {}) {
  const scope = normalizeScope(params.scope)
  const name = String(params.name ?? '').trim()
  const note = scope === 'experience'
    ? await readExperience({}, name)
    : await readWorkingMemoryNote({}, name)
  return {
    content: note.content,
    details: {
      type: 'memory_note',
      scope,
      name: note.name,
      title: note.title,
      chars: note.content.length,
    },
  }
}

export async function toolWriteMemoryNote(params = {}) {
  const scope = normalizeScope(params.scope)
  const written = scope === 'experience'
    ? await writeExperience({}, params.name, params.content)
    : await writeWorkingMemoryNote({}, params.name, params.content)
  return {
    content: `Saved "${written.title}" to the ${scopeLabel(scope)}.`,
    details: { type: 'memory_note_written', scope, ...written },
  }
}

/**
 * The message a rename hands back to whoever called it.
 *
 * `titleSynced: false` means the note is in the right place but its front matter
 * `title` still carries the old name, so the next `write_memory_note` on it is
 * rejected. A bare "Renamed." would be a half-truth nothing else can correct: the
 * file name and the header disagree, and this sentence is the only sight of it the
 * model gets — the Settings page shows just the tool's parameters.
 */
export function describeMovedNote(moved, fromTitle) {
  const base = moved.archived
    ? `Retired "${fromTitle}" into _archive/.`
    : `Renamed to "${noteTitleOfName(moved.name)}".`
  if (moved.titleSynced !== false) return base
  return `${base} Its front matter title still carries the old name or spans several lines, so this note cannot be written again until that header is fixed: read it, rewrite the title as a single \`title:\` line equal to "${noteTitleOfName(moved.name)}", and save it with write_memory_note.`
}

export async function toolMoveMemoryNote(params = {}) {
  const scope = normalizeScope(params.scope)
  const from = String(params.from ?? '').trim()
  const to = String(params.to ?? '').trim()
  const moved = scope === 'experience'
    ? await moveExperience({}, from, to)
    : await moveWorkingMemoryNote({}, from, to)
  return {
    content: describeMovedNote(moved, noteTitleOfName(from)),
    details: { type: 'memory_note_moved', scope, ...moved },
  }
}

export async function listArchivedMemoryNotes(scope = 'working') {
  return normalizeScope(scope) === 'experience'
    ? listArchivedExperiences()
    : listArchivedWorkingMemoryNotes()
}
