import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => ({
  createAgent: vi.fn(),
  readStore: vi.fn(),
  readSessionValue: vi.fn(),
  setActiveProjectPath: vi.fn(),
  projectConfig: { projects: [], activeProjectId: null },
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
  getActiveProject: vi.fn((config) => config.projects.find((project) => project.id === config.activeProjectId) || config.projects[0]),
  getDefaultWorkspaceRoot: vi.fn(() => mocks.defaultWorkspaceRoot),
  readProjectConfig: vi.fn(async () => mocks.projectConfig),
  sameProjectPath: vi.fn((left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()),
  setActiveProjectPath: mocks.setActiveProjectPath,
  setDefaultWorkspaceRoot: vi.fn((root) => {
    mocks.defaultWorkspaceRoot = path.resolve(root)
  }),
}))

vi.mock('../../../server/storage.mjs', () => ({
  dataDir: path.join(os.tmpdir(), 'quickforge-acp-test-data'),
  readSessionValue: mocks.readSessionValue,
  readStore: mocks.readStore,
}))

vi.mock('../../../server/utils/logger.mjs', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

let tmpDir
let originalWorkspaceDir

beforeEach(async () => {
  vi.resetModules()
  mocks.createAgent.mockReset()
  mocks.readSessionValue.mockReset()
  mocks.readStore.mockReset()
  mocks.readStore.mockResolvedValue({})
  mocks.setActiveProjectPath.mockReset()
  mocks.projectConfig = { projects: [], activeProjectId: null }
  mocks.defaultWorkspaceRoot = ''
  originalWorkspaceDir = process.env.QUICKFORGE_WORKSPACE_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-acp-workspace-'))
})

afterEach(async () => {
  if (originalWorkspaceDir === undefined) delete process.env.QUICKFORGE_WORKSPACE_DIR
  else process.env.QUICKFORGE_WORKSPACE_DIR = originalWorkspaceDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('ACP workspace mapping', () => {
  it('stores sessions from the configured default workspace as global conversations', async () => {
    const workspace = path.join(tmpDir, 'workspace')
    await fs.mkdir(workspace)
    process.env.QUICKFORGE_WORKSPACE_DIR = workspace

    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    await agent.newSession({
      cwd: workspace,
      mcpServers: [],
      _meta: { quickforgeSessionId: 'default-workspace-session' },
    })

    expect(mocks.defaultWorkspaceRoot).toBe(path.resolve(workspace))
    expect(mocks.setActiveProjectPath).not.toHaveBeenCalled()
    expect(mocks.createAgent).toHaveBeenCalledWith('default-workspace-session', expect.objectContaining({
      scope: 'global',
      projectId: null,
    }))
  })

  it('stores sessions from an existing project under that project', async () => {
    const workspace = path.join(tmpDir, 'workspace')
    const project = path.join(tmpDir, 'project')
    await Promise.all([fs.mkdir(workspace), fs.mkdir(project)])
    process.env.QUICKFORGE_WORKSPACE_DIR = workspace
    mocks.projectConfig = {
      projects: [{ id: 'project-1', name: 'project', path: project }],
      activeProjectId: 'project-1',
    }

    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    await agent.newSession({
      cwd: project,
      mcpServers: [],
      _meta: { quickforgeSessionId: 'project-session' },
    })

    expect(mocks.setActiveProjectPath).not.toHaveBeenCalled()
    expect(mocks.createAgent).toHaveBeenCalledWith('project-session', expect.objectContaining({
      scope: 'project',
      projectId: 'project-1',
    }))
  })

  it('reports the default workspace cwd for persisted global sessions', async () => {
    const workspace = path.join(tmpDir, 'workspace')
    await fs.mkdir(workspace)
    process.env.QUICKFORGE_WORKSPACE_DIR = workspace
    mocks.readStore.mockImplementation(async (store) => {
      if (store === 'sessions-metadata') {
        return {
          global: {
            id: 'global-session',
            scope: 'global',
            title: 'Global session',
            lastModified: '2025-01-01T00:00:00.000Z',
          },
        }
      }
      return {}
    })

    const { createQuickForgeAcpAgent } = await import('../../../server/acp/server.mjs')
    const agent = await createQuickForgeAcpAgent()
    const result = await agent.listSessions({ cwd: workspace })

    expect(result.sessions).toEqual([expect.objectContaining({
      sessionId: 'global-session',
      cwd: path.resolve(workspace),
    })])
  })
})
