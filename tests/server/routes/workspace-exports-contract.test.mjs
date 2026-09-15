import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import * as workspace from '../../../server/routes/workspace.mjs'

const exports = [
  'isAbortError', 'createRequestAbortState', 'git', 'listGitStatus',
  'compareWorkspaceEntries', 'listWorkspaceChildren', 'readValidatedWorkspaceSearchDirectory',
  'searchWorkspace', 'listWorkspaceMentionChildren', 'searchWorkspaceMentions',
  'workspacePreviewIssueFromError', 'inspectWorkspacePreviewFile', 'buildPreviewEtag',
  'openWorkspaceExternalPath', 'commitAndPushGitChanges', 'handleWorkspaceApi', 'handleGitApi',
]

describe('workspace route facade compatibility', () => {
  it('keeps exactly the original named function exports', () => {
    expect(Object.keys(workspace).sort()).toEqual(exports.sort())
    for (const name of exports) expect(workspace[name]).toBeTypeOf('function')
  })

  it('distinguishes completed response close from premature close and cleans listeners', () => {
    const req = new EventEmitter()
    const res = new EventEmitter()
    res.writableEnded = true
    const request = workspace.createRequestAbortState(req, res)
    res.emit('close')
    expect(request.signal.aborted).toBe(false)
    res.writableEnded = false
    res.emit('close')
    // The once-listener has already consumed the completed close.
    expect(request.signal.aborted).toBe(false)
    req.emit('aborted')
    expect(request.signal.aborted).toBe(true)
    request.dispose()
    expect(req.listenerCount('aborted')).toBe(0)
    expect(res.listenerCount('close')).toBe(0)
  })

  it('aborts a prematurely closed response and can dispose before events', () => {
    const req = new EventEmitter()
    const res = new EventEmitter()
    const request = workspace.createRequestAbortState(req, res)
    res.emit('close')
    expect(request.signal.aborted).toBe(true)
    request.dispose()
    const disposed = workspace.createRequestAbortState(req, res)
    disposed.dispose()
    req.emit('aborted')
    res.emit('close')
    expect(disposed.signal.aborted).toBe(false)
  })

  it('rejects remote application opening before consuming any request body', async () => {
    await expect(workspace.handleWorkspaceApi(
      { method: 'POST' }, {}, new URL('http://localhost/api/workspace/open-external'),
    )).rejects.toMatchObject({ statusCode: 403, message: 'Opening applications is only allowed from this computer' })
  })

  it.each(['handleWorkspaceApi', 'handleGitApi'])('%s keeps unknown route errors', async (name) => {
    await expect(workspace[name]({ method: 'GET' }, {}, new URL('http://localhost/unknown')))
      .rejects.toMatchObject({ statusCode: 404, message: 'Not found' })
  })

  it('preserves explicit preview errors and abort error detection', () => {
    expect(workspace.workspacePreviewIssueFromError({ statusCode: 413, previewCode: 'PREVIEW_FILE_TOO_LARGE', message: 'too large' }, 'a.html'))
      .toEqual({ status: 413, payload: { error: 'too large', code: 'PREVIEW_FILE_TOO_LARGE', path: 'a.html' } })
    expect(workspace.isAbortError({ name: 'AbortError' })).toBe(true)
    expect(workspace.isAbortError({ code: 'ABORT_ERR' })).toBe(true)
    expect(workspace.isAbortError({ code: 'GIT_TIMEOUT' })).toBe(false)
    expect(workspace.isAbortError(null)).toBe(false)
  })
})
