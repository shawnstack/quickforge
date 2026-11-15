import { startOfToday } from '@/lib/workbench-today-stats'

/**
 * QF-08 专有数据补充，只读现成端点，不改服务端，也不改 v8 的 fetchTodayStats 口径。
 *
 * 1) 今日完成记录：sessions-metadata 索引里每条都带 taskFinishedAt / taskStatus 快照，
 *    这是「本次打开工作台之前」也存在的历史，用来回填纸卡，避免一开台就显示空卡。
 * 2) 累计成功率：今日没有定时任务运行时，仪表退到全部历史运行的真实计数，
 *    并在界面上明确标注「累计」，不把 0 次运行画成 0%，也不编造数据。
 */

export type Completion = {
  key: string
  sessionId: string
  name: string
  at: number
  ok: boolean
  status: string
}

export type OverallRunStats = {
  runs: number | null
  success: number | null
}

type MetaEntry = {
  id?: string
  title?: string
  preview?: string
  lastModified?: string | null
  taskFinishedAt?: string | null
  taskStatus?: string | null
}

const PAGE_SIZE = 200
const MAX_PAGES = 3
const COMPLETION_CAP = 24

/** 只认当天完成、且带会话 id 的快照；idle 视为正常结束，error/aborted 视为未成功。 */
export function toCompletions(values: MetaEntry[], dayStart: number): Completion[] {
  const out: Completion[] = []
  for (const value of values) {
    const at = value.taskFinishedAt ? Date.parse(value.taskFinishedAt) : Number.NaN
    const id = (value.id || '').trim()
    if (!id || !Number.isFinite(at) || at < dayStart) continue
    const status = value.taskStatus || ''
    const rawName = (value.title || value.preview || id.slice(0, 8)).trim().split('\n')[0]
    out.push({
      key: `hist:${id}:${value.taskFinishedAt}`,
      sessionId: id,
      name: rawName.slice(0, 48) || id.slice(0, 8),
      at,
      ok: status === 'idle',
      status,
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** 按 lastModified 倒序翻页，翻到昨天即停；单源失败时降级为空列表。 */
export async function fetchTodayCompletions(now: number = Date.now()): Promise<Completion[]> {
  const dayStart = startOfToday(now)
  const out: Completion[] = []
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(
        `/api/storage/sessions-metadata/index/lastModified?direction=desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        { cache: 'no-store' },
      )
      if (!res.ok) break
      const payload = await res.json().catch(() => null)
      const values: MetaEntry[] = Array.isArray(payload?.values) ? payload.values : []
      if (values.length === 0) break
      let reachedPast = false
      for (const value of values) {
        const modified = value.lastModified ? Date.parse(value.lastModified) : Number.NaN
        if (!Number.isFinite(modified) || modified < dayStart) { reachedPast = true; break }
      }
      out.push(...toCompletions(values, dayStart))
      if (reachedPast || values.length < PAGE_SIZE || out.length >= COMPLETION_CAP) break
    }
  } catch {
    return []
  }
  return out.slice(0, COMPLETION_CAP)
}

async function runTotal(status: 'success' | 'failed'): Promise<number | null> {
  try {
    const res = await fetch(`/api/scheduled-tasks/runs?page=1&pageSize=1&status=${status}`, { cache: 'no-store' })
    if (!res.ok) return null
    const payload = await res.json().catch(() => null)
    return typeof payload?.total === 'number' && Number.isFinite(payload.total) ? payload.total : null
  } catch {
    return null
  }
}

/** 不带时间窗的全部运行计数；单源失败时返回 null，让仪表保持空态。 */
export async function fetchOverallRunStats(): Promise<OverallRunStats> {
  const [success, failed] = await Promise.all([runTotal('success'), runTotal('failed')])
  return {
    runs: success !== null && failed !== null ? success + failed : null,
    success,
  }
}
