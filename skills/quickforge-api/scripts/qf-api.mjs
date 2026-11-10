#!/usr/bin/env node
// QuickForge 本地 API 的最小客户端，随内置 skill `quickforge-api` 分发。
//
// 设计约束（改这个文件前先读）：
// 1. 零依赖：只用 node: 内置模块。skill 会随包分发到用户机器，不能依赖仓库里的
//    server/ 代码，也不能假设装了什么包。
// 2. 不接受任意 method/path：每个子命令映射到一个写死的端点。本机回环即认证
//    （server/access-policy.mjs），一旦放开通用请求就等于把全套 API 交给了模型，
//    包括删除会话、读别的对话。
//    例外只有一处，且是白名单：`spawn --access-mode` 在建**新会话**时带权限模式
//    （default / full-access），由用户显式授权。已存在会话的 access-mode 仍然不可改。
//    定时任务同理：只有创建/暂停/恢复/立即执行（可逆），删除和改写已有任务没有
//    子命令，taskId 只出现在写死的端点尾部，不能拼出别的路径。
// 3. 输出默认是紧凑 JSON：给模型看的，少一层自然语言解释就少一次误读。
//
// 用法：node qf-api.mjs <command> [options]

import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const DEFAULT_CANDIDATE_PORTS = [5176, 32176]
const DEFAULT_REQUEST_TIMEOUT_MS = 20000
const DEFAULT_WAIT_TIMEOUT_SECONDS = 120
const DEFAULT_WAIT_INTERVAL_SECONDS = 2

const ALLOWED_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh']
// 新建会话的权限模式由用户显式授权：只有这两个值，且只作用于 spawn 创建的新会话。
// 已存在会话的 access-mode 仍然不可改（那是破坏性操作，见文件头约束 2）。
const ALLOWED_ACCESS_MODES = ['default', 'full-access']
const DEFAULT_SPAWN_ACCESS_MODE = 'full-access'

const HELP = `QuickForge local API client (built-in skill: quickforge-api)

Read-only:
  whoami                        Where the API is and who am I
  context [--sessionId ID]      My context budget: used/window/remaining tokens
  agents                        List live (in-memory) sessions
  sessions [--limit N]          List stored sessions, newest first
  show <sessionId> [--tail N]   Read-only session view (does not wake it)
  messages <sessionId> [--from N] [--limit N]
  instructions [--projectId ID] [--system-prompt]
  skills [--projectId ID]       Skills this session can activate

Self control (own session by default):
  title <text> [--sessionId ID]
  model <modelRef> [--sessionId ID]
  thinking <off|low|medium|high|xhigh> [--sessionId ID]
  goal <action> [--objective TEXT]   action: confirm/pause/resume/cancel/revise/accept
  wait [--sessionId ID] [--timeout S] [--interval S]

Other sessions:
  spawn --title T [--message M] [--project ID] [--model REF] [--thinking LEVEL]
        [--access-mode default|full-access]
        thinking defaults to my current level; access-mode defaults to
        full-access (sub session runs without per-tool approvals)
  prompt <sessionId> <message...>
  abort <sessionId>

Scheduled tasks (create, reversible actions, plus deleting your own shift):
  tasks [--status enabled|paused]
  task-add --title T --instruction I --schedule <type> ...
        daily:    --time 09:00
        weekly:   --time 09:00 --days 1,3,5      (0 = Sunday)
        monthly:  --time 09:00 --day 15
        interval: --every 30 --unit minute|hour|day --at "<first run datetime>"
        once:     --at "<datetime>"
        cron:     --cron "0 9 * * *"             (5 fields, no seconds)
        extras:   [--model ID] [--thinking LEVEL] [--project ID|none] [--paused]
                  [--self-scheduled]  mark this as MY shift: title gets the
                  "[自约]" prefix and I am allowed to delete it later
                  model defaults to the model I am using right now
  task-pause <taskId> | task-resume <taskId>
  task-run <taskId> [--timeout S]   fire once now; waits for that run (default 300s)
  task-runs [--taskId ID] [--status S] [--page N] [--pageSize N]
  task-parse --instruction "..."    natural language -> cron draft (does not create)
  task-delete <taskId>              ONLY tasks created with --self-scheduled
  Editing an existing task is NOT exposed; do that in the UI.

Global options:
  --api <baseUrl>   override detected API base (default: $QUICKFORGE_API_BASE or probe)
  --pretty          pretty-print JSON
  --help            this text

Identity comes from QUICKFORGE_SESSION_ID / QUICKFORGE_PROJECT_ID, which the
run_command tool injects for every child process. Run "whoami" first.`

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '')
}

function parseArgs(argv) {
  const options = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = next
      index += 1
    }
  }
  return { options, positional }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function readPidFromFile() {
  const dataDir = resolveDataDir()
  try {
    const raw = await readFile(path.join(dataDir, 'quickforge.pid'), 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function resolveDataDir() {
  return process.env.QUICKFORGE_DATA_DIR
    ? path.resolve(process.env.QUICKFORGE_DATA_DIR)
    : path.join(os.homedir(), '.quickforge')
}

function sameDirectory(left, right) {
  if (!left || !right) return false
  try { return path.resolve(left) === path.resolve(right) } catch { return false }
}

async function request(baseUrl, method, apiPath, body, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) {
    const errorCode = parsed?.errorCode ? ` (${parsed.errorCode})` : ''
    const message = parsed?.error || parsed?.message || response.statusText
    const error = new Error(`${method} ${apiPath} -> ${response.status}${errorCode}: ${message}`)
    error.status = response.status
    error.errorCode = parsed?.errorCode
    throw error
  }
  return parsed
}

async function resolveBaseUrl(options) {
  const explicit = options.api || process.env.QUICKFORGE_API_BASE
  if (explicit && explicit !== true) return { baseUrl: stripTrailingSlash(explicit), warnings: [] }

  const envPort = Number.parseInt(process.env.QUICKFORGE_PORT || '', 10)
  const candidates = Number.isInteger(envPort) && envPort > 0
    ? [envPort, ...DEFAULT_CANDIDATE_PORTS.filter((port) => port !== envPort)]
    : DEFAULT_CANDIDATE_PORTS
  const expectedPid = await readPidFromFile()
  const expectedDataDir = resolveDataDir()

  const found = []
  for (const port of candidates) {
    const baseUrl = `http://127.0.0.1:${port}`
    try {
      const health = await request(baseUrl, 'GET', '/api/health')
      if (health?.ok === true) found.push({ baseUrl, health })
    } catch {
      // 端口没起服务 / health 不 ok，试下一个。
    }
  }

  if (found.length === 0) {
    const tried = candidates.map((port) => `127.0.0.1:${port}`).join(', ')
    throw new Error(
      `Cannot find a running QuickForge local API (tried ${tried}). `
      + 'If it listens on a custom host/port, pass --api http://127.0.0.1:<port>.',
    )
  }

  // 一台机器可能同时跑多个实例（dev + 正式 + 自定义端口），按可信度挑：
  // pid 文件 → 同一个数据目录 → 唯一可用实例。pid 文件可能是陈旧的
  // （服务由 app 内部重启时不会更新它），所以它只是优先，不是门槛。
  const byPid = expectedPid ? found.find((item) => Number(item.health.pid) === expectedPid) : null
  if (byPid) return { baseUrl: byPid.baseUrl, warnings: [] }

  const byDataDir = found.find((item) => sameDirectory(item.health.dataDir, expectedDataDir))
  if (byDataDir) {
    const warnings = expectedPid && Number(byDataDir.health.pid) !== expectedPid
      ? [`pid file says ${expectedPid} but the API reports ${byDataDir.health.pid} (stale pid file, or a second instance) — pass --api if unsure`]
      : []
    return { baseUrl: byDataDir.baseUrl, warnings }
  }

  const warnings = []
  if (found.length > 1) warnings.push(`multiple QuickForge instances responded (${found.map((item) => item.baseUrl).join(', ')}); picked ${found[0].baseUrl}`)
  if (expectedPid) warnings.push(`pid file says ${expectedPid} but the API reports ${found[0].health.pid}; passing --api explicitly is safer`)
  return { baseUrl: found[0].baseUrl, warnings }
}

function requireSelfSessionId(options) {
  const sessionId = options.sessionId || process.env.QUICKFORGE_SESSION_ID
  if (!sessionId || sessionId === true) {
    throw new Error('No session id: pass --sessionId, or run inside a QuickForge agent (QUICKFORGE_SESSION_ID).')
  }
  return sessionId
}

function createClient(baseUrl) {
  return {
    get: (apiPath, timeoutMs) => request(baseUrl, 'GET', apiPath, undefined, timeoutMs),
    post: (apiPath, body, timeoutMs) => request(baseUrl, 'POST', apiPath, body ?? {}, timeoutMs),
    delete: (apiPath, timeoutMs) => request(baseUrl, 'DELETE', apiPath, undefined, timeoutMs),
  }
}

function summarizeSession(session) {
  return {
    sessionId: session.sessionId,
    title: session.title ?? null,
    status: session.status ?? null,
    isStreaming: session.isStreaming ?? null,
    scope: session.scope ?? null,
    projectId: session.projectId ?? null,
    messageCount: session.messageCount ?? null,
    lastModified: session.lastModified ?? null,
  }
}

// --- commands -----------------------------------------------------------

async function commandWhoami(client, baseUrl, options) {
  const health = await client.get('/api/health')
  const sessionId = options.sessionId || process.env.QUICKFORGE_SESSION_ID || null
  let session = null
  let sessionError = null
  if (sessionId && sessionId !== true) {
    try {
      session = summarizeSession(await client.get(`/api/agents/${encodeURIComponent(sessionId)}/status`))
    } catch (error) {
      sessionError = error.status === 404 ? 'session not in memory (idle or evicted)' : error.message
    }
  }
  return {
    api: baseUrl,
    mode: health.mode,
    version: health.version,
    pid: health.pid,
    dataDir: health.dataDir,
    workspaceRoot: health.workspaceRoot,
    project: health.project ? { id: health.project.id ?? null, name: health.project.name ?? null } : null,
    env: {
      sessionId: process.env.QUICKFORGE_SESSION_ID || null,
      projectId: process.env.QUICKFORGE_PROJECT_ID || null,
    },
    session,
    sessionError,
    ...(Array.isArray(options.warnings) && options.warnings.length ? { warnings: options.warnings } : {}),
  }
}

async function commandContext(client, options) {
  const sessionId = optionString(options, 'sessionId') || process.env.QUICKFORGE_SESSION_ID || null
  if (!sessionId) {
    throw new Error('context needs a session id: no QUICKFORGE_SESSION_ID in this process, pass --sessionId ID')
  }
  const budget = await client.get(`/api/agents/${encodeURIComponent(sessionId)}/context-usage`)
  const usage = budget?.usage ?? null
  const contextWindow = Number(usage?.contextWindow) || 0
  const inputTokens = Number(usage?.inputTokens) || 0
  return {
    sessionId: budget?.sessionId ?? sessionId,
    modelId: budget?.modelId ?? null,
    contextWindow,
    inputTokens,
    // percent 是「已用百分比」。剩余量单独给，避免模型自己算错方向。
    percent: contextWindow > 0 ? Math.round((inputTokens / contextWindow) * 1000) / 10 : null,
    remainingTokens: contextWindow > 0 ? Math.max(0, contextWindow - inputTokens) : null,
    // provider = 供应商上报的真实用量；estimated = 本地估算；unavailable = 还没有真实用量
    inputTokenSource: usage?.inputTokenSource ?? null,
    isCompacted: Boolean(usage?.isCompacted),
    messageCount: budget?.messageCount ?? 0,
    breakdown: usage?.breakdown ?? null,
  }
}

async function commandAgents(client) {
  const payload = await client.get('/api/agents')
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : []
  // /api/agents 的列表项比 /status 窄（见 agent-manager.listSessions）：没有
  // messageCount / lastModified / isStreaming，不要用 status 的形状去读它。
  return {
    count: sessions.length,
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      title: session.title ?? null,
      status: session.status ?? null,
      scope: session.scope ?? null,
      source: session.source ?? null,
    })),
  }
}

async function commandSessions(client, options) {
  const limit = positiveInt(options.limit, 20)
  const offset = positiveInt(options.offset, 0)
  const query = `direction=desc&limit=${limit}&offset=${offset}`
  const payload = await client.get(`/api/storage/sessions-metadata/index/lastModified?${query}`)
  const values = Array.isArray(payload.values) ? payload.values : []
  return {
    total: payload.total ?? values.length,
    limit,
    offset,
    sessions: values.map((value) => ({
      sessionId: value.sessionId ?? value.id ?? null,
      title: value.title ?? null,
      lastModified: value.lastModified ?? null,
      projectId: value.projectId ?? null,
      archived: value.archived ?? null,
    })),
  }
}

async function commandShow(client, positional, options) {
  const sessionId = positional[0]
  if (!sessionId) throw new Error('show needs a sessionId')
  const tail = positiveInt(options.tail, 8)
  const view = await client.get(`/api/sessions/${encodeURIComponent(sessionId)}/view?tail=${tail}`)
  const messages = Array.isArray(view.messages) ? view.messages : []
  return {
    sessionId: view.sessionId,
    title: view.title ?? null,
    status: view.status ?? null,
    modelRef: view.modelRef ?? null,
    thinkingLevel: view.thinkingLevel ?? null,
    accessMode: view.accessMode ?? null,
    projectId: view.projectId ?? null,
    messagesAfter: view.messagesAfter ?? 0,
    totalMessages: view.messagesSummary?.count ?? messages.length,
    goal: view.goal ?? null,
    // 只回消息的可读骨架，别把整段工具输出灌进来。
    messages: messages.map((message) => ({
      role: message.role ?? null,
      at: message.timestamp ?? null,
      chars: typeof message.content === 'string' ? message.content.length : null,
      preview: typeof message.content === 'string' ? message.content.slice(0, 200) : null,
    })),
  }
}

async function commandMessages(client, positional, options) {
  const sessionId = positional[0]
  if (!sessionId) throw new Error('messages needs a sessionId')
  const from = positiveInt(options.from, 0)
  const limit = positiveInt(options.limit, 20)
  const payload = await client.get(`/api/agents/${encodeURIComponent(sessionId)}/messages?from=${from}&limit=${limit}`)
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  return {
    sessionId,
    from: payload.from ?? from,
    total: payload.total ?? messages.length,
    logVersion: payload.logVersion ?? null,
    messages: messages.map((message) => ({
      role: message.role ?? null,
      at: message.timestamp ?? null,
      preview: typeof message.content === 'string' ? message.content.slice(0, 400) : null,
    })),
  }
}

async function commandInstructions(client, options) {
  const projectId = options.projectId || process.env.QUICKFORGE_PROJECT_ID
  const query = projectId && projectId !== true ? `?projectId=${encodeURIComponent(projectId)}` : ''
  const payload = await client.get(`/api/instructions${query}`)
  const skills = Array.isArray(payload.skills) ? payload.skills : []
  const systemPrompt = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : ''
  const result = {
    // payload 里不一定回带 projectId，回显请求用的那个，避免读成「没项目」。
    projectId: projectId && projectId !== true ? projectId : null,
    systemPromptChars: systemPrompt.length,
    skills: skills.map((skill) => ({ name: skill.name, source: skill.source ?? null })),
  }
  if (options['system-prompt'] === true) result.systemPrompt = systemPrompt
  return result
}

async function commandSkills(client, options) {
  const projectId = options.projectId || process.env.QUICKFORGE_PROJECT_ID
  const query = projectId && projectId !== true ? `?available=true&projectId=${encodeURIComponent(projectId)}` : '?available=true'
  const payload = await client.get(`/api/skills${query}`)
  const skills = Array.isArray(payload.skills) ? payload.skills : []
  return { count: skills.length, skills: skills.map((skill) => ({ name: skill.name, source: skill.source ?? null, description: skill.description ?? null })) }
}

async function commandTitle(client, positional, options) {
  const title = positional.join(' ').trim()
  if (!title) throw new Error('title needs text')
  const sessionId = requireSelfSessionId(options)
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/title`, { title })
}

async function commandModel(client, positional, options) {
  const modelRef = positional[0]
  if (!modelRef) throw new Error('model needs a modelRef')
  const sessionId = requireSelfSessionId(options)
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/model`, { modelRef })
}

async function commandThinking(client, positional, options) {
  const thinkingLevel = positional[0]
  if (!ALLOWED_THINKING_LEVELS.includes(thinkingLevel)) throw new Error(`thinking needs one of: ${ALLOWED_THINKING_LEVELS.join(', ')}`)
  const sessionId = requireSelfSessionId(options)
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/thinking-level`, { thinkingLevel })
}

async function commandGoal(client, positional, options) {
  const action = positional[0]
  const allowed = ['confirm', 'pause', 'resume', 'cancel', 'revise', 'accept']
  if (!allowed.includes(action)) throw new Error(`goal needs one of: ${allowed.join(', ')}`)
  const sessionId = requireSelfSessionId(options)
  const body = { action }
  if (options.objective && options.objective !== true) body.objective = options.objective
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/goal`, body)
}

async function commandWait(client, options) {
  const sessionId = requireSelfSessionId(options)
  const timeoutSeconds = positiveInt(options.timeout, DEFAULT_WAIT_TIMEOUT_SECONDS)
  const intervalSeconds = positiveInt(options.interval, DEFAULT_WAIT_INTERVAL_SECONDS)
  const deadline = Date.now() + timeoutSeconds * 1000
  let last = null
  while (Date.now() < deadline) {
    last = summarizeSession(await client.get(`/api/agents/${encodeURIComponent(sessionId)}/status`))
    // 轮询 status 而不是订阅 SSE：SSE 每个会话只允许一个连接（第二个 409），
    // 而用户可能就开着那个会话。
    if (last.isStreaming !== true && last.status !== 'running') return { ...last, timedOut: false }
    await sleep(intervalSeconds * 1000)
  }
  return { ...last, timedOut: true, waitedSeconds: timeoutSeconds }
}

/**
 * 我自己当前的思考档。spawn 出来的会话默认与它一致，避免出现
 * 「我这边 xhigh 在干活、子会话悄悄用 off」这种不一致。
 * 读不到就返回 null（调用方退回到 off），绝不为了这个失败。
 */
async function resolveSelfThinkingLevel(client) {
  const sessionId = process.env.QUICKFORGE_SESSION_ID
  if (!sessionId) return null
  try {
    const state = await client.get(`/api/agents/${encodeURIComponent(sessionId)}/state`)
    const level = state?.thinkingLevel
    return ALLOWED_THINKING_LEVELS.includes(level) ? level : null
  } catch {
    return null
  }
}

async function commandSpawn(client, options) {
  const sessionId = randomUUID()
  const projectId = options.project && options.project !== true
    ? options.project
    : (process.env.QUICKFORGE_PROJECT_ID || null)

  const accessMode = typeof options['access-mode'] === 'string' ? options['access-mode'] : DEFAULT_SPAWN_ACCESS_MODE
  if (!ALLOWED_ACCESS_MODES.includes(accessMode)) {
    throw new Error(`--access-mode needs one of: ${ALLOWED_ACCESS_MODES.join(', ')}`)
  }

  const explicitThinking = typeof options.thinking === 'string' ? options.thinking : null
  if (explicitThinking && !ALLOWED_THINKING_LEVELS.includes(explicitThinking)) {
    throw new Error(`--thinking needs one of: ${ALLOWED_THINKING_LEVELS.join(', ')}`)
  }
  const inheritedThinking = explicitThinking ? null : await resolveSelfThinkingLevel(client)
  const thinkingLevel = explicitThinking || inheritedThinking || 'off'

  const createBody = {
    title: typeof options.title === 'string' ? options.title : 'Sub session',
    thinkingLevel,
    accessMode,
  }
  if (projectId) {
    createBody.scope = 'project'
    createBody.projectId = projectId
  }
  if (typeof options.model === 'string') createBody.modelRef = options.model
  const created = await client.post(`/api/agents/${encodeURIComponent(sessionId)}`, createBody)
  const message = typeof options.message === 'string' ? options.message : ''
  if (message) await client.post(`/api/agents/${encodeURIComponent(sessionId)}/prompt`, { message })
  return {
    sessionId: created.sessionId ?? sessionId,
    title: created.title ?? createBody.title,
    projectId: projectId ?? null,
    prompted: Boolean(message),
    accessMode: created.accessMode ?? accessMode,
    thinkingLevel: created.thinkingLevel ?? thinkingLevel,
    thinkingSource: explicitThinking ? 'flag' : (inheritedThinking ? 'inherited' : 'fallback'),
    hint: 'Use "wait <sessionId>" to block until it finishes, or "show <sessionId>" for a read-only peek.',
  }
}

async function commandPrompt(client, positional) {
  const [sessionId, ...rest] = positional
  const message = rest.join(' ').trim()
  if (!sessionId || !message) throw new Error('prompt needs <sessionId> <message...>')
  if (sessionId === process.env.QUICKFORGE_SESSION_ID) {
    throw new Error('Refusing to prompt myself: the running agent would hit 409 GENERATION_ALREADY_RUNNING. Use "spawn" for a sub session.')
  }
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/prompt`, { message })
}

async function commandAbort(client, positional) {
  const sessionId = positional[0]
  if (!sessionId) throw new Error('abort needs a sessionId')
  return client.post(`/api/agents/${encodeURIComponent(sessionId)}/abort`, {})
}

// --- scheduled tasks ----------------------------------------------------
//
// 端点都在 /api/scheduled-tasks 下。这里只放开「可逆」的动作：创建、暂停、恢复、
// 立即执行一次、读列表和运行历史。删除任务（DELETE）和改写已有任务（PUT）
// 故意没有子命令——覆盖用户排好的日程属于破坏性操作，要改就自己开界面。
//
// 两个真实约束（改之前先读）：
// 1. 创建任务必须带 modelRef，否则服务端 400 invalid_model_reference。不传
//    --model 时用我自己正在用的模型，这样任务跑起来和我同一个模型。
// 2. `task-run` 是同步的：服务端等这次运行结束才回包，可能几分钟。所以它用
//    自己的超时（--timeout 秒），超时只断我这边的 HTTP 连接，服务端照跑。

const SCHEDULE_TYPES = ['once', 'interval', 'daily', 'weekly', 'monthly', 'cron']
const INTERVAL_UNITS = ['minute', 'hour', 'day']
const DEFAULT_TASK_RUN_TIMEOUT_SECONDS = 300

// 自约任务的标题前缀，有三个用途：脚本用它保证前缀一定存在；未来的班次用 `tasks`
// 靠它在列表里认出「哪条是我自己的班」——这是唯一的自我识别方式，因为任务 id 在
// 创建前不存在，没法提前写进 instruction；用户靠它过滤掉这些会话。
const SELF_SCHEDULED_TITLE_PREFIX = '[自约]'

function optionString(options, name) {
  const value = options[name]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function requiredOption(options, name, hint) {
  const value = optionString(options, name)
  if (!value) throw new Error(`missing ${hint || `--${name}`}`)
  return value
}

async function readModelCatalog(client) {
  const payload = await client.get('/api/models/catalog')
  if (Array.isArray(payload)) return payload
  return Array.isArray(payload?.models) ? payload.models : []
}

function modelRefFromCatalogEntry(entry) {
  if (entry?.quickforgeModelRef) return entry.quickforgeModelRef
  // 和前端 modelReferenceFromModel 的兜底形状一致：没有现成引用时按快照拼一个。
  return {
    version: 1,
    source: 'legacy-custom',
    provider: entry?.provider,
    modelId: entry?.id,
    api: entry?.api,
    baseUrl: entry?.baseUrl,
  }
}

async function resolveTaskModelBinding(client, hint) {
  if (hint) {
    const catalog = await readModelCatalog(client)
    const match = catalog.find((entry) => entry?.id === hint
      || entry?.name === hint
      || entry?.quickforgeModelRef?.modelId === hint)
    if (!match) {
      throw new Error(`--model "${hint}" is not in /api/models/catalog (pass the model id, e.g. deepseek-v4-flash)`)
    }
    return { modelRef: modelRefFromCatalogEntry(match), source: 'flag' }
  }

  const sessionId = process.env.QUICKFORGE_SESSION_ID
  if (sessionId) {
    try {
      const state = await client.get(`/api/agents/${encodeURIComponent(sessionId)}/state`)
      if (state?.modelRef) {
        return {
          modelRef: state.modelRef,
          thinkingLevel: ALLOWED_THINKING_LEVELS.includes(state.thinkingLevel) ? state.thinkingLevel : null,
          source: 'self',
        }
      }
    } catch {
      // 会话被驱逐或还没建好都无所谓，退回目录里的第一个模型。
    }
  }

  const catalog = await readModelCatalog(client)
  const first = catalog.find((entry) => entry?.quickforgeModelRef || entry?.id)
  if (!first) throw new Error('No model configured in QuickForge; add one in Settings → Models first.')
  return { modelRef: modelRefFromCatalogEntry(first), source: 'catalog' }
}

function resolveTaskProject(options) {
  const raw = options.project
  if (raw === 'none' || raw === 'global') return null
  if (typeof raw === 'string' && raw) return { projectId: raw, projectName: optionString(options, 'project-name') || null }
  const envProjectId = process.env.QUICKFORGE_PROJECT_ID
  return envProjectId ? { projectId: envProjectId, projectName: null } : null
}

function buildScheduleInput(options) {
  const scheduleType = requiredOption(options, 'schedule', '--schedule <once|interval|daily|weekly|monthly|cron>')
  if (!SCHEDULE_TYPES.includes(scheduleType)) {
    throw new Error(`--schedule needs one of: ${SCHEDULE_TYPES.join(', ')}`)
  }

  if (scheduleType === 'cron') {
    return { scheduleType, cronExpression: requiredOption(options, 'cron', '--cron "0 9 * * *" (5 fields, no seconds)') }
  }
  if (scheduleType === 'once') {
    return { scheduleType, executeAt: requiredOption(options, 'at', '--at "<local datetime, e.g. 2026-11-11T09:00:00+08:00>"') }
  }
  if (scheduleType === 'interval') {
    const intervalValue = positiveInt(options.every, null)
    if (!intervalValue) throw new Error('--every needs a positive integer, e.g. --every 30 --unit minute')
    const intervalUnit = optionString(options, 'unit') || 'minute'
    if (!INTERVAL_UNITS.includes(intervalUnit)) throw new Error(`--unit needs one of: ${INTERVAL_UNITS.join(', ')}`)
    return {
      scheduleType,
      intervalValue,
      intervalUnit,
      // 首次执行时间是锚点，必须晚于现在；之后按 interval 递推。
      executeAt: requiredOption(options, 'at', '--at "<first run datetime, must be in the future>"'),
    }
  }

  const executeTime = requiredOption(options, 'time', '--time HH:MM (local)')
  if (scheduleType === 'daily') return { scheduleType, executeTime }

  if (scheduleType === 'weekly') {
    const raw = requiredOption(options, 'days', '--days 1,3,5 (0 = Sunday)')
    const weekDays = raw.split(',').map((part) => Number.parseInt(part.trim(), 10))
    if (weekDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('--days takes comma-separated numbers 0-6 (0 = Sunday)')
    }
    return { scheduleType, executeTime, weekDays: [...new Set(weekDays)] }
  }

  const monthDay = Number.parseInt(optionString(options, 'day'), 10)
  if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
    throw new Error('--day needs a number 1-31 for --schedule monthly')
  }
  return { scheduleType, executeTime, monthDay }
}

function summarizeTask(task) {
  if (!task || typeof task !== 'object') return null
  return {
    id: task.id ?? null,
    title: task.title ?? null,
    status: task.status ?? null,
    scheduleType: task.scheduleType ?? null,
    scheduleRule: task.scheduleRule ?? null,
    nextRunAt: task.nextRunAt ?? null,
    lastRunAt: task.lastRunAt ?? null,
    executionMode: task.executionMode ?? null,
    createdBy: task.createdBy ?? 'user',
    projectId: task.projectId ?? null,
    modelId: task.modelRef?.modelId ?? task.model?.id ?? null,
    thinkingLevel: task.thinkingLevel ?? null,
  }
}

function summarizeRun(run) {
  return {
    id: run?.id ?? null,
    taskId: run?.taskId ?? null,
    status: run?.status ?? null,
    trigger: run?.trigger ?? null,
    startedAt: run?.startedAt ?? null,
    finishedAt: run?.finishedAt ?? null,
    sessionId: run?.sessionId ?? null,
    error: run?.error ? String(run.error).slice(0, 300) : null,
  }
}

async function commandTasks(client, options) {
  const payload = await client.get('/api/scheduled-tasks')
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  const summarized = tasks.map(summarizeTask)
  const status = optionString(options, 'status')
  return {
    count: summarized.length,
    tasks: status ? summarized.filter((task) => task.status === status) : summarized,
  }
}

async function commandTaskAdd(client, options) {
  const rawTitle = requiredOption(options, 'title', '--title "任务名"')
  const selfScheduled = options['self-scheduled'] === true
  const title = selfScheduled && !rawTitle.startsWith(SELF_SCHEDULED_TITLE_PREFIX)
    ? `${SELF_SCHEDULED_TITLE_PREFIX} ${rawTitle}`
    : rawTitle
  const instruction = requiredOption(options, 'instruction', '--instruction "到点后真正要做什么"')
  const binding = await resolveTaskModelBinding(client, optionString(options, 'model'))
  const project = resolveTaskProject(options)
  const thinkingLevel = optionString(options, 'thinking')
    || binding.thinkingLevel
    || 'off'

  const body = {
    // cron 由服务端按表达式算 nextRunAt；其余类型按 scheduleType 各自推导。
    task: {
      title,
      instruction,
      ...buildScheduleInput(options),
      enabled: options.paused !== true,
      executionMode: optionString(options, 'execution-mode') === 'parallel' ? 'parallel' : 'serial',
    },
    modelRef: binding.modelRef,
    thinkingLevel,
  }
  // 只有显式 `--self-scheduled` 才算「我给自己排的班」：服务端据此记 createdBy='agent'
  // 并允许我删掉它。不传这个 flag 就是用户的日程，我永远删不掉。
  if (selfScheduled) body.createdBy = 'agent'
  if (project) {
    body.projectId = project.projectId
    if (project.projectName) body.projectName = project.projectName
  }

  const created = await client.post('/api/scheduled-tasks', body)
  return {
    ...summarizeTask(created.task),
    modelSource: binding.source,
  }
}

async function commandTaskDelete(client, positional) {
  const taskId = positional[0]
  if (!taskId) throw new Error('task-delete needs a taskId (see "tasks", find the one with createdBy "agent")')
  // selfScheduledOnly=1 让服务端替我们守边界：只放行自己 `--self-scheduled` 建的班，
  // 用户建的、以及加 createdBy 之前的存量任务一律 403。界面删除不带这个参数，行为不变。
  await client.delete(`/api/scheduled-tasks/${encodeURIComponent(taskId)}?selfScheduledOnly=1`)
  return { ok: true, taskId }
}

async function commandTaskAction(client, positional, options, action) {
  const taskId = positional[0]
  if (!taskId) throw new Error(`task-${action} needs a taskId (see "tasks")`)

  if (action === 'run') {
    const timeoutSeconds = positiveInt(options.timeout, DEFAULT_TASK_RUN_TIMEOUT_SECONDS)
    try {
      const result = await client.post(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/run`, {}, timeoutSeconds * 1000)
      return { ok: true, task: summarizeTask(result.task) }
    } catch (error) {
      if (error?.name === 'TimeoutError' || /aborted|timeout/i.test(error?.message || '')) {
        throw new Error(
          `task-run gave up waiting after ${timeoutSeconds}s. The run itself may still be going on the server `
          + '— check "task-runs", and pass --timeout to wait longer next time.',
        )
      }
      throw error
    }
  }

  const result = await client.post(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, {})
  return { ok: true, task: summarizeTask(result.task) }
}

async function commandTaskRuns(client, options) {
  const params = new URLSearchParams()
  params.set('page', String(positiveInt(options.page, 1)))
  params.set('pageSize', String(positiveInt(options.pageSize ?? options['page-size'], 20)))
  for (const key of ['taskId', 'status', 'trigger']) {
    const value = optionString(options, key)
    if (value) params.set(key, value)
  }
  const payload = await client.get(`/api/scheduled-tasks/runs?${params.toString()}`)
  const runs = Array.isArray(payload.runs) ? payload.runs : []
  return {
    total: payload.total ?? runs.length,
    page: payload.page ?? null,
    pageSize: payload.pageSize ?? null,
    runs: runs.map(summarizeRun),
  }
}

async function commandTaskParse(client, options) {
  const instruction = requiredOption(options, 'instruction', '--instruction "每天九点把昨天的错误日志汇总一下"')
  const binding = await resolveTaskModelBinding(client, optionString(options, 'model'))
  const body = { instruction, modelRef: binding.modelRef }
  const thinkingLevel = optionString(options, 'thinking') || binding.thinkingLevel
  if (thinkingLevel) body.thinkingLevel = thinkingLevel
  const payload = await client.post('/api/scheduled-tasks/parse', body, 120000)
  // 解析器只回 cron 形状的草稿；用户确认后再用 task-add --cron 落库。
  return {
    needMoreInfo: payload.needMoreInfo === true,
    question: payload.question ?? null,
    task: payload.task ? summarizeTask(payload.task) : null,
    next: payload.task ? `task-add --title "${payload.task.title ?? ''}" --instruction "..." --schedule cron --cron "${payload.task.cronExpression ?? ''}"` : null,
  }
}

// --- main ---------------------------------------------------------------

async function main() {
  const { options, positional } = parseArgs(process.argv.slice(2))
  const command = positional.shift()

  if (!command || options.help === true || command === 'help') {
    process.stdout.write(`${HELP}\n`)
    return
  }

  const { baseUrl, warnings } = await resolveBaseUrl(options)
  options.warnings = warnings
  const client = createClient(baseUrl)

  let result
  switch (command) {
    case 'whoami': result = await commandWhoami(client, baseUrl, options); break
    case 'context': result = await commandContext(client, options); break
    case 'agents': result = await commandAgents(client); break
    case 'sessions': result = await commandSessions(client, options); break
    case 'show': result = await commandShow(client, positional, options); break
    case 'messages': result = await commandMessages(client, positional, options); break
    case 'instructions': result = await commandInstructions(client, options); break
    case 'skills': result = await commandSkills(client, options); break
    case 'title': result = await commandTitle(client, positional, options); break
    case 'model': result = await commandModel(client, positional, options); break
    case 'thinking': result = await commandThinking(client, positional, options); break
    case 'goal': result = await commandGoal(client, positional, options); break
    case 'wait': result = await commandWait(client, options); break
    case 'spawn': result = await commandSpawn(client, options); break
    case 'prompt': result = await commandPrompt(client, positional); break
    case 'abort': result = await commandAbort(client, positional); break
    case 'tasks': result = await commandTasks(client, options); break
    case 'task-add': result = await commandTaskAdd(client, options); break
    case 'task-pause': result = await commandTaskAction(client, positional, options, 'pause'); break
    case 'task-resume': result = await commandTaskAction(client, positional, options, 'resume'); break
    case 'task-run': result = await commandTaskAction(client, positional, options, 'run'); break
    case 'task-delete': result = await commandTaskDelete(client, positional); break
    case 'task-runs': result = await commandTaskRuns(client, options); break
    case 'task-parse': result = await commandTaskParse(client, options); break
    default:
      throw new Error(`Unknown command: ${command}. Run "node qf-api.mjs --help".`)
  }

  process.stdout.write(`${JSON.stringify(result, null, options.pretty === true ? 2 : 0)}\n`)
}

main().catch((error) => {
  process.stderr.write(`qf-api: ${error?.message || error}\n`)
  process.exit(1)
})
