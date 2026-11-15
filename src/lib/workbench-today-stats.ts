// 工作台 TODAY 统计带：全部来自现成端点，不改服务端。
// 会话/token 走 sessions-metadata 索引（排序是 (置顶) DESC, pinnedAt DESC, 再 lastModified 倒序；
// 置顶区里「修改时间很旧」的行排在最前，所以「越界即收手」只对非置顶行成立），
// 任务运行走 /api/scheduled-tasks/runs 的 status 计数（startedFrom/To 为 UTC ISO，与库里 startedAt 同基准）。
// token 是「今日活跃会话」的累计用量近似：usage 按会话累计，无按日切片。

export type TodayStats = {
  sessions: number | null
  tokens: number | null
  taskRuns: number | null
  taskSuccess: number | null
}

export type TodaySessionEntry = {
  createdAt?: string
  lastModified?: string | null
  /** 索引排序键之一：置顶行排在 lastModified 之前，翻页判定必须认它。 */
  pinnedAt?: string | null
  usage?: { totalTokens?: number } | null
}

const PAGE_SIZE = 200
const MAX_PAGES = 10

export function startOfToday(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function summarizeTodaySessions(values: TodaySessionEntry[], dayStart: number): { sessions: number; tokens: number } {
  let sessions = 0
  let tokens = 0
  for (const value of values) {
    const created = value.createdAt ? Date.parse(value.createdAt) : Number.NaN
    if (Number.isFinite(created) && created >= dayStart) sessions += 1
    const used = value.usage?.totalTokens
    if (typeof used === 'number' && Number.isFinite(used) && used > 0) tokens += used
  }
  return { sessions, tokens }
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

/** 索引把置顶会话排在 lastModified 之前，所以置顶行越界不代表「后面的都更旧」。 */
export function isPinnedIndexEntry(value: { pinnedAt?: string | null }): boolean {
  const pinned = value.pinnedAt
  return typeof pinned === 'string' && pinned.trim() !== '' && pinned.trim() !== 'null' && pinned.trim() !== 'false'
}

async function fetchActiveTodaySessions(dayStart: number): Promise<TodaySessionEntry[] | null> {
  const out: TodaySessionEntry[] = []
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(
        `/api/storage/sessions-metadata/index/lastModified?direction=desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        { cache: 'no-store' },
      )
      if (!res.ok) return null
      const payload = await res.json().catch(() => null)
      const values: TodaySessionEntry[] = Array.isArray(payload?.values) ? payload.values : []
      if (values.length === 0) break
      let reachedPast = false
      for (const value of values) {
        const modified = value.lastModified ? Date.parse(value.lastModified) : Number.NaN
        // 缺 lastModified / 解析不出：只跳过这一条，别当成「已经翻到昨天」。
        if (!Number.isFinite(modified)) continue
        if (modified >= dayStart) { out.push(value); continue }
        // 索引是 (置顶) DESC, pinnedAt DESC, lastModified DESC：置顶区里修改时间很旧的行会排在最前，
        // 它越界不代表后面的都更旧——置顶一条旧会话就让今日统计整段归零，就是这么来的。
        if (isPinnedIndexEntry(value)) continue
        reachedPast = true
        break
      }
      if (reachedPast || values.length < PAGE_SIZE) break
    }
    return out
  } catch {
    return null
  }
}

async function fetchRunTotal(from: string, to: string, status: 'success' | 'failed'): Promise<number | null> {
  try {
    const params = new URLSearchParams({ page: '1', pageSize: '1', status, startedFrom: from, startedTo: to })
    const res = await fetch(`/api/scheduled-tasks/runs?${params.toString()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const payload = await res.json().catch(() => null)
    return typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : null
  } catch {
    return null
  }
}

export async function fetchTodayStats(now: number = Date.now()): Promise<TodayStats> {
  const dayStart = startOfToday(now)
  const from = new Date(dayStart).toISOString()
  const to = new Date(now).toISOString()
  const [active, success, failed] = await Promise.all([
    fetchActiveTodaySessions(dayStart),
    fetchRunTotal(from, to, 'success'),
    fetchRunTotal(from, to, 'failed'),
  ])
  const summarized = active ? summarizeTodaySessions(active, dayStart) : null
  return {
    sessions: summarized?.sessions ?? null,
    tokens: summarized?.tokens ?? null,
    taskRuns: success !== null && failed !== null ? success + failed : null,
    taskSuccess: success,
  }
}