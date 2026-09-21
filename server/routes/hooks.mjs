import { sendJson, readJsonBody } from '../utils/response.mjs'
import { isAuthenticatedAppClient } from '../access-policy.mjs'
import { normalizeHook } from '../hooks/hooks-settings.mjs'
import { executeHook } from '../hooks/hook-executor.mjs'
import { getHookExecutionsPage } from '../hooks/hook-engine.mjs'

export async function handleHooksApi(req, res, url, context = { isLocalRequest: true }) {
  if (!isAuthenticatedAppClient(context)) {
    const error = new Error('Hooks access requires a local or authenticated remote client.')
    error.statusCode = 403
    error.errorCode = 'hooks_auth_required'
    throw error
  }

  if (req.method === 'GET' && url.pathname === '/api/hooks/executions') {
    // Pagination params are best-effort: absent or unparsable values fall
    // back to the engine defaults (limit 20, offset 0) inside the pager.
    const limitParam = url.searchParams.get('limit')
    const offsetParam = url.searchParams.get('offset')
    sendJson(res, 200, getHookExecutionsPage({
      limit: limitParam === null ? undefined : Number.parseInt(limitParam, 10),
      offset: offsetParam === null ? undefined : Number.parseInt(offsetParam, 10),
    }))
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
