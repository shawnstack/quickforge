/**
 * Workspace tool registry and assembly layer.
 *
 * Tool implementations live in per-responsibility modules next to this file;
 * this module only wires them into the `toolHandlers` registry consumed by
 * tool-wiring / routes / agent-manager, and re-exports the stable module
 * surface (tool handlers, the skill tool context loader, and the subprocess
 * control entry points) so importers keep using './tools/index.mjs'.
 *
 * Tool metadata (name, label, description, parameter schemas) is defined in
 * definitions.mjs; this table binds names to execution handlers.
 */
import {
  toolListMemoryNotes,
  toolMoveMemoryNote,
  toolReadMemoryNote,
  toolWriteMemoryNote,
} from './memory-notes.mjs'
import { toolReadFile, toolGrepFiles } from './file-search.mjs'
import { toolWriteFile, toolEditFile } from './file-write.mjs'
import { toolActivateSkill, toolReadSkillResource } from './skill-resources.mjs'
import { toolPresentFiles } from './present-files.mjs'
import { toolRunCommand } from './run-command.mjs'
import { toolManageGlobalMemory } from './global-memory.mjs'
import { toolTodoWrite } from './todo-write.mjs'

export { toolReadFile, toolGrepFiles } from './file-search.mjs'
export { toolWriteFile, toolEditFile } from './file-write.mjs'
export { loadSkillToolContext, toolActivateSkill, toolReadSkillResource } from './skill-resources.mjs'
export { toolPresentFiles } from './present-files.mjs'
export { toolRunCommand } from './run-command.mjs'
export { abortRunningCommand, listBackgroundCommandTasks, stopBackgroundCommandTasksForSession } from './process-control.mjs'
export { toolManageGlobalMemory } from './global-memory.mjs'
export { toolTodoWrite } from './todo-write.mjs'

export const toolHandlers = {
  manage_global_memory: toolManageGlobalMemory,
  list_memory_notes: toolListMemoryNotes,
  read_memory_note: toolReadMemoryNote,
  write_memory_note: toolWriteMemoryNote,
  move_memory_note: toolMoveMemoryNote,
  todo_write: toolTodoWrite,
  read_file: toolReadFile,
  grep_files: toolGrepFiles,
  write_file: toolWriteFile,
  edit_file: toolEditFile,
  run_command: toolRunCommand,
  present_files: toolPresentFiles,
  activate_skill: toolActivateSkill,
  read_skill_resource: toolReadSkillResource,
}
