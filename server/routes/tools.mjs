import { sendJson, readJsonBody, decodeSegment } from '../utils/response.mjs'
import { readStore } from '../storage.mjs'
import { toolHandlers, loadSkillToolContext } from '../tools/index.mjs'
import { createSkillTools, workspaceTools } from '../tools/definitions.mjs'
import { createMcpToolDefinitions } from '../mcp/registry.mjs'
import { callPluginTool, createPluginToolDefinitions, isPluginToolName } from '../plugins/registry.mjs'
import { safeReadTools } from '../approval-store.mjs'
import { projectContextFromId, readProjectConfig } from '../project-config.mjs'

const directRouteDisabledTools = new Set(['run_subagent'])

/**
 * GET /api/tools — returns canonical tool definitions (no project context needed).
 */
export async function handleGetTools(_req, res) {
  const config = await readProjectConfig()
  const activeProject = config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
  const skillTools = await createSkillTools({
    globalSkillNames: config.globalSkills,
    projectSkillNames: activeProject?.skills,
    workspaceRoot: activeProject?.path,
  })
  const pluginTools = await createPluginToolDefinitions(activeProject ? { workspaceRoot: activeProject.path, project: activeProject } : null)
  const mcpTools = await createMcpToolDefinitions()
  sendJson(res, 200, { tools: [...skillTools, ...workspaceTools, ...mcpTools, ...pluginTools] })
}

const workspaceToolNames = new Set(workspaceTools.map((tool) => tool.name))

function normalizeAccessMode(value, fallback = 'default') {
  if (value === 'default' || value === 'full-access') return value
  if (value === true || value === 'true') return 'full-access'
  if (value === false || value === 'false') return 'default'
  if (fallback !== value) return normalizeAccessMode(fallback, 'default')
  return 'default'
}

async function assertAccessModeAllowsDirectTool(name) {
  const protectedTool = workspaceToolNames.has(name) || isPluginToolName(name)
  if (!protectedTool || safeReadTools.has(name)) return

  const settings = await readStore('settings')
  const accessMode = normalizeAccessMode(settings?.['agent-access-mode'], settings?.['yolo-mode'])
  if (accessMode !== 'full-access') {
    const error = new Error('Full access permission is required to execute this tool directly.')
    error.statusCode = 403
    throw error
  }
}

export async function handleToolApi(req, res, url) {
  if (req.method !== 'POST') {
    const error = new Error('Tool endpoints require POST')
    error.statusCode = 405
    throw error
  }

  const parts = url.pathname.split('/').filter(Boolean)
  let name = decodeSegment(parts[2])
  let context

  if (name === 'activate_skill' || name === 'read_skill_resource') {
    const config = await readProjectConfig()
    const activeProject = config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]
    context = await loadSkillToolContext({
      globalSkillNames: config.globalSkills,
      projectSkillNames: activeProject?.skills,
      workspaceRoot: activeProject?.path,
    })
  }

  if (parts[1] === 'projects' && parts[3] === 'tools') {
    context = await projectContextFromId(decodeSegment(parts[2]))
    const config = await readProjectConfig()
    context = {
      ...context,
      ...(await loadSkillToolContext({
        globalSkillNames: config.globalSkills,
        projectSkillNames: context.project?.skills,
        workspaceRoot: context.workspaceRoot,
      })),
    }
    name = decodeSegment(parts[4])
  }

  if (isPluginToolName(name)) {
    await assertAccessModeAllowsDirectTool(name)
    const params = await readJsonBody(req)
    const result = await callPluginTool(name, params || {}, context)
    sendJson(res, 200, result)
    return
  }

  const handler = toolHandlers[name]
  if (!handler || directRouteDisabledTools.has(name)) {
    const error = new Error(`Unknown tool: ${name}`)
    error.statusCode = 404
    throw error
  }

  await assertAccessModeAllowsDirectTool(name)

  const params = await readJsonBody(req)
  const result = await handler(params || {}, context)
  sendJson(res, 200, result)
}
