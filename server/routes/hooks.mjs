import { sendJson, readJsonBody } from '../utils/response.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { normalizeHook } from '../hooks/hooks-settings.mjs'
import { executeHook } from '../hooks/hook-executor.mjs'
import { getRecentHookExecutions } from '../hooks/hook-engine.mjs'

export async function handleHooksApi(req, res, url, context = { isLocalRequest: true }) {
  if (!isAuthenticatedAppClient(context)) {
    const error = new Error('Hooks access requires a local or authenticated remote client.')
    error.statusCode = 403
    error.errorCode = 'hooks_auth_required'
    throw error
  }

  if (req.method === 'GET' && url.pathname === '/api/hooks/executions') {
    sendJson(res, 200, { executions: getRecentHookExecutions() })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/hooks/test') {
    const body = await readJsonBody(req)
    const hook = normalizeHook(body?.hook)
    if (!hook) {
      const error = new Error('A valid hook payload is required')
      error.statusCode = 400
      throw error
    }
    // Manual test runs use a synthetic context and never enter the in-memory
    // execution log.
    const execution = await executeHook(hook, {
      event: 'test',
      sessionId: '',
      project: '',
      projectPath: '',
      toolName: '',
      message: '',
    }, { test: true })
    sendJson(res, 200, { execution })
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
