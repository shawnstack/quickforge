import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  getSessionState: vi.fn(),
  readStore: vi.fn(),
  restoreAgent: vi.fn(),
  defaultWorkspaceRoot: '',
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(async () => {}),
  approveToolCall: vi.fn(),
  createAgent: mocks.createAgent,
  destroyAgent: vi.fn(async () => {}),
  getSessionEventBus: vi.fn(),
  getSessionState: mocks.getSessionState,
  listSessions: vi.fn(() => []),
  rejectToolCall: vi.fn(),
  restoreAgent: mocks.restoreAgent,
  runPrompt: vi.fn(),
  updateSessionModel: vi.fn(),
  updateSessionThinkingLevel: vi.fn(),
}))

vi.mock('../../../server/project-config.mjs', () => ({
  getActiveProject: vi.fn(() => null),
  getDefaultWorkspaceRoot: vi.fn(() => mocks.defaultWorkspaceRoot),
  readProjectConfig: vi.fn(async () => ({ projects: [], activeProjectId: null })),
  sameProjectPath: vi.fn((left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()),
  setActiveProjectPath: vi.fn(async () => ({ project: null })),
  setDefaultWorkspaceRoot: vi.fn((root) => {
    mocks.defaultWorkspaceRoot = path.resolve(root)
  }),
}))

vi.mock('../../../server/storage.mjs', () => ({
  dataDir: path.join(os.tmpdir(), 'quickforge-acp-model-test-data'),
  readSessionValue: vi.fn(),
  readStore: mocks.readStore,
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const visibleModel = {
  id: 'visible',
  name: 'Internal visible name',
  provider: 'Provider A',
  api: 'openai-completions',
  baseUrl: 'https://visible.example/v1',
}
const hiddenModel = {
  id: 'hidden',
  name: 'Internal hidden name',
  provider: 'Provider B',
  api: 'openai-completions',
  baseUrl: 'https://hidden.example/v1',
  quickforgeHidden: true,
}

let tmpDir

beforeEach(async () => {
  vi.resetModules()
  mocks.createAgent.mockReset()
  mocks.getSessionState.mockReset()
  mocks.readStore.mockReset()
  mocks.restoreAgent.mockReset()
  mocks.defaultWorkspaceRoot = ''
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-acp-model-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function configureStores({ activeModel = hiddenModel } = {}) {
  mocks.readStore.mockImplementation(async (store) => {
    if (store === 'custom-providers') {
      return {
        visible: { id: 'visible-provider', name: 'Visible', models: [visibleModel] },
        hidden: { id: 'hidden-provider', name: 'Hidden', models: [hiddenModel] },
      }
    }
    if (store === 'settings') {
      return { 'active-model': JSON.stringify(activeModel) }
    }
    return {}
  })
}

describe('ACP model visibility', () => {
  it('does not let a stale active-model snapshot select a hidden model for a new session', async () => {
    configureStores({ activeModel: { ...hiddenModel, quickforgeHidden: undefined } })
    const workspace = path.join(tmpDir, 'workspace')
    await fs.mkdir(workspace)

    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    await agent.newSession({ cwd: workspace, _meta: { quickforgeSessionId: 'new-acp-session' } })

    expect(mocks.createAgent).toHaveBeenCalledWith('new-acp-session', expect.objectContaining({ model: visibleModel }))
  })

  it('keeps the hidden current model when loading an existing ACP session', async () => {
    configureStores()
    const workspace = path.join(tmpDir, 'workspace')
    await fs.mkdir(workspace)
    mocks.restoreAgent.mockResolvedValue({ projectId: null })
    mocks.getSessionState.mockReturnValue({
      model: hiddenModel,
      thinkingLevel: 'off',
      messages: [],
    })

    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    const result = await agent.loadSession({ sessionId: 'existing-acp-session', cwd: workspace })
    const modelOption = result.configOptions.find((option) => option.id === 'quickforge.model')
    const names = modelOption.options.flatMap((group) => group.options.map((option) => option.name))

    expect(names).toEqual(['Provider B / hidden', 'Provider A / visible'])
    expect(names).not.toContain('Internal hidden name')
  })
})
