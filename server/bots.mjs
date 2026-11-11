import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { atomicProjectConfigUpdate, dataDir, readStore, atomicUpdate } from './storage.mjs'

// ---------------------------------------------------------------------------
// Bot 数据层
//
// 一个 bot = 一条记录 + 一个自己独占的目录 + 一个持久会话。
// 记录里不存任何运行时状态以外的秘密：会话 id 是单向外键，会话侧不标记 bot，
// 因为「从会话反查 bot」目前没有需求，而给会话加字段要动 CAS 持久化契约。
// ---------------------------------------------------------------------------

export const BOT_STORE = 'bots'
export const BOT_DIR_NAME = 'bots'
export const BOT_META_DIR = '.bot'
export const BOT_MEMORY_FILE = 'MEMORY.md'
export const BOT_INBOX_FILE = path.join(BOT_META_DIR, 'inbox.md')
export const DEFAULT_HEARTBEAT_MINUTES = 60
export const MIN_HEARTBEAT_MINUTES = 5
/** 无论有没有信号，至少这么久叫醒它一次——否则「不产出就没有信号」会死锁。 */
export const MAX_IDLE_WAKE_MINUTES = 180

/** 吉祥物的默认外观：一个墨黑圆球 + 白色眼睛，动作开着。 */
export const DEFAULT_MASCOT = { body: '#0B0B0C', eye: '#FFFFFF', animated: true }
/** 颜色只收 `#RRGGBB` —— 前端 `<input type="color">` 给的就是这个格式。 */
const MASCOT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

const INVALID_NAME_CHARS = /[\\/:*?"<>|]/
const MAX_NAME_LENGTH = 40

/** 所有 bot 的目录都落在这里：<dataDir>/bots/<目录名> */
export function botsRootDir() {
  return path.join(dataDir, BOT_DIR_NAME)
}

/**
 * 目录名：`bot-<id 前 8 位>`，**不再用显示名**。
 *
 * 早先目录名就是 bot 名字，于是目录同时承担了三件互相拉扯的事：给人看、当路径、
 * 保证唯一。中文名要切输入法才能 `cd` 进去；改过名的 bot 目录还叫旧名字，新建一个
 * 同名 bot 就会算到同一个目录里；大小写或 Unicode 归一化差异也能让两个名字映射到
 * 同一个目录（macOS 的文件系统不区分大小写）。
 *
 * 现在唯一性由 id 保证，可读性交给界面显示 `bot.name` —— 名字随便改，路径不动。
 * 老记录里已经存了 `workspacePath`，`normalizeBotRecord` 优先用它，所以这个改动
 * 不会搬动已有 bot 的目录。
 */
export function botWorkspacePath(botId) {
  const compact = String(botId ?? '').replace(/[^0-9a-zA-Z]/g, '')
  return path.join(botsRootDir(), `bot-${compact.slice(0, 8)}`)
}

/**
 * Bot 名字直接当目录名用，所以规则比项目名更严：不许路径分隔符、不许控制字符、
 * 不许前导点（避免生成隐藏目录）。
 */
export function normalizeBotName(input) {
  const raw = String(input ?? '').trim()
  if (!raw) {
    const error = new Error('Bot name is required')
    error.statusCode = 400
    error.errorCode = 'BOT_NAME_REQUIRED'
    throw error
  }
  if (raw.length > MAX_NAME_LENGTH) {
    const error = new Error(`Bot name is too long (max ${MAX_NAME_LENGTH})`)
    error.statusCode = 400
    error.errorCode = 'BOT_NAME_TOO_LONG'
    throw error
  }
  if (INVALID_NAME_CHARS.test(raw) || raw.startsWith('.')) {
    const error = new Error('Bot name contains invalid characters')
    error.statusCode = 400
    error.errorCode = 'BOT_NAME_INVALID'
    throw error
  }
  for (const char of raw) {
    if (char.charCodeAt(0) < 32) {
      const error = new Error('Bot name contains invalid characters')
      error.statusCode = 400
      error.errorCode = 'BOT_NAME_INVALID'
      throw error
    }
  }
  return raw
}

function nowIso() {
  return new Date().toISOString()
}

function memoryFilePath(workspacePath) {
  return path.join(workspacePath, BOT_MEMORY_FILE)
}

/**
 * 把绝对路径显示成 `~/…`（在家目录下时），否则原样返回。
 *
 * 早先这里直接拼 `'~/' + 'bots/' + name`，写出来是 `~/bots/<名字>`——
 * 但真实目录在 `<dataDir>/bots/<目录名>`，而 dataDir 默认是 `~/.quickforge`。
 * 照着模板去找自己家的人会找错地方（这是它自己读 MEMORY.md 时发现的）。
 */
function displayPath(absolutePath) {
  const home = os.homedir()
  if (home && absolutePath.startsWith(home + path.sep)) {
    return `~${absolutePath.slice(home.length)}`
  }
  return absolutePath
}

function defaultMemoryTemplate(name, workspacePath) {
  return `# ${name}

## 我是谁
一个常驻的 bot。只属于我自己的目录是 \`${displayPath(workspacePath)}\`，这里写的记忆不会被别的 bot 看到。

## 我在意的事
- 报告写得再多也不算产出，真正算数的是改动了什么
- 不确定的时候先问，不要自己造需求

## 备注
（在这里记下踩过的坑、做过的决定、下次要继续的事）
`
}

/**
 * 吉祥物外观：身体色 + 眼睛色 + 一个动画开关。
 * 非法颜色退回上一次的值，再退回默认值 —— 坏数据不该把形象变成透明。
 */
export function normalizeMascot(input, previous = null) {
  const source = input && typeof input === 'object' ? input : {}
  const pick = (key) => {
    const candidate = source[key]
    if (typeof candidate === 'string' && MASCOT_COLOR_PATTERN.test(candidate)) {
      return candidate.toUpperCase()
    }
    return previous?.[key] ?? DEFAULT_MASCOT[key]
  }
  return {
    body: pick('body'),
    eye: pick('eye'),
    animated: source.animated === undefined
      ? (previous?.animated ?? DEFAULT_MASCOT.animated)
      : source.animated === true,
  }
}

function normalizeHeartbeat(input, previous = null) {
  const source = input && typeof input === 'object' ? input : {}
  const fallbackMinutes = previous?.intervalMinutes ?? DEFAULT_HEARTBEAT_MINUTES
  const rawMinutes = Number(source.intervalMinutes ?? fallbackMinutes)
  const intervalMinutes = Number.isFinite(rawMinutes)
    ? Math.max(MIN_HEARTBEAT_MINUTES, Math.round(rawMinutes))
    : fallbackMinutes
  return {
    enabled: source.enabled === undefined ? (previous?.enabled ?? true) : source.enabled === true,
    intervalMinutes,
    nextRunAt: source.nextRunAt === null
      ? null
      : (typeof source.nextRunAt === 'string' ? source.nextRunAt : (previous?.nextRunAt ?? null)),
    lastWakeAt: typeof source.lastWakeAt === 'string' ? source.lastWakeAt : (previous?.lastWakeAt ?? null),
    lastSessionId: typeof source.lastSessionId === 'string' ? source.lastSessionId : (previous?.lastSessionId ?? null),
    wakeCount: Number.isFinite(Number(source.wakeCount ?? previous?.wakeCount))
      ? Number(source.wakeCount ?? previous?.wakeCount)
      : 0,
    idleCount: Number.isFinite(Number(source.idleCount ?? previous?.idleCount))
      ? Number(source.idleCount ?? previous?.idleCount)
      : 0,
    lastIdleReason: typeof source.lastIdleReason === 'string' ? source.lastIdleReason : (previous?.lastIdleReason ?? null),
    lastError: typeof source.lastError === 'string' ? source.lastError : (previous?.lastError ?? null),
  }
}

export function normalizeBotRecord(input, previous = null) {
  const source = input && typeof input === 'object' ? input : {}
  const name = source.name !== undefined || !previous
    ? normalizeBotName(source.name ?? previous?.name)
    : previous.name
  const createdAt = previous?.createdAt ?? (typeof source.createdAt === 'string' ? source.createdAt : nowIso())
  // id 先定下来：新记录靠它算目录名，老记录直接沿用已存的 `workspacePath`。
  const id = previous?.id ?? (typeof source.id === 'string' && source.id ? source.id : randomUUID())
  const workspacePath = previous?.workspacePath ?? (source.workspacePath || botWorkspacePath(id))
  const heartbeat = normalizeHeartbeat(source.heartbeat, previous?.heartbeat ?? null)
  return {
    id,
    name,
    workspacePath,
    memoryFile: memoryFilePath(workspacePath),
    // 注册在 projects.json 里的项目 id；bot 目录就是它的 path。
    projectId: previous?.projectId ?? (typeof source.projectId === 'string' ? source.projectId : null),
    // 这个 bot 唯一的那条会话。
    sessionId: previous?.sessionId ?? (typeof source.sessionId === 'string' ? source.sessionId : null),
    model: source.model ?? previous?.model ?? null,
    modelRef: source.modelRef ?? previous?.modelRef ?? null,
    thinkingLevel: typeof source.thinkingLevel === 'string'
      ? source.thinkingLevel
      : (previous?.thinkingLevel ?? 'medium'),
    accessMode: typeof source.accessMode === 'string' ? source.accessMode : (previous?.accessMode ?? 'full-access'),
    createdAt,
    updatedAt: nowIso(),
    heartbeat,
    mascot: normalizeMascot(source.mascot, previous?.mascot ?? null),
  }
}

export async function listBotRecords() {
  const store = await readStore(BOT_STORE)
  return Object.values(store)
    .filter((bot) => bot && typeof bot === 'object' && typeof bot.id === 'string')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function getBotRecord(botId) {
  if (!botId) return null
  const store = await readStore(BOT_STORE)
  return store[botId] ?? null
}

export async function requireBotRecord(botId) {
  const bot = await getBotRecord(botId)
  if (!bot) {
    const error = new Error('Bot not found')
    error.statusCode = 404
    error.errorCode = 'BOT_NOT_FOUND'
    throw error
  }
  return bot
}

export async function saveBotRecord(bot) {
  const record = normalizeBotRecord(bot, bot)
  await atomicUpdate(BOT_STORE, (store) => ({ ...store, [record.id]: record }))
  return record
}

export async function patchBotRecord(botId, patch) {
  const existing = await requireBotRecord(botId)
  const next = normalizeBotRecord({ ...existing, ...patch }, existing)
  await atomicUpdate(BOT_STORE, (store) => ({ ...store, [botId]: next }))
  return next
}

export async function removeBotRecord(botId) {
  const existing = await getBotRecord(botId)
  if (!existing) return null
  await atomicUpdate(BOT_STORE, (store) => {
    const next = { ...store }
    delete next[botId]
    return next
  })
  return existing
}

// ---------------------------------------------------------------------------
// 工作空间（目录 + 记忆文件）
// ---------------------------------------------------------------------------

export async function ensureBotWorkspace(bot) {
  await fs.mkdir(bot.workspacePath, { recursive: true })
  await fs.mkdir(path.join(bot.workspacePath, BOT_META_DIR), { recursive: true })
  const memoryFile = bot.memoryFile || memoryFilePath(bot.workspacePath)
  try {
    await fs.access(memoryFile)
  } catch {
    await fs.writeFile(memoryFile, defaultMemoryTemplate(bot.name, bot.workspacePath), 'utf8')
  }
  return memoryFile
}

export async function readBotMemory(bot) {
  const file = bot.memoryFile || memoryFilePath(bot.workspacePath)
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
}

export async function writeBotMemory(bot, content) {
  const file = bot.memoryFile || memoryFilePath(bot.workspacePath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, String(content ?? ''), 'utf8')
  return file
}

/**
 * 把 bot 目录注册成一个真实项目。
 *
 * 为什么要注册：createAgent 只认 projectId，项目上下文决定了文件工具的
 * workspaceRoot 和系统提示词里的 workspace 块。注册成项目就能全部复用，
 * 不用给 createAgent 加一条并行的 workspaceRoot 通道（那条路要在 restore 时
 * 也保持一致，容易漏）。
 *
 * 用 kind: 'bot' 标记，前端项目列表据此过滤，避免 bot 目录混进项目切换器。
 * 不改 activeProjectId —— 建一个 bot 不应该把用户当前项目切走。
 */
export async function ensureBotProject({ name, workspacePath }) {
  const resolved = path.resolve(workspacePath)
  const now = nowIso()
  let project = null
  let created = false

  await atomicProjectConfigUpdate((config) => {
    const existing = config.projects.find((item) => item.kind === 'bot'
      && item.path && path.resolve(item.path) === resolved)
    if (existing) {
      project = existing
      existing.name = name
      existing.path = resolved
      return config
    }
    project = {
      id: randomUUID(),
      name,
      path: resolved,
      lastOpenedAt: now,
      sortOrder: config.projects.length,
      skills: [],
      commandDir: '',
      kind: 'bot',
    }
    config.projects.push(project)
    created = true
    return config
  })

  return { project, created }
}

// ---------------------------------------------------------------------------
// 心跳：什么时候值得叫醒它
// ---------------------------------------------------------------------------

export function nextHeartbeatAt(bot, from = Date.now()) {
  const minutes = bot?.heartbeat?.intervalMinutes ?? DEFAULT_HEARTBEAT_MINUTES
  return new Date(from + minutes * 60_000).toISOString()
}

const SIGNAL_IGNORED = new Set([BOT_MEMORY_FILE, BOT_META_DIR, '.git'])

async function newestWorkspaceEntry(workspacePath, sinceMs) {
  let newest = 0
  let inspected = 0
  async function walk(dir, depth) {
    if (depth > 2 || inspected > 200) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (inspected > 200) return
      inspected += 1
      if (SIGNAL_IGNORED.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      try {
        const stat = await fs.stat(full)
        if (stat.mtimeMs > sinceMs && stat.mtimeMs > newest) newest = stat.mtimeMs
      } catch {
        // ignore unreadable entries
      }
    }
  }
  await walk(workspacePath, 0)
  return newest
}

/**
 * 「这一班值不值得叫醒它」。
 *
 * 判据全部是文件事实，不花 token，也不问模型「你觉得有事吗」——
 * 那正是把它变成打卡机的做法。三种情况值得醒：
 *   1. 从没醒过（第一次得认识一下环境）
 *   2. .bot/inbox.md 里有内容（有人/有流程给它留了话）
 *   3. 工作空间里出现了上次醒来之后的新文件
 */
export async function inspectBotWork(bot) {
  const lastWakeMs = bot?.heartbeat?.lastWakeAt ? Date.parse(bot.heartbeat.lastWakeAt) : 0
  if (!lastWakeMs) {
    return { hasWork: true, reason: 'first-wake' }
  }
  try {
    const inbox = await fs.readFile(path.join(bot.workspacePath, BOT_INBOX_FILE), 'utf8')
    if (inbox.trim()) return { hasWork: true, reason: 'inbox' }
  } catch {
    // no inbox file — not a signal
  }
  const newest = await newestWorkspaceEntry(bot.workspacePath, lastWakeMs)
  if (newest > lastWakeMs) return { hasWork: true, reason: 'workspace-changed' }
  // 兜底：太久没醒就强制醒一次。
  //
  // 不加这条会死锁：它自己不动手 → 工作空间不会出现新文件 → 判「没事」→ 永远不醒。
  // 真机验证过：一个只在 MEMORY.md 上打转的 bot 攒了 5 次 idle 就再也没动静了。
  if (Date.now() - lastWakeMs >= MAX_IDLE_WAKE_MINUTES * 60_000) {
    return { hasWork: true, reason: 'stale' }
  }
  return { hasWork: false, reason: 'idle' }
}
