/**
 * manage_global_memory tool: thin handler over the shared MEMORY.md writer.
 *
 * Write-only on purpose — the current document is already injected into the
 * system prompt as <global_user_memory>, so there is no read action to wrap.
 */
import { writeGlobalMemory } from '../global-memory.mjs'

export async function toolManageGlobalMemory(params) {
  return writeGlobalMemory(params)
}
