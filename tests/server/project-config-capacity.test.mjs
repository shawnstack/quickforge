import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

/**
 * 项目列表不该有「到 20 条就砍」的上限。
 *
 * `setActiveProjectPath` 末尾曾经有一句
 *   `if (config.projects.length > 20) config.projects = config.projects.slice(-20)`
 * 于是「选择目录」第 21 次会按**数组下标**切掉最前面那条——那可能是他最常用的项目，
 * 也可能是某个 bot 的项目（bot 目录同样登记在 projects 里，是文件工具的 workspaceRoot）。
 * 接口照样返回 200，用户只看到侧栏少了一项，它的 skills / commandDir 一起没了。
 */
async function withTempStorage(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-project-capacity-'))
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  const database = await import('../../server/sqlite/database.mjs')
  try {
    await database.initializeSqliteStorage()
    const storage = await import('../../server/storage.mjs')
    const projectConfig = await import('../../server/project-config.mjs')
    await testFn({ storage, projectConfig, tmpDir })
  } finally {
    await database.closeSqliteStorage().catch(() => {})
    // logger 的刷盘定时器还挂在临时目录上：不先 flush + 恢复 env 就 rm，Windows 上会
    // 留下 %TEMP% 空壳目录（这条坑见 tests/server/storage-config-split.test.mjs 同款注释）。
    const { flushLogger } = await import('../../server/utils/logger.mjs')
    flushLogger()
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

function projectEntry(id, patch = {}) {
  return {
    id,
    name: id,
    path: path.resolve('/nonexistent', id),
    lastOpenedAt: '',
    sortOrder: 0,
    skills: [],
    commandDir: '',
    ...patch,
  }
}

describe('项目列表不设 20 条上限', () => {
  it('已登记 20 个项目时，打开第 21 个目录不会删掉任何旧项目', async () => {
    await withTempStorage(async ({ storage, projectConfig, tmpDir }) => {
      const seeded = []
      for (let index = 1; index <= 20; index += 1) seeded.push(projectEntry(`p${index}`))
      seeded[0].skills = ['skill-creator']
      seeded[0].commandDir = 'commands/keep-me'
      seeded[1] = projectEntry('bot-1', { kind: 'bot' })

      await storage.atomicProjectConfigUpdate((config) => {
        config.projects = seeded
        return config
      })

      const newDir = path.join(tmpDir, 'fresh-project')
      await fs.mkdir(newDir, { recursive: true })
      const { projects } = await projectConfig.setActiveProjectPath(newDir)

      expect(projects).toHaveLength(21)
      const keptFirst = projects.find((item) => item.id === 'p1')
      expect(keptFirst?.skills).toEqual(['skill-creator'])
      expect(keptFirst?.commandDir).toBe('commands/keep-me')
      expect(projects.some((item) => item.id === 'bot-1' && item.kind === 'bot')).toBe(true)
      expect(projects.some((item) => item.path === path.resolve(newDir))).toBe(true)
    })
  })
})
