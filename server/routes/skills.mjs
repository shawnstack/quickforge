import { sendJson, readJsonBody } from '../utils/response.mjs'
import { getActiveProject, projectContextFromId, readProjectConfig } from '../project-config.mjs'
import { atomicProjectConfigUpdate } from '../storage.mjs'
import {
  filterKnownGlobalSkillNames,
  filterKnownProjectSkillNames,
  projectSkillSearchPaths,
  listGlobalSkillSummaries,
  listProjectSkillSummaries,
  skillSearchPaths,
} from '../skills.mjs'

function getProject(config, projectId) {
  if (!projectId) return getActiveProject(config)
  return config.projects.find((project) => project.id === projectId)
}

function selectedSkillsForProject(project) {
  return Array.isArray(project?.skills) ? project.skills : []
}

function selectedGlobalSkills(config) {
  return Array.isArray(config.globalSkills) ? config.globalSkills : []
}

function filterSelectedSkills(selectedSkills, skills) {
  const known = new Set(skills.map((skill) => skill.name))
  return selectedSkills.filter((name) => known.has(name))
}

async function projectWorkspaceRoot(projectId) {
  if (!projectId) return null
  try {
    const context = await projectContextFromId(projectId)
    return context.workspaceRoot
  } catch {
    return null
  }
}

export async function handleSkillsApi(req, res, url) {
  const config = await readProjectConfig()
  const projectId = url.searchParams.get('projectId')
  const scope = url.searchParams.get('scope') === 'global' ? 'global' : 'project'

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    if (scope === 'global') {
      sendJson(res, 200, {
        scope: 'global',
        skills: await listGlobalSkillSummaries(),
        selectedSkills: selectedGlobalSkills(config),
        searchPaths: skillSearchPaths.global,
      })
      return
    }

    const project = getProject(config, projectId)
    const workspaceRoot = await projectWorkspaceRoot(project?.id)
    const skills = workspaceRoot ? await listProjectSkillSummaries(workspaceRoot) : []
    sendJson(res, 200, {
      scope: 'project',
      skills,
      projectId: project?.id ?? null,
      selectedSkills: filterSelectedSkills(selectedSkillsForProject(project), skills),
      searchPaths: workspaceRoot ? projectSkillSearchPaths(workspaceRoot) : skillSearchPaths.project,
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/global') {
    sendJson(res, 200, {
      scope: 'global',
      selectedSkills: selectedGlobalSkills(config),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/project') {
    const project = getProject(config, projectId)
    sendJson(res, 200, {
      scope: 'project',
      projectId: project?.id ?? null,
      selectedSkills: selectedSkillsForProject(project),
    })
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/skills/global') {
    const body = await readJsonBody(req)
    const selectedSkills = await filterKnownGlobalSkillNames(body?.selectedSkills)
    const updated = await atomicProjectConfigUpdate((cfg) => {
      cfg.globalSkills = selectedSkills
      return cfg
    })

    sendJson(res, 200, {
      scope: 'global',
      selectedSkills: selectedGlobalSkills(updated),
      projects: updated.projects,
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

    const workspaceRoot = await projectWorkspaceRoot(targetProjectId)
    if (!workspaceRoot) {
      const error = new Error('Unknown project')
      error.statusCode = 404
      throw error
    }

    const selectedSkills = await filterKnownProjectSkillNames(body?.selectedSkills, workspaceRoot)
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
      scope: 'project',
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
