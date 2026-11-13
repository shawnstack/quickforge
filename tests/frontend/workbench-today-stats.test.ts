import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  fetchTodayStats,
  formatTokenCount,
  startOfToday,
  summarizeTodaySessions,
  type TodaySessionEntry,
} from '../../src/lib/workbench-today-stats'

const componentSource = readFileSync(new URL('../../src/components/workbench/Workbench.tsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/components/workbench/workbench.css', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

const NOW = new Date(2026, 10, 13, 15, 30, 0).getTime()
const DAY_START = new Date(2026, 10, 13).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

function entry(createdMs: number, modifiedMs: number, totalTokens?: number): TodaySessionEntry {
  return {
    createdAt: iso(createdMs),
    lastModified: iso(modifiedMs),
    usage: totalTokens === undefined ? null : { totalTokens },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('今日统计纯函数', () => {
  it('startOfToday 取本地零点', () => {
    expect(startOfToday(NOW)).toBe(DAY_START)
  })

  it('summarizeTodaySessions：会话数按 createdAt 今日，token 累加今日活跃会话用量', () => {
    const values = [
      entry(DAY_START + 3_600_000, DAY_START + 7_200_000, 1200),
      entry(DAY_START - 86_400_000, DAY_START + 3_600_000, 800),
      entry(DAY_START + 60_000, DAY_START + 60_000),
    ]
    expect(summarizeTodaySessions(values, DAY_START)).toEqual({ sessions: 2, tokens: 2000 })
    expect(summarizeTodaySessions([], DAY_START)).toEqual({ sessions: 0, tokens: 0 })
  })

  it('formatTokenCount：小数千内精确，上万 K，百万 M', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(9999)).toBe('9999')
    expect(formatTokenCount(45_200)).toBe('45.2K')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
  })
})

describe('fetchTodayStats（现成端点，失败分源降级）', () => {
  it('会话索引倒序翻页 + 任务按 status 计数，时间窗为本地零点到现在的 UTC ISO', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('/sessions-metadata/index/lastModified')) {
        return new Response(JSON.stringify({
          values: [
            entry(DAY_START + 3_600_000, DAY_START + 7_200_000, 1200),
            entry(DAY_START + 60_000, DAY_START + 60_000, 300),
            entry(DAY_START - 86_400_000, DAY_START - 3_600_000, 999),
          ],
          total: 3,
        }), { status: 200 })
      }
      if (url.includes('status=success')) return new Response(JSON.stringify({ total: 3 }), { status: 200 })
      if (url.includes('status=failed')) return new Response(JSON.stringify({ total: 1 }), { status: 200 })
      throw new Error(`unexpected url ${url}`)
    }))
    const stats = await fetchTodayStats(NOW)
    expect(stats).toEqual({ sessions: 2, tokens: 1500, taskRuns: 4, taskSuccess: 3 })
    const indexCall = calls.find((url) => url.includes('/index/lastModified'))!
    expect(indexCall).toContain('direction=desc')
    expect(indexCall).toContain('offset=0')
    for (const url of calls.filter((u) => u.includes('/scheduled-tasks/runs'))) {
      expect(url).toContain(`startedFrom=${encodeURIComponent(iso(DAY_START))}`)
      expect(url).toContain(`startedTo=${encodeURIComponent(iso(NOW))}`)
      expect(url).toContain('pageSize=1')
    }
  })

  it('翻到昨日即停：整页今日则继续下一页', async () => {
    const calls: string[] = []
    const fullPage = Array.from({ length: 200 }, (_, i) => entry(DAY_START + 60_000, DAY_START + 60_000 + i, 10))
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('offset=0')) return new Response(JSON.stringify({ values: fullPage, total: 201 }), { status: 200 })
      if (url.includes('offset=200')) {
        return new Response(JSON.stringify({ values: [entry(DAY_START - 86_400_000, DAY_START - 86_400_000, 5)], total: 201 }), { status: 200 })
      }
      if (url.includes('/scheduled-tasks/runs')) return new Response(JSON.stringify({ total: 0 }), { status: 200 })
      throw new Error(`unexpected url ${url}`)
    }))
    const stats = await fetchTodayStats(NOW)
    expect(stats.sessions).toBe(200)
    expect(stats.tokens).toBe(2000)
    expect(calls.some((url) => url.includes('offset=400'))).toBe(false)
  })

  it('单源失败只降级该源：索引挂 → 会话/token 为 null，任务照常', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/sessions-metadata/')) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ total: 2 }), { status: 200 })
    }))
    expect(await fetchTodayStats(NOW)).toEqual({ sessions: null, tokens: null, taskRuns: 4, taskSuccess: 2 })
  })

  it('任务端点挂 → 任务为 null，会话照常', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/scheduled-tasks/runs')) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify({ values: [entry(DAY_START + 60_000, DAY_START + 60_000, 7)], total: 1 }), { status: 200 })
    }))
    expect(await fetchTodayStats(NOW)).toEqual({ sessions: 1, tokens: 7, taskRuns: null, taskSuccess: null })
  })
})

describe('工作台 TODAY 统计带接线契约', () => {
  it('load 并行拉取统计并渲染统计带，token 走紧凑格式', () => {
    expect(componentSource).toContain("import { fetchTodayStats, formatTokenCount, type TodayStats } from '@/lib/workbench-today-stats'")
    expect(componentSource).toContain('fetchTodayStats(),')
    expect(componentSource).toContain('setToday(nextToday)')
    expect(componentSource).toContain('className="qf-wb__today"')
    expect(componentSource).toContain("today?.tokens != null ? formatTokenCount(today.tokens) : '—'")
    expect(componentSource).toContain("title={t('wbTodayTasksHint')}")
  })

  it('CSS：统计带恒暗仪器色，数字用翻牌铂金，窄屏收紧', () => {
    expect(cssSource).toContain('.qf-wb__today {')
    expect(cssSource).toContain('.qf-wb__today-item > b { font: 600 17px/1 var(--font-mono); color: var(--qf-wb-numeral);')
    expect(cssSource).toContain('.qf-wb__today { padding: 8px 12px; gap: 6px 18px; }')
  })

  it('i18n：统计带键 en/zh 双份齐全', () => {
    for (const key of ['wbTodaySessions', 'wbTodayTokens', 'wbTodayTasks', 'wbTodayTasksHint']) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))?.length).toBe(2)
    }
  })
})