import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agentProfileSnapshot: vi.fn(),
  getAgentProfile: vi.fn(),
  updateBuiltinAgentOverrides: vi.fn(),
  updateCustomAgentProfile: vi.fn(),
}))

vi.mock('../../../server/agent-profiles.mjs', () => ({
  agentProfileSnapshot: mocks.agentProfileSnapshot,
  createCustomAgentProfile: vi.fn(),
  deleteCustomAgentProfile: vi.fn(),
  getAgentProfile: mocks.getAgentProfile,
  listAgentProfiles: vi.fn(),
  listAvailableAgentTools: vi.fn(),
  updateBuiltinAgentOverrides: mocks.updateBuiltinAgentOverrides,
  updateCustomAgentProfile: mocks.updateCustomAgentProfile,
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = {}
  return req
}

function response() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status },
    end(body = '') { this.body = body },
  }
}

describe('built-in agent profile PATCH route', () => {
  beforeEach(() => {
    mocks.agentProfileSnapshot.mockReset()
    mocks.agentProfileSnapshot.mockImplementation((agent) => agent)
    mocks.getAgentProfile.mockReset()
    mocks.updateBuiltinAgentOverrides.mockReset()
    mocks.updateCustomAgentProfile.mockReset()
  })

  it('accepts model and thinkingLevel in one request', async () => {
    mocks.getAgentProfile.mockResolvedValue({ id: 'explore', name: 'explore', builtin: true, readonly: true })
    mocks.updateBuiltinAgentOverrides.mockResolvedValue({ id: 'explore', name: 'explore', builtin: true, model: { mode: 'inherit' }, thinkingLevel: 'high' })
    const { handleAgentProfilesApi } = await import('../../../server/routes/agent-profiles.mjs')
    const res = response()

    await handleAgentProfilesApi(
      request('PATCH', { model: { mode: 'inherit' }, thinkingLevel: 'high' }),
      res,
      new URL('http://localhost/api/agent-profiles/explore'),
    )

    expect(mocks.updateBuiltinAgentOverrides).toHaveBeenCalledWith('explore', { model: { mode: 'inherit' }, thinkingLevel: 'high' })
    expect(mocks.updateCustomAgentProfile).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ agent: { id: 'explore', name: 'explore', builtin: true, model: { mode: 'inherit' }, thinkingLevel: 'high' } })
  })

  it('rejects other fields for built-in agents', async () => {
    mocks.getAgentProfile.mockResolvedValue({ id: 'explore', name: 'explore', builtin: true, readonly: true })
    const { handleAgentProfilesApi } = await import('../../../server/routes/agent-profiles.mjs')

    await expect(handleAgentProfilesApi(
      request('PATCH', { systemPrompt: 'hacked' }),
      response(),
      new URL('http://localhost/api/agent-profiles/explore'),
    )).rejects.toMatchObject({ statusCode: 403 })

    await expect(handleAgentProfilesApi(
      request('PATCH', {}),
      response(),
      new URL('http://localhost/api/agent-profiles/explore'),
    )).rejects.toMatchObject({ statusCode: 403 })

    expect(mocks.updateBuiltinAgentOverrides).not.toHaveBeenCalled()
  })
})
