import path from 'node:path'

export function resolveRequestedProject(config, projectId, defaultWorkspaceRoot) {
  if (!projectId) return config.projects.find((project) => project.id === config.activeProjectId) ?? config.projects[0]
  if (projectId === 'default') {
    return {
      id: 'default',
      name: 'workspace',
      path: defaultWorkspaceRoot,
      lastOpenedAt: '',
      sortOrder: 0,
      skills: [],
      commandDir: '',
    }
  }
  const project = config.projects.find((item) => item.id === projectId)
  if (project) return project
  const error = new Error('Unknown project')
  error.statusCode = 404
  throw error
}

export function workspaceRootAfterProjectDeletion(activeProject, defaultWorkspaceRoot) {
  return path.resolve(activeProject?.path || defaultWorkspaceRoot)
}
