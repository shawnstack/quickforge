import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleInstructionsApi } from '../../../server/routes/instructions.mjs'
import { BASE_SYSTEM_PROMPT } from '../../../server/system-prompt.mjs'

const mocks = vi.hoisted(() => ({
  buildInstructionsPayload: vi.fn(),
}))

vi.mock('../../../server/project-config.mjs', () => ({
  buildInstructionsPayload: mocks.buildInstructionsPayload,
}))

function mockRequest(method) {
  const request = Readable.from([])
  request.method = method
  request.headers = {}
  return request
}

function mockResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers = {}) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body ? JSON.parse(body) : null
    },
  }
}

const samplePayload = () => ({
  workspace: { id: 'project-42', name: 'Demo', root: pathLikeWorkspaceRoot() },
  globalSources: [{ source: 'CLAUDE.md', content: 'Use Chinese by default.' }],
  projectSources: [],
  globalMemory: { enabled: false },
  globalSkills: [],
  projectSkills: [],
})

function pathLikeWorkspaceRoot() {
  return process.platform === 'win32' ? 'C:\\workspaces\\demo' : '/workspaces/demo'
}

describe('instructions route', () => {
  beforeEach(() => {
    mocks.buildInstructionsPayload.mockReset()
  })

  it('rejects non-GET requests with 405', async () => {
    await expect(handleInstructionsApi(
      mockRequest('POST'),
      mockResponse(),
      new URL('http://localhost/api/instructions'),
    )).rejects.toMatchObject({ statusCode: 405, message: 'Method not allowed' })
  })

  it('passes the projectId query parameter to buildInstructionsPayload', async () => {
    mocks.buildInstructionsPayload.mockResolvedValue(samplePayload())
    const response = mockResponse()

    await handleInstructionsApi(
      mockRequest('GET'),
      response,
      new URL('http://localhost/api/instructions?projectId=project-42'),
    )

    expect(mocks.buildInstructionsPayload).toHaveBeenCalledWith('project-42')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8')
  })

  it('returns null when no projectId is requested', async () => {
    mocks.buildInstructionsPayload.mockResolvedValue(samplePayload())

    await handleInstructionsApi(
      mockRequest('GET'),
      mockResponse(),
      new URL('http://localhost/api/instructions'),
    )

    expect(mocks.buildInstructionsPayload).toHaveBeenCalledWith(null)
  })

  it('responds with the base prompt, the composed system prompt, and the spread payload', async () => {
    const payload = samplePayload()
    mocks.buildInstructionsPayload.mockResolvedValue(payload)
    const response = mockResponse()

    await handleInstructionsApi(
      mockRequest('GET'),
      response,
      new URL('http://localhost/api/instructions?projectId=project-42'),
    )

    expect(response.body.base).toBe(BASE_SYSTEM_PROMPT)
    expect(response.body.systemPrompt).toContain(BASE_SYSTEM_PROMPT)
    expect(response.body.systemPrompt).toContain('<workspace_context>')
    expect(response.body.systemPrompt).toContain('Project name: Demo')
    expect(response.body.systemPrompt).toContain('<user_instructions source="CLAUDE.md">')
    expect(response.body.systemPrompt).toContain('Use Chinese by default.')
    expect(response.body.workspace).toEqual(payload.workspace)
    expect(response.body.globalSources).toEqual(payload.globalSources)
  })

  it('propagates buildInstructionsPayload failures', async () => {
    mocks.buildInstructionsPayload.mockRejectedValue(new Error('config unavailable'))
    await expect(handleInstructionsApi(
      mockRequest('GET'),
      mockResponse(),
      new URL('http://localhost/api/instructions'),
    )).rejects.toThrow('config unavailable')
  })
})
