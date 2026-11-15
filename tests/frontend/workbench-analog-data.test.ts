import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOverallRunStats,
  fetchTodayCompletions,
  toCompletions,
} from '../../src/components/workbench/workbench-analog-data'

const NOW = new Date(2026, 10, 15, 15, 30, 0).getTime()
const DAY_START = new Date(2026, 10, 15).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const meta = (over: Record<string, unknown> = {}) => ({
  id: 'session-1',
  title: '主助手',
  lastModified: iso(DAY_START + 3_600_000),
  taskFinishedAt: iso(DAY_START + 3_600_000),
  taskStatus: 'idle',
  ...over,
})

afterEach(() => vi.unstubAllGlobals())

describe('QF-08 今日完成记录回填', () => {
  it('只收当天完成且带会话 id 的快照，按完成时间倒序', () => {
    const list = toCompletions([
      meta({ id: 'a', title: 'A', taskFinishedAt: iso(DAY_START + 60_000) }),
      meta({ id: 'b', title: 'B', taskFinishedAt: iso(DAY_START + 7_200_000) }),
      meta({ id: 'c', taskFinishedAt: iso(DAY_START - 60_000) }),
      meta({ id: 'd', taskFinishedAt: null }),
      meta({ id: '' }),
    ], DAY_START)
    expect(list.map((x) => x.sessionId)).toEqual(['b', 'a'])
  })

  it('idle 视为正常结束，error / aborted 视为未成功', () => {
    const list = toCompletions([
      meta({ id: 'a', taskStatus: 'idle' }),
      meta({ id: 'b', taskStatus: 'error' }),
      meta({ id: 'c', taskStatus: 'aborted' }),
    ], DAY_START)
    expect(list.map((x) => x.ok)).toEqual([true, false, false])
  })

  it('翻页到昨日即停，端点失败时降级为空列表', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({
        values: [
          meta({ id: 'a', title: 'A', taskFinishedAt: iso(DAY_START + 60_000), lastModified: iso(DAY_START + 60_000) }),
          meta({ id: 'b', taskFinishedAt: iso(DAY_START - 60_000), lastModified: iso(DAY_START - 60_000) }),
        ],
      }), { status: 200 })
    }))
    const list = await fetchTodayCompletions(NOW)
    expect(list.map((x) => x.sessionId)).toEqual(['a'])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('offset=0')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await fetchTodayCompletions(NOW)).toEqual([])
  })

  it('长标题截断，缺省标题回退到 preview 或 id', () => {
    const list = toCompletions([
      meta({ id: 'a', title: '标题'.repeat(100) }),
      meta({ id: 'b', title: '', preview: '第一行\n第二行' }),
      meta({ id: 'c', title: '', preview: '' }),
    ], DAY_START)
    expect(list[0].name).toHaveLength(48)
    expect(list[1].name).toBe('第一行')
    expect(list[2].name).toBe('c')
  })
})

describe('QF-08 累计成功率回退', () => {
  it('汇总全部 success / failed 计数，不带时间窗参数', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response(JSON.stringify({ total: url.includes('status=success') ? 3 : 1 }), { status: 200 })
    }))
    expect(await fetchOverallRunStats()).toEqual({ runs: 4, success: 3 })
    expect(calls.every((url) => !url.includes('startedFrom'))).toBe(true)
    expect(calls.every((url) => url.includes('pageSize=1'))).toBe(true)
  })

  it('单源失败降级为 null，界面保持空态而不是画 0%', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('status=failed')) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ total: 2 }), { status: 200 })
    }))
    expect(await fetchOverallRunStats()).toEqual({ runs: null, success: 2 })
  })
})
