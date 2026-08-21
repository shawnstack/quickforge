import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSessionState: vi.fn(),
  readSessionValue: vi.fn(),
  readStore: vi.fn(),
  restoreAgent: vi.fn(),
  runPrompt: vi.fn(),
  updateSessionModel: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(),
  getSessionEventBus: vi.fn(),
  getSessionState: mocks.getSessionState,
  restoreAgent: mocks.restoreAgent,
  runPrompt: mocks.runPrompt,
  updateSessionModel: mocks.updateSessionModel,
  updateSessionThinkingLevel: vi.fn(),
}))

vi.mock('../../../server/storage.mjs', () => ({
  readSessionValue: mocks.readSessionValue,
  readStore: mocks.readStore,
}))

vi.mock('../../../server/routes/session-assets.mjs', () => ({
  sendSessionAsset: vi.fn(),
}))

vi.mock('../../../server/share-store.mjs', () => ({
  assertShareActive: vi.fn(),
  issueConversationShareToken: vi.fn(),
  onConversationShareInvalidated: vi.fn(() => () => undefined),
  parseCookies: vi.fn(() => new Map([['share', 'token']])),
  readConversationShare: vi.fn(async () => ({
    id: 'share-1',
    sessionId: 'session-1',
    permission: 'operate',
    passwordHash: 'hash',
    scope: 'global',
  })),
  rollbackSharedSessionMessages: vi.fn(),
  shareCookieName: vi.fn(() => 'share'),
  verifySharePassword: vi.fn(),
  verifyShareToken: vi.fn(() => true),
}))

const visibleModel = {
  id: 'visible',
  provider: 'Provider A',
  api: 'openai-completions',
  baseUrl: 'https://visible.example/v1',
}
const currentHiddenModel = {
  id: 'current-hidden',
  provider: 'Provider B',
  api: 'openai-completions',
  baseUrl: 'https://hidden.example/v1',
  quickforgeHidden: true,
}
const otherHiddenModel = {
  ...currentHiddenModel,
  id: 'other-hidden',
}

function request(method, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = { cookie: 'share=token' }
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

function response() {
  return {
    status: undefined,
    body: '',
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
    writeHead(status, headers = {}) {
      this.status = status
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
    },
    end(body = '') { this.body += body },
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.getSessionState.mockReset()
  mocks.readSessionValue.mockReset()
  mocks.readStore.mockReset()
  mocks.restoreAgent.mockReset()
  mocks.runPrompt.mockReset()
  mocks.updateSessionModel.mockReset()
  mocks.getSessionState.mockReturnValue({ model: currentHiddenModel, messages: [], thinkingLevel: 'off' })
  mocks.readSessionValue.mockResolvedValue(null)
  mocks.readStore.mockResolvedValue({
    visible: { id: 'visible-provider', name: 'Visible', models: [visibleModel] },
    hidden: { id: 'hidden-provider', name: 'Hidden', models: [currentHiddenModel, otherHiddenModel] },
  })
})

describe('shared conversation context reference safety', () => {
  it('rejects non-empty references before restoring or prompting', async () => {
    const { handleSharedConversationApi } = await import('../../../server/routes/shared-conversation.mjs')

    await expect(handleSharedConversationApi(
      request('POST', { content: 'inspect', contextReferences: [{ type: 'file', projectId: 'project-1', path: 'src/app.ts' }] }),
      response(),
      new URL('http://localhost/api/shared/share-1/message'),
    )).rejects.toMatchObject({ statusCode: 409, errorCode: 'CONTEXT_REFERENCES_UNSUPPORTED_SHARED' })

    expect(mocks.restoreAgent).not.toHaveBeenCalled()
    expect(mocks.runPrompt).not.toHaveBeenCalled()
  })

  it('strips contextReferences but preserves selectedCapabilities in shared session history', async () => {
    const selectedCapabilities = [{ type: 'plugin', pluginName: 'documents', name: 'documents', label: 'Documents' }]
    mocks.getSessionState.mockReturnValue({
      model: currentHiddenModel,
      messages: [
        { role: 'user', content: 'inspect', details: { contextReferences: [{ path: 'src/private.ts' }], selectedCapabilities, keep: true } },
        { role: 'assistant', content: 'done', details: { contextReferences: [{ path: 'src/private.ts' }] } },
      ],
      thinkingLevel: 'off',
    })
    const { handleSharedConversationApi } = await import('../../../server/routes/shared-conversation.mjs')
    const res = response()

    await handleSharedConversationApi(request('GET'), res, new URL('http://localhost/api/shared/share-1/session'))

    const messages = JSON.parse(res.body).messages
    expect(messages[0].details).toEqual({ selectedCapabilities, keep: true })
    expect(messages[1]).not.toHaveProperty('details')
    expect(JSON.stringify(messages)).not.toContain('src/private.ts')
  })
})

describe('shared conversation model visibility', () => {
  it('lists selectable models plus only the current hidden binding', async () => {
    const { handleSharedConversationApi } = await import('../../../server/routes/shared-conversation.mjs')
    const res = response()

    await handleSharedConversationApi(
      request('GET'),
      res,
      new URL('http://localhost/api/shared/share-1/models'),
    )

    const models = JSON.parse(res.body).providers.flatMap((provider) => provider.models)
    expect(models.map((model) => model.id)).toEqual(['current-hidden', 'visible'])
  })

  it('rejects selecting another hidden model but allows keeping the current hidden model', async () => {
    const { handleSharedConversationApi } = await import('../../../server/routes/shared-conversation.mjs')

    await expect(handleSharedConversationApi(
      request('POST', { model: otherHiddenModel }),
      response(),
      new URL('http://localhost/api/shared/share-1/model'),
    )).rejects.toMatchObject({ statusCode: 400 })

    mocks.updateSessionModel.mockReturnValue({ model: currentHiddenModel })
    const res = response()
    await handleSharedConversationApi(
      request('POST', { model: currentHiddenModel }),
      res,
      new URL('http://localhost/api/shared/share-1/model'),
    )

    expect(mocks.updateSessionModel).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ id: 'current-hidden' }),
      expect.objectContaining({ source: 'custom', modelId: 'current-hidden' }),
    )
  })
})
