import { sendJson } from '../utils/response.mjs'
import { buildInstructionsPayload } from '../project-config.mjs'
import { BASE_SYSTEM_PROMPT, composeSystemPrompt } from '../system-prompt.mjs'

export async function handleInstructionsApi(req, res, url) {
  if (req.method !== 'GET') {
    const error = new Error('Method not allowed')
    error.statusCode = 405
    throw error
  }

  const projectId = url.searchParams.get('projectId')
  const instructions = await buildInstructionsPayload(projectId)

  sendJson(res, 200, {
    base: BASE_SYSTEM_PROMPT,
    systemPrompt: composeSystemPrompt(instructions),
    ...instructions,
  })
}
