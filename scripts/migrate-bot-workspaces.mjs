#!/usr/bin/env node
/**
 * 一次性迁移：bot 的工作目录从「显示名」改成 `bot-<id 前 8 位>`。
 *
 * 为什么改：目录名原来就是 bot 名字，于是一个字符串同时承担「给人看」和「当路径」两件事。
 * 中文名要切输入法才能 cd 进去；改过名的 bot 目录还叫旧名字，新建同名 bot 就会算到同一
 * 个目录；大小写 / Unicode 归一化差异也能让两个名字映射到同一个目录。
 * 现在唯一性交给 id，可读性交给界面显示 `bot.name`。
 *
 * 新代码只影响新建的 bot（记录里已存 `workspacePath`，归一化时优先用它）。这个脚本负责
 * 把已有的 bot 也搬过去。
 *
 * 用法：
 *   node scripts/migrate-bot-workspaces.mjs --dry-run   # 只看会发生什么
 *   node scripts/migrate-bot-workspaces.mjs             # 真跑
 *
 * 跑之前先停掉 bot 心跳（界面里逐个 bot 关掉，或 PATCH /api/bots/:id 传
 * {"heartbeat":{"enabled":false}}），否则迁移途中它可能往老目录里写东西。
 * 脚本自己会备份 bots.json 与 projects.json 到 ~/.quickforge/_backups/。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const dryRun = process.argv.includes('--dry-run')

function quickforgeDataDir() {
  const fromEnv = process.env.QUICKFORGE_DATA_DIR?.trim()
  return fromEnv || path.join(os.homedir(), '.quickforge')
}

const dataDir = quickforgeDataDir()
const botsRoot = path.join(dataDir, 'bots')
const botsFile = path.join(dataDir, 'storage', 'conversations', 'global', 'bots.json')
const projectsFile = path.join(dataDir, 'config', 'projects.json')
const backupDir = path.join(dataDir, '_backups', `bot-workspace-migration-${new Date().toISOString().replace(/[:.]/g, '-')}`)

function botFolderName(botId) {
  const compact = String(botId ?? '').replace(/[^0-9a-zA-Z]/g, '')
  return `bot-${compact.slice(0, 8)}`
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

/** 写临时文件再 rename —— 中途断掉不会留下半截 JSON。 */
async function writeJsonAtomic(file, value) {
  const temp = `${file}.migration-tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temp, file)
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function main() {
  const bots = await readJson(botsFile, null)
  if (!bots || typeof bots !== 'object') {
    console.error(`[bot-migrate] 找不到 bot 记录：${botsFile}`)
    process.exitCode = 1
    return
  }
  const projects = await readJson(projectsFile, { projects: [] })

  const plan = []
  const problems = []

  for (const [id, bot] of Object.entries(bots)) {
    if (!bot || typeof bot !== 'object') continue
    const desired = path.join(botsRoot, botFolderName(id))
    const current = bot.workspacePath || null
    if (current === desired) continue

    if (await exists(desired)) {
      problems.push(`${bot.name}（${id}）：目标目录已存在，拒绝覆盖 ${desired}`)
      continue
    }
    plan.push({
      id,
      name: bot.name,
      from: current,
      to: desired,
      memoryFrom: bot.memoryFile || (current ? path.join(current, 'MEMORY.md') : null),
      memoryTo: path.join(desired, 'MEMORY.md'),
    })
  }

  if (problems.length > 0) {
    console.error('[bot-migrate] 有冲突，整个迁移中止：')
    for (const line of problems) console.error(`  - ${line}`)
    process.exitCode = 1
    return
  }

  if (plan.length === 0) {
    console.log('[bot-migrate] 所有 bot 的目录已经是新规则，不需要迁移。')
    return
  }

  console.log(`[bot-migrate] ${dryRun ? '演练' : '执行'}，共 ${plan.length} 个 bot：`)
  for (const item of plan) {
    console.log(`  - ${item.name}`)
    console.log(`      目录 ${item.from} → ${item.to}`)
    console.log(`      记忆 ${item.memoryFrom} → ${item.memoryTo}`)
  }

  if (dryRun) {
    console.log('[bot-migrate] --dry-run：没有改动任何文件。')
    return
  }

  await fs.mkdir(backupDir, { recursive: true })
  await fs.copyFile(botsFile, path.join(backupDir, 'bots.json'))
  if (await exists(projectsFile)) {
    await fs.copyFile(projectsFile, path.join(backupDir, 'projects.json'))
  }
  console.log(`[bot-migrate] 已备份到 ${backupDir}`)

  const renamed = new Map() // 老路径 -> 新路径，用来同步 projects.json
  for (const item of plan) {
    if (item.from && await exists(item.from)) {
      await fs.mkdir(path.dirname(item.to), { recursive: true })
      await fs.rename(item.from, item.to)
    } else {
      // 目录可能早被手动删掉了；记录照样改，服务端下次 ensureBotWorkspace 会重建。
      await fs.mkdir(item.to, { recursive: true })
      console.log(`  ! ${item.name}：原目录不存在，已按新规则建了空目录`)
    }
    bots[item.id].workspacePath = item.to
    bots[item.id].memoryFile = item.memoryTo
    if (item.from) renamed.set(path.resolve(item.from), item.to)
  }

  await writeJsonAtomic(botsFile, bots)

  let touchedProjects = 0
  for (const project of projects.projects ?? []) {
    if (project?.kind !== 'bot' || !project.path) continue
    const next = renamed.get(path.resolve(project.path))
    if (next) {
      project.path = next
      touchedProjects += 1
    }
  }
  if (touchedProjects > 0) await writeJsonAtomic(projectsFile, projects)

  console.log(`[bot-migrate] 完成：${plan.length} 个目录，${touchedProjects} 条 bot 项目注册。`)
  console.log('[bot-migrate] 记得把 bot 心跳打开，并重启 QuickForge 让服务端用上新代码。')
}

main().catch((error) => {
  console.error('[bot-migrate] 失败：', error)
  process.exitCode = 1
})
