import path from 'node:path'
import { sendJson } from '../utils/response.mjs'
import { readInstructionsFile, projectContextFromId } from '../project-config.mjs'
import { dataDir } from '../storage.mjs'

export async function handleInstructionsApi(req, res, url) {
  if (req.method !== 'GET') {
    const error = new Error('Method not allowed')
    error.statusCode = 405
    throw error
  }

  const projectId = url.searchParams.get('projectId')
  let projectInstructions = null

  if (projectId) {
    try {
      const { workspaceRoot } = await projectContextFromId(projectId)
      projectInstructions = await readInstructionsFile(path.join(workspaceRoot, 'AGENTS.md'))
    } catch {
      // project not found or inaccessible — leave projectInstructions null
    }
  }

  const globalInstructions = await readInstructionsFile(path.join(dataDir, 'AGENTS.md'))

  sendJson(res, 200, {
    global: globalInstructions,
    project: projectInstructions,
  })
}
