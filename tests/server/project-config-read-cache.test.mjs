import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * `readProjectConfigData` 是 agent 创建热路径上被读三次的入口（
 * `createAgent` → `readProjectConfig` / `projectContextFromId` /
 * `buildInstructionsPayload`）。这里锁定它的缓存语义：
 *
 * - 重复读取结果一致（读缓存不影响返回值）
 * - 外部直接改文件后重新读取能看到新值（(mtime, size) 校验生效）
 * - 通过 `writeProjectConfigData` 写入后立即读取能看到新值（写入主动失效）
 * - 调用方修改返回值不会污染后续读取（每次返回深拷贝）
 */
describe('project config read cache', () => {
  const createdDirs = []

  async function freshDataDir() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-project-config-cache-'))
    createdDirs.push(dir)
    return dir
  }

  afterEach(async () => {
    for (const dir of createdDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true })
    }
    delete process.env.QUICKFORGE_DATA_DIR
  })

  /**
   * storage.mjs 在模块加载时解析 `QUICKFORGE_DATA_DIR`，因此必须在设置环境
   * 变量之后重新导入模块，才能让每个用例指向独立的数据目录。
   */
  async function loadStorage(dataDir) {
    process.env.QUICKFORGE_DATA_DIR = dataDir
    const modulePath = '../../server/storage.mjs'
    return import(`${modulePath}?dataDir=${encodeURIComponent(dataDir)}`)
  }

  it('returns stable values across repeated reads', async () => {
    const dataDir = await freshDataDir()
    const storage = await loadStorage(dataDir)
    await storage.ensureStorage()

    const first = await storage.readProjectConfigData()
    const second = await storage.readProjectConfigData()

    expect(second).toEqual(first)
    expect(first).toHaveProperty('projects')
  })

  it('observes an external file edit on the next read', async () => {
    const dataDir = await freshDataDir()
    const storage = await loadStorage(dataDir)
    await storage.ensureStorage()
    await storage.readProjectConfigData()

    // Write a distinctly larger config directly to disk (bypassing the writer
    // API) so both size and mtime change.
    const file = path.join(dataDir, 'config', 'projects.json')
    const changed = {
      activeProjectId: 'external-project',
      globalSkills: [],
      projects: [{ id: 'external-project', name: 'External', path: dataDir }],
    }
    await fs.writeFile(file, JSON.stringify(changed, null, 2), 'utf8')

    const reread = await storage.readProjectConfigData()
    expect(reread.activeProjectId).toBe('external-project')
    expect(reread.projects).toHaveLength(1)
  })

  it('observes a write through the writer API immediately', async () => {
    const dataDir = await freshDataDir()
    const storage = await loadStorage(dataDir)
    await storage.ensureStorage()
    await storage.readProjectConfigData()

    await storage.writeProjectConfigData({
      activeProjectId: 'written-project',
      globalSkills: ['skill-a'],
      projects: [{ id: 'written-project', name: 'Written', path: dataDir }],
    })

    const reread = await storage.readProjectConfigData()
    expect(reread.activeProjectId).toBe('written-project')
    expect(reread.globalSkills).toEqual(['skill-a'])
  })

  it('never lets a caller mutate the cached original', async () => {
    const dataDir = await freshDataDir()
    const storage = await loadStorage(dataDir)
    await storage.ensureStorage()

    const first = await storage.readProjectConfigData()
    first.projects.push({ id: 'injected', name: 'Injected', path: dataDir })
    first.globalSkills.push('injected-skill')

    const second = await storage.readProjectConfigData()
    expect(second.projects.some((project) => project.id === 'injected')).toBe(false)
    expect(second.globalSkills).not.toContain('injected-skill')
  })
})
