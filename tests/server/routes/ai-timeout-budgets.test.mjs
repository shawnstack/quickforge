import { Readable } from 'node:stream'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import {
  AI_AGENT_PROFILE_FILL_TOTAL_TIMEOUT_MS,
  AI_GIT_COMMIT_MESSAGE_TOTAL_TIMEOUT_MS,
  AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS,
  AI_TEST_CONNECTION_TOTAL_TIMEOUT_MS,
  DEFAULT_AI_MAX_RETRIES,
} from '../../../server/ai-provider-options.mjs'

// 这些路由接口的 HTTP 响应需要同步等模型跑完，测试锁定各自的 totalTimeoutMs 场景预算
// （不沿用 20min 默认档），并顺带锁定 maxTokens/maxRetries 等关键参数防回归。

const state = vi.hoisted(() => ({ workspaceRoot: '' }))
const mocks = vi.hoisted(() => ({ streamSimple: vi.fn() }))

vi.mock('../../../server/ai-http-logger.mjs', () => ({ streamSimpleWithAiHttpLogging: mocks.streamSimple }))

vi.mock('../../../server/model-catalog.mjs', () => ({
  listModelCatalog: vi.fn(async () => []),
  resolveModelBinding: vi.fn(async (input) => ({
    model: input?.model && typeof input.model === 'object' ? input.model : input,
    modelRef: { version: 1, source: 'custom' },
  })),
}))

vi.mock('../../../server/storage.mjs', () => ({
  readStore: vi.fn(async () => ({})),
  atomicUpdate: vi.fn(async (_name, updater) => updater({})),
}))

vi.mock('../../../server/project-config.mjs', () => ({
  projectContextFromId: vi.fn(async (projectId) => ({ project: { id: projectId || 'test-project' }, workspaceRoot: state.workspaceRoot })),
  registeredProjectContextFromId: vi.fn(async (projectId) => ({ project: { id: projectId || 'test-project' }, workspaceRoot: state.workspaceRoot })),
  readProjectConfig: vi.fn(async () => ({ activeProjectId: null, globalSkills: [], projects: [] })),
}))

vi.mock('../../../server/agent-profiles.mjs', () => ({
  agentProfileSnapshot: vi.fn((agent) => agent),
  createCustomAgentProfile: vi.fn(),
  deleteCustomAgentProfile: vi.fn(),
  getAgentProfile: vi.fn(),
  listAgentProfiles: vi.fn(async () => []),
  listAvailableAgentTools: vi.fn(() => []),
  updateBuiltinAgentOverrides: vi.fn(),
  updateCustomAgentProfile: vi.fn(),
}))

vi.mock('../../../server/agent-manager.mjs', () => ({
  createAgent: vi.fn(),
  getSessionEventBus: vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), off: vi.fn() })),
  agentEvents: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
  persistSessionState: vi.fn(async () => {}),
  abortRun: vi.fn(),
}))

vi.mock('../../../server/scheduled-runs-cutover.mjs', () => ({
  assertScheduledRunsAvailable: vi.fn(),
  canStartScheduledRun: vi.fn(() => false),
  configureScheduledRunsRuntimeHooks: vi.fn(),
  isScheduledRunsAuthoritative: vi.fn(() => false),
  recordScheduledRunsDiagnostic: vi.fn(),
}))

vi.mock('../../../server/scheduled-task-runs-service.mjs', () => ({
  createScheduledTaskRunsService: vi.fn(() => ({
    syncRun: vi.fn(),
    deleteTaskRuns: vi.fn(),
    listRuns: vi.fn(),
    recentRuns: vi.fn(),
    getDiagnostics: vi.fn(),
  })),
}))

const execFileAsync = promisify(execFile)

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

function testModel() {
  return { id: 'test-model', provider: 'test-provider', baseUrl: 'http://localhost:9', api: 'openai-compliant' }
}

function aiStreamResult(text) {
  return { result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text }] }) }
}

let gitRepoRoot

beforeAll(async () => {
  gitRepoRoot = await mkdtemp(path.join(tmpdir(), 'quickforge-ai-timeout-git-'))
  await execFileAsync('git', ['init'], { cwd: gitRepoRoot })
  await execFileAsync('git', ['config', 'user.name', 'QuickForge Test'], { cwd: gitRepoRoot })
  await execFileAsync('git', ['config', 'user.email', 'quickforge@example.test'], { cwd: gitRepoRoot })
  await writeFile(path.join(gitRepoRoot, 'tracked.txt'), 'one\n')
  await execFileAsync('git', ['add', '-A'], { cwd: gitRepoRoot })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: gitRepoRoot })
  // 二次修改并 stage，保证 generate-commit-message 有 staged 变更可总结
  await writeFile(path.join(gitRepoRoot, 'tracked.txt'), 'two\n')
  await execFileAsync('git', ['add', '-A'], { cwd: gitRepoRoot })
  state.workspaceRoot = gitRepoRoot
})

afterAll(async () => {
  state.workspaceRoot = ''
  await rm(gitRepoRoot, { recursive: true, force: true })
})

beforeEach(() => {
  mocks.streamSimple.mockReset()
  mocks.streamSimple.mockImplementation(() => aiStreamResult('ok'))
})

describe('AI total timeout budgets for synchronous LLM routes', () => {
  it('bounds the model connection probe to the 60s test budget', async () => {
    const { handleModelsApi } = await import('../../../server/routes/models.mjs')
    const res = response()
    await handleModelsApi(
      request('POST', { model: testModel(), apiKey: 'test-key' }),
      res,
      new URL('http://localhost/api/models/test-connection'),
    )

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(mocks.streamSimple.mock.calls[0][2]).toMatchObject({
      totalTimeoutMs: AI_TEST_CONNECTION_TOTAL_TIMEOUT_MS,
      apiKey: 'test-key',
      maxTokens: 16,
      maxRetries: 0,
      maxRetryDelayMs: 30000,
    })
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })

  it('bounds agent profile AI fill to the 3min budget', async () => {
    const profileJson = JSON.stringify({
      name: 'code_reviewer',
      label: 'Code Reviewer',
      description: 'Reviews code changes',
      systemPrompt: 'You review code changes.',
    })
    mocks.streamSimple.mockImplementation(() => aiStreamResult(profileJson))
    const { handleAgentProfilesApi } = await import('../../../server/routes/agent-profiles.mjs')
    const res = response()
    await handleAgentProfilesApi(
      request('POST', { instruction: '创建一个代码审查 agent', model: testModel(), thinkingLevel: 'off' }),
      res,
      new URL('http://localhost/api/agent-profiles/ai-fill'),
    )

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(mocks.streamSimple.mock.calls[0][2]).toMatchObject({
      totalTimeoutMs: AI_AGENT_PROFILE_FILL_TOTAL_TIMEOUT_MS,
      maxTokens: 1600,
      temperature: 0,
      maxRetries: DEFAULT_AI_MAX_RETRIES,
      maxRetryDelayMs: 60000,
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).agent).toMatchObject({ name: 'code_reviewer' })
  })

  it('bounds scheduled task AI parsing to the 2min budget', async () => {
    const taskJson = JSON.stringify({
      title: '生成日报',
      instruction: '生成销售日报',
      cronExpression: '0 9 * * *',
      scheduleRule: '每天 09:00',
      question: '',
    })
    mocks.streamSimple.mockImplementation(() => aiStreamResult(taskJson))
    const { handleScheduledTasksApi } = await import('../../../server/routes/scheduled-tasks.mjs')
    const res = response()
    await handleScheduledTasksApi(
      request('POST', { instruction: '每天早上九点生成销售日报', model: testModel() }),
      res,
      new URL('http://localhost/api/scheduled-tasks/parse'),
    )

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(mocks.streamSimple.mock.calls[0][2]).toMatchObject({
      totalTimeoutMs: AI_SCHEDULED_TASK_PARSE_TOTAL_TIMEOUT_MS,
      maxTokens: 600,
      temperature: 0,
      maxRetries: DEFAULT_AI_MAX_RETRIES,
      maxRetryDelayMs: 60000,
    })
    const body = JSON.parse(res.body)
    expect(body.needMoreInfo).toBe(false)
    expect(body.task).toMatchObject({ scheduleType: 'cron', cronExpression: '0 9 * * *' })
  })

  it('bounds AI commit message generation to the 2min budget', async () => {
    mocks.streamSimple.mockImplementation(() => aiStreamResult('feat: add timeout budgets'))
    const { handleGitApi } = await import('../../../server/routes/workspace.mjs')
    const res = response()
    await handleGitApi(
      request('POST', { projectId: 'test-project', model: testModel() }),
      res,
      new URL('http://localhost/api/git/generate-commit-message'),
    )

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(mocks.streamSimple.mock.calls[0][2]).toMatchObject({
      totalTimeoutMs: AI_GIT_COMMIT_MESSAGE_TOTAL_TIMEOUT_MS,
      maxTokens: 500,
      temperature: 0,
      maxRetries: DEFAULT_AI_MAX_RETRIES,
      maxRetryDelayMs: 60000,
    })
    expect(JSON.parse(res.body)).toEqual({ message: 'feat: add timeout budgets' })
  })
})
