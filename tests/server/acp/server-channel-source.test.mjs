import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  defaultWorkspaceRoot: '',
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  abortRun: vi.fn(async () => {}),
  approveToolCall: vi.fn(),
  createAgent: mocks.createAgent,
  destroyAgent: vi.fn(async () => {}),
  getSessionEventBus: vi.fn(),
  getSessionState: vi.fn(),
  listSessions: vi.fn(() => []),
  rejectToolCall: vi.fn(),
  restoreAgent: vi.fn(),
  runPrompt: vi.fn(),
  updateSessionModel: vi.fn(),
  updateSessionThinkingLevel: vi.fn(),
}))

vi.mock('../../../server/project-config.mjs', () => ({
  getActiveProject: vi.fn(() => null),
  getDefaultWorkspaceRoot: vi.fn(() => mocks.defaultWorkspaceRoot),
  readProjectConfig: vi.fn(async () => ({ projects: [], activeProjectId: null })),
  sameProjectPath: vi.fn((left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()),
  setActiveProjectPath: vi.fn(),
  setDefaultWorkspaceRoot: vi.fn((root) => {
    mocks.defaultWorkspaceRoot = path.resolve(root)
  }),
}))

vi.mock('../../../server/storage.mjs', () => ({
  dataDir: path.join(os.tmpdir(), 'quickforge-acp-channel-test-data'),
  readSessionValue: vi.fn(),
  readStore: vi.fn(async () => ({})),
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('ACP channel source', () => {
  let workspace
  let originalWorkspaceDir
  let originalChannelId
  let originalChannelName

  beforeEach(async () => {
    vi.resetModules()
    mocks.createAgent.mockReset()
    originalWorkspaceDir = process.env.QUICKFORGE_WORKSPACE_DIR
    originalChannelId = process.env.QUICKFORGE_ACP_CHANNEL_ID
    originalChannelName = process.env.QUICKFORGE_ACP_CHANNEL_NAME
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-acp-channel-'))
    mocks.defaultWorkspaceRoot = path.resolve(workspace)
    process.env.QUICKFORGE_WORKSPACE_DIR = workspace
    process.env.QUICKFORGE_ACP_CHANNEL_ID = 'wechat'
    process.env.QUICKFORGE_ACP_CHANNEL_NAME = '微信'
  })

  afterEach(async () => {
    if (originalWorkspaceDir === undefined) delete process.env.QUICKFORGE_WORKSPACE_DIR
    else process.env.QUICKFORGE_WORKSPACE_DIR = originalWorkspaceDir
    if (originalChannelId === undefined) delete process.env.QUICKFORGE_ACP_CHANNEL_ID
    else process.env.QUICKFORGE_ACP_CHANNEL_ID = originalChannelId
    if (originalChannelName === undefined) delete process.env.QUICKFORGE_ACP_CHANNEL_NAME
    else process.env.QUICKFORGE_ACP_CHANNEL_NAME = originalChannelName
    await fs.rm(workspace, { recursive: true, force: true })
  })

  it('passes channel identity into a new QuickForge session', async () => {
    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()

    await agent.newSession({
      cwd: workspace,
      mcpServers: [],
      _meta: { quickforgeSessionId: 'wechat-session' },
    })

    expect(mocks.createAgent).toHaveBeenCalledWith('wechat-session', expect.objectContaining({
      source: 'acp',
      channelId: 'wechat',
      channelName: '微信',
    }))
  })
})
