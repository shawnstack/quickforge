import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { handleProjectApi } from '../../../server/routes/project.mjs'

function request() {
  const req = Readable.from([])
  req.method = 'POST'
  req.headers = {}
  return req
}

function response() {
  return { writeHead() {}, end() {} }
}

describe('project remote access policy', () => {
  for (const pathname of [
    '/api/project/select-directory',
    '/api/project/project-1/open-in-explorer',
    '/api/project/project-1/open-in-vscode',
    '/api/project/project-1/open-in-idea',
    '/api/project/open-path',
  ]) {
    it(`rejects remote local-application action ${pathname}`, async () => {
      await expect(handleProjectApi(
        request(),
        response(),
        new URL(`http://localhost${pathname}`),
        { isLocalRequest: false },
      )).rejects.toMatchObject({ statusCode: 403 })
    })
  }
})
