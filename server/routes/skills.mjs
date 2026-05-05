import { sendJson, readJsonBody } from '../utils/response.mjs'
import { getActiveProject, readProjectConfig } from '../project-config.mjs'
import { atomicProjectConfigUpdate } from '../storage.mjs'
import { filterKnownSkillNames, listSkillSummaries } from '../skills.mjs'

function getProject(config, projectId) {
  if (!projectId) return getActiveProject(config)
  return config.projects.find((project) => project.id === projectId)
}

function selectedSkillsForProject(project) {
  return Array.isArray(project?.skills) ? project.skills : []
}

export async function handleSkillsApi(req, res, url) {
  const config = await readProjectConfig()
  const projectId = url.searchParams.get('projectId')

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const project = getProject(config, projectId)
    sendJson(res, 200, {
      skills: await listSkillSummaries(),
      projectId: project?.id ?? null,
      selectedSkills: selectedSkillsForProject(project),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/project') {
    const project = getProject(config, projectId)
    sendJson(res, 200, {
      projectId: project?.id ?? null,
      selectedSkills: selectedSkillsForProject(project),
    })
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/skills/project') {
    const body = await readJsonBody(req)
    const targetProjectId = body?.projectId || projectId
    if (!targetProjectId) {
      const error = new Error('Missing projectId')
      error.statusCode = 400
      throw error
    }

    const selectedSkills = await filterKnownSkillNames(body?.selectedSkills)
    const updated = await atomicProjectConfigUpdate((cfg) => {
      const project = cfg.projects.find((item) => item.id === targetProjectId)
      if (!project) {
        const error = new Error('Unknown project')
        error.statusCode = 404
        throw error
      }
      project.skills = selectedSkills
      return cfg
    })

    const project = updated.projects.find((item) => item.id === targetProjectId)
    sendJson(res, 200, {
      projectId: targetProjectId,
      selectedSkills: selectedSkillsForProject(project),
      projects: updated.projects,
    })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
