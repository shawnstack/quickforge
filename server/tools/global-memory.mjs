/**
 * manage_global_memory tool: thin handler over the shared MEMORY.md writer.
 *
 * Write-only on purpose — the current document is already injected into the
 * system prompt as <global_user_memory>, so there is no read action to wrap.
 *
 * A bot session's prompt injects *its own* MEMORY.md from the root of its
 * workspace, so for that session the same tool has to land on that file instead
 * of the user's global one. Which file is decided from the session context alone
 * (never from a guess about the workspace path), and there is no silent fallback:
 * when the bot target cannot be resolved the call fails, because falling back to
 * the global file is exactly how a bot ends up overwriting the user's memory.
 */
import { writeGlobalMemory, writeWorkspaceMemory } from '../global-memory.mjs'
import { readProjectConfig } from '../project-config.mjs'

const BOT_MEMORY_UNAVAILABLE = 'Bot memory file is unavailable for this session.'

function botMemoryUnavailable(cause) {
  const error = new Error(BOT_MEMORY_UNAVAILABLE)
  error.errorCode = 'BOT_MEMORY_UNAVAILABLE'
  if (cause) error.cause = cause
  return error
}

function workspaceRootOf(context, project) {
  const fromContext = typeof context?.workspaceRoot === 'string' ? context.workspaceRoot.trim() : ''
  if (fromContext) return fromContext
  // The registered path of the bot project is the same value workspaceRoot is
  // built from (project-config.mjs: `workspaceRoot: path.resolve(project.path)`).
  const fromProject = typeof project?.path === 'string' ? project.path.trim() : ''
  return fromProject || null
}

/**
 * The workspace root the bot's MEMORY.md lives in, or null when this session does
 * not belong to a bot.
 *
 * Bot sessions are always project-scoped (`bot-session.mjs` creates them with
 * scope 'project' + the bot project id), so a global conversation is the one
 * cheap "not a bot" answer. Everything else is decided by the project record.
 */
async function resolveBotWorkspaceRoot(context) {
  if (context?.scope !== 'project') return null

  let project = context.project
  if (typeof project?.kind !== 'string') {
    // Contexts built before `kind` travelled with the project (and synthetic ones)
    // carry no kind: ask the project record rather than inferring from paths.
    if (!context.projectId) throw botMemoryUnavailable()
    let config
    try {
      config = await readProjectConfig()
    } catch (error) {
      throw botMemoryUnavailable(error)
    }
    project = config.projects.find((item) => item.id === context.projectId) || null
    // Unknown project: we cannot prove this is not a bot, and a wrong guess here
    // overwrites the user's file.
    if (!project) throw botMemoryUnavailable()
  }

  if (project.kind !== 'bot') return null

  const workspaceRoot = workspaceRootOf(context, project)
  if (!workspaceRoot) throw botMemoryUnavailable()
  return workspaceRoot
}

export async function toolManageGlobalMemory(params, context = {}) {
  const botWorkspaceRoot = await resolveBotWorkspaceRoot(context)
  if (botWorkspaceRoot) return writeWorkspaceMemory(params, botWorkspaceRoot)
  return writeGlobalMemory(params)
}
