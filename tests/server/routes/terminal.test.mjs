import { Readable } from 'node:stream'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleTerminalApi, handleTerminalUpgrade } from '../../../server/routes/terminal.mjs'

const mocks = vi.hoisted(() => ({
  vendoredPtyEntryPath: vi.fn(),
  terminalCapabilities: vi.fn(),
  listTerminalSessions: vi.fn(),
  createTerminalSession: vi.fn(),
  attachTerminalClient: vi.fn(),
  writeTerminalInput: vi.fn(),
  destroyTerminalSession: vi.fn(),
  shutdownTerminalSessions: vi.fn(),
  platformInfo: vi.fn(),
  projectContextFromId: vi.fn(),
  readProjectConfig: vi.fn(),
  getActiveProject: vi.fn(),
  resolveTerminalShellProfile: vi.fn(),
  getWorkspaceRoot: vi.fn(),
  assertDirectory: vi.fn(),
}))

vi.mock('../../../server/terminal/terminal-manager.mjs', () => ({
  vendoredPtyEntryPath: mocks.vendoredPtyEntryPath,
  terminalCapabilities: mocks.terminalCapabilities,
  listTerminalSessions: mocks.listTerminalSessions,
  createTerminalSession: mocks.createTerminalSession,
  attachTerminalClient: mocks.attachTerminalClient,
  writeTerminalInput: mocks.writeTerminalInput,
  destroyTerminalSession: mocks.destroyTerminalSession,
  shutdownTerminalSessions: mocks.shutdownTerminalSessions,
  platformInfo: mocks.platformInfo,
}))

vi.mock('../../../server/project-config.mjs', () => ({
  projectContextFromId: mocks.projectContextFromId,
  readProjectConfig: mocks.readProjectConfig,
  getActiveProject: mocks.getActiveProject,
  resolveTerminalShellProfile: mocks.resolveTerminalShellProfile,
}))

vi.mock('../../../server/utils/workspace.mjs', () => ({
  getWorkspaceRoot: mocks.getWorkspaceRoot,
  assertDirectory: mocks.assertDirectory,
}))

const workspaceRoot = path.join(os.tmpdir(), 'qf-terminal-ws')

function jsonRequest(method, value) {
  const request = Readable.from([Buffer.from(JSON.stringify(value))])
  request.method = method
  request.headers = {}
  return request
}

function rawRequest(method, rawBody) {
  const request = Readable.from([Buffer.from(rawBody)])
  request.method = method
  request.headers = {}
  return request
}

function emptyRequest(method) {
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

const url = (pathname) => new URL(`http://localhost${pathname}`)

function fakeSocket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
    on() {},
    destroyed: false,
  }
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('terminal route access control', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.terminalCapabilities.mockResolvedValue({ enabled: true })
    mocks.platformInfo.mockResolvedValue({ platform: 'test', shell: 'test-shell' })
    mocks.listTerminalSessions.mockReturnValue([])
    mocks.createTerminalSession.mockResolvedValue({ id: 'term-1' })
    mocks.readProjectConfig.mockResolvedValue({ activeProjectId: null, projects: [] })
    mocks.getActiveProject.mockReturnValue(null)
    mocks.resolveTerminalShellProfile.mockResolvedValue(undefined)
    mocks.getWorkspaceRoot.mockReturnValue(workspaceRoot)
    mocks.assertDirectory.mockResolvedValue(undefined)
  })

  it('rejects non-local requests with 403', async () => {
    for (const options of [undefined, {}, { isLocalRequest: false }]) {
      await expect(handleTerminalApi(emptyRequest('GET'), mockResponse(), url('/api/terminal/capabilities'), options))
        .rejects.toMatchObject({ statusCode: 403, message: 'Terminal is only available from localhost' })
    }
  })

  it('rejects requests with the capabilities reason while the terminal is disabled', async () => {
    mocks.terminalCapabilities.mockResolvedValue({ enabled: false, reason: 'PTY unavailable' })
    await expect(handleTerminalApi(emptyRequest('GET'), mockResponse(), url('/api/terminal/capabilities'), { isLocalRequest: true }))
      .rejects.toMatchObject({ statusCode: 403, message: 'PTY unavailable' })
  })
})

describe('terminal route capabilities and sessions', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.terminalCapabilities.mockResolvedValue({ enabled: true, shells: ['test-shell'] })
    mocks.platformInfo.mockResolvedValue({ platform: 'test', shell: 'test-shell' })
    mocks.listTerminalSessions.mockReturnValue([{ id: 's1' }])
    mocks.createTerminalSession.mockResolvedValue({ id: 'term-1' })
    mocks.readProjectConfig.mockResolvedValue({ activeProjectId: null, projects: [] })
    mocks.getActiveProject.mockReturnValue(null)
    mocks.resolveTerminalShellProfile.mockResolvedValue(undefined)
    mocks.getWorkspaceRoot.mockReturnValue(workspaceRoot)
    mocks.assertDirectory.mockResolvedValue(undefined)
  })

  it('merges capabilities with platform info and marks the response private', async () => {
    const response = mockResponse()
    await handleTerminalApi(emptyRequest('GET'), response, url('/api/terminal/capabilities'), { isLocalRequest: true })
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ enabled: true, shells: ['test-shell'], platform: 'test', shell: 'test-shell' })
    expect(response.headers['cache-control']).toBe('private, max-age=300')
  })

  it('lists sessions and forwards the projectId filter', async () => {
    const withProject = mockResponse()
    await handleTerminalApi(emptyRequest('GET'), withProject, url('/api/terminal/sessions?projectId=project-1'), { isLocalRequest: true })
    expect(mocks.listTerminalSessions).toHaveBeenCalledWith('project-1')
    expect(withProject.body).toEqual({ sessions: [{ id: 's1' }] })

    const withoutProject = mockResponse()
    await handleTerminalApi(emptyRequest('GET'), withoutProject, url('/api/terminal/sessions'), { isLocalRequest: true })
    expect(mocks.listTerminalSessions).toHaveBeenCalledWith(undefined)
  })

  it('creates a session from the resolved project context and forwards the shell profile', async () => {
    mocks.projectContextFromId.mockResolvedValue({ workspaceRoot, project: { id: 'project-1' } })
    mocks.resolveTerminalShellProfile.mockResolvedValue({ id: 'pwsh-7', name: 'PowerShell 7' })
    const response = mockResponse()

    await handleTerminalApi(
      jsonRequest('POST', {
        projectId: 'project-1',
        name: 'build',
        cols: '80',
        rows: 24,
        shellProfileId: 'pwsh-7',
      }),
      response,
      url('/api/terminal/sessions'),
      { isLocalRequest: true },
    )

    expect(mocks.projectContextFromId).toHaveBeenCalledWith('project-1')
    expect(mocks.resolveTerminalShellProfile).toHaveBeenCalledWith('pwsh-7')
    expect(mocks.createTerminalSession).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      projectId: 'project-1',
      name: 'build',
      cols: 80,
      rows: 24,
      shellProfileId: 'pwsh-7',
      shellProfileName: 'PowerShell 7',
    })
    expect(response.status).toBe(201)
    expect(response.body).toEqual({ id: 'term-1' })
  })

  it('falls back to the workspace root with default dimensions when no project is given', async () => {
    const response = mockResponse()
    await handleTerminalApi(jsonRequest('POST', {}), response, url('/api/terminal/sessions'), { isLocalRequest: true })

    expect(mocks.projectContextFromId).not.toHaveBeenCalled()
    expect(mocks.getActiveProject).toHaveBeenCalled()
    expect(mocks.getWorkspaceRoot).toHaveBeenCalled()
    expect(mocks.assertDirectory).toHaveBeenCalledWith(workspaceRoot)
    expect(mocks.createTerminalSession).toHaveBeenCalledWith({
      cwd: path.resolve(workspaceRoot),
      projectId: null,
      name: undefined,
      cols: 120,
      rows: 30,
      shellProfileId: undefined,
      shellProfileName: undefined,
    })
    expect(response.status).toBe(201)
  })

  it('ignores non-string projectId values and resolves the workspace fallback instead', async () => {
    await handleTerminalApi(jsonRequest('POST', { projectId: 42 }), mockResponse(), url('/api/terminal/sessions'), { isLocalRequest: true })
    expect(mocks.projectContextFromId).not.toHaveBeenCalled()
    expect(mocks.createTerminalSession.mock.calls[0][0].projectId).toBeNull()
  })

  it('rejects malformed session bodies with 400', async () => {
    await expect(handleTerminalApi(
      rawRequest('POST', '{oops'),
      mockResponse(),
      url('/api/terminal/sessions'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 400, message: 'Invalid JSON request body' })
  })
})

describe('terminal route input and teardown', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.terminalCapabilities.mockResolvedValue({ enabled: true })
    mocks.platformInfo.mockResolvedValue({ platform: 'test' })
  })

  it('writes decoded input via the /input suffix path', async () => {
    const response = mockResponse()
    await handleTerminalApi(
      jsonRequest('POST', { data: 'ls\n' }),
      response,
      url('/api/terminal/sessions/session%2F1/input'),
      { isLocalRequest: true },
    )
    expect(mocks.writeTerminalInput).toHaveBeenCalledWith('session/1', 'ls\n')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
  })

  it('rejects non-string input data on the /input suffix path with 400', async () => {
    await expect(handleTerminalApi(
      jsonRequest('POST', { data: 42 }),
      mockResponse(),
      url('/api/terminal/sessions/s1/input'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 400, message: 'Terminal input data is required' })
  })

  it('writes input via the direct session path', async () => {
    const response = mockResponse()
    await handleTerminalApi(
      jsonRequest('PUT', { data: 'whoami' }),
      response,
      url('/api/terminal/sessions/s1'),
      { isLocalRequest: true },
    )
    expect(mocks.writeTerminalInput).toHaveBeenCalledWith('s1', 'whoami')
    expect(response.body).toEqual({ ok: true })
  })

  it('rejects non-string input data on the direct session path with 400', async () => {
    await expect(handleTerminalApi(
      jsonRequest('POST', {}),
      mockResponse(),
      url('/api/terminal/sessions/s1'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 400, message: 'Terminal input data is required' })
  })

  it('destroys the session on DELETE', async () => {
    const response = mockResponse()
    await handleTerminalApi(emptyRequest('DELETE'), response, url('/api/terminal/sessions/s1'), { isLocalRequest: true })
    expect(mocks.destroyTerminalSession).toHaveBeenCalledWith('s1')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ ok: true })
  })

  it('falls through to 404 for unknown terminal routes', async () => {
    await expect(handleTerminalApi(
      emptyRequest('GET'),
      mockResponse(),
      url('/api/terminal/unknown'),
      { isLocalRequest: true },
    )).rejects.toMatchObject({ statusCode: 404, message: 'Not found' })
  })
})

describe('terminal websocket upgrade', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
    mocks.terminalCapabilities.mockResolvedValue({ enabled: true })
  })

  it('writes a 404 status line and destroys the socket for unknown upgrade paths', async () => {
    const socket = fakeSocket()
    handleTerminalUpgrade({ method: 'GET' }, socket, Buffer.alloc(0), url('/api/terminal/unknown/ws'), { isLocalRequest: true })
    await flushAsync()

    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 404 Not found\r\n\r\n')
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })

  it('writes a 403 status line for non-local upgrade requests', async () => {
    const socket = fakeSocket()
    handleTerminalUpgrade({ method: 'GET' }, socket, Buffer.alloc(0), url('/api/terminal/sessions/s1/ws'), {})
    await flushAsync()

    expect(socket.write).toHaveBeenCalledWith('HTTP/1.1 403 Terminal is only available from localhost\r\n\r\n')
    expect(socket.destroy).toHaveBeenCalledTimes(1)
  })
})
