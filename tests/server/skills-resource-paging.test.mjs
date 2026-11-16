import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 数据目录指到本进程专属空临时目录（与 read-file-params.test.mjs 同一套路）：
// 避免任何传递依赖摸到用户真实的 ~/.quickforge。
const testDataDir = vi.hoisted(() => {
  const previous = process.env.QUICKFORGE_DATA_DIR
  if (previous) return { dir: null, previous }
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp'
  const dir = base + '/qf-test-skill-res-paging-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  process.env.QUICKFORGE_DATA_DIR = dir
  return { dir, previous }
})

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readSkillResource } from '../../server/skills.mjs'

let tmpDir
let skill

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-skill-res-paging-'))
  // 行数超过默认 limit（200），才能看出「limit 没被夹紧时整页消失」
  const lines = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`)
  await fs.writeFile(path.join(tmpDir, 'lines.txt'), lines.join('\n') + '\n', 'utf8')
  skill = { name: 'fixture-skill', rootDir: tmpDir }
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  if (!testDataDir.dir) return
  const { flushLogger } = await import('../../server/utils/logger.mjs')
  flushLogger()
  delete process.env.QUICKFORGE_DATA_DIR
  await fs.rm(testDataDir.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

describe('read_skill_resource 分页参数归一化（与 read_file 同一族）', () => {
  // 模型偶尔把数字写成非数字（"abc" / 2.7 / 空串）。Math.max(1, NaN) 仍是 NaN，
  // 于是 slice(NaN, …) 退化成从头切、每行前缀变成 "NaN: "；limit 非数字时
  // Math.min(2000, NaN) 让整页返回空。read_file 18:17 已修，这里当时漏了。
  it('offset 不是数字时退回第一行，行号前缀不是 NaN', async () => {
    const result = await readSkillResource(skill, 'lines.txt', { offset: 'abc' })

    expect(result.details.offset).toBe(1)
    expect(result.details.limit).toBe(200)
    expect(result.content).not.toContain('NaN')
    expect(result.content.split('\n')[0]).toBe('1: line 1')
  })

  it('limit 不是数字时退回默认 200 行，而不是返回空页', async () => {
    const result = await readSkillResource(skill, 'lines.txt', { limit: 'abc' })

    expect(result.details.limit).toBe(200)
    expect(result.details.offset).toBe(1)
    expect(result.content).toContain('200: line 200')
    expect(result.content).not.toContain('201: line 201')
  })

  it('小数 offset 向下取整，行号与本行内容对齐', async () => {
    const result = await readSkillResource(skill, 'lines.txt', { offset: 2.7, limit: 2 })

    expect(result.details.offset).toBe(2)
    expect(result.content.split('\n')[0]).toBe('2: line 2')
  })

  it('limit 超过 2000 时夹到 2000，offset 负数夹到 1', async () => {
    const result = await readSkillResource(skill, 'lines.txt', { offset: -5, limit: 999999 })

    expect(result.details.offset).toBe(1)
    expect(result.details.limit).toBe(2000)
  })
})
