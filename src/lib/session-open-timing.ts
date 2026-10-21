/**
 * 会话打开耗时埋点（Performance API）。
 *
 * 目的：给「点击会话 → 首帧可交互」建立可观测基线，避免性能优化只能靠
 * 主观感受。打点全部走 `performance.mark`，在 DevTools Performance 面板
 * 中直接可见；同时按会话聚合到内存，供调试面板与测试读取。
 *
 * 约束：埋点必须是零行为影响的旁路——任何异常（Performance API 缺失、
 * 会话 id 非法）都静默跳过，绝不阻塞或改变加载流程。
 */

/** 与 `useAppLoadingTransitions` 中的过渡时长保持一致，仅用于报告分组。 */
export type SessionOpenPhase = 'click' | 'load-start' | 'first-paint' | 'ready'

type TimingRecord = {
  sessionId: string
  marks: Partial<Record<SessionOpenPhase, number>>
  /** 首帧后第一轮装饰耗时（毫秒），只记录第一次。 */
  firstDecorateMs?: number
}

const MARK_PREFIX = 'qf:session-open'
const MAX_RECORDS = 40

const records = new Map<string, TimingRecord>()

function now(): number {
  try {
    return performance.now()
  } catch {
    return 0
  }
}

function markName(sessionId: string, phase: SessionOpenPhase): string {
  return `${MARK_PREFIX}:${phase}:${sessionId}`
}

/**
 * 记录一个阶段打点。重复阶段以首次为准（例如连点同一会话），避免后到的
 * 打点把真实起始时间往后推。
 */
export function markSessionOpen(sessionId: string, phase: SessionOpenPhase): void {
  if (!sessionId) return
  try {
    performance.mark(markName(sessionId, phase), { detail: { sessionId, phase } })
  } catch {
    // Performance API 不可用：仅影响可观测性，不影响功能
  }

  let record = records.get(sessionId)
  if (!record) {
    record = { sessionId, marks: {} }
    records.set(sessionId, record)
    while (records.size > MAX_RECORDS) {
      const oldest = records.keys().next()
      if (oldest.done) break
      records.delete(oldest.value)
    }
  }
  if (record.marks[phase] === undefined) record.marks[phase] = now()
}

/**
 * 计算会话打开的分段耗时（毫秒，缺失阶段为 undefined）。
 * `total` = click → ready，`load` = load-start → ready。
 * `decorate` 是首帧后第一轮 DOM 装饰的耗时——它不在 ready 之前，但会阻塞
 * 用户首次交互（按钮挂载、折叠完成），必须单独可见。
 */
export function readSessionOpenTiming(sessionId: string): {
  clickToReadyMs?: number
  clickToFirstPaintMs?: number
  loadToReadyMs?: number
  firstDecorateMs?: number
} {
  const record = records.get(sessionId)
  const marks = record?.marks
  if (!marks) return {}
  const click = marks.click
  const ready = marks.ready
  const firstPaint = marks['first-paint']
  const loadStart = marks['load-start']
  const diff = (from?: number, to?: number) => (
    from !== undefined && to !== undefined && to >= from ? Math.round((to - from) * 10) / 10 : undefined
  )
  return {
    clickToReadyMs: diff(click, ready),
    clickToFirstPaintMs: diff(click, firstPaint),
    loadToReadyMs: diff(loadStart, ready),
    firstDecorateMs: record?.firstDecorateMs,
  }
}

/**
 * 记录首帧后第一轮装饰的耗时。只保留第一次的值：后续装饰是流式期的常规开销，
 * 混入会掩盖「打开会话」这个场景的真实成本。
 */
export function recordFirstDecorateTiming(sessionId: string, durationMs: number): void {
  if (!sessionId) return
  const record = records.get(sessionId)
  if (!record || record.firstDecorateMs !== undefined) return
  record.firstDecorateMs = Math.round(durationMs * 10) / 10
  // Also surface it as a mark: decoration runs after `ready`, so a DevTools
  // performance trace otherwise ends the session-open story at "painted" and
  // hides the cost that actually blocks the first interaction.
  try {
    performance.mark(`${MARK_PREFIX}:decorate:${sessionId}`, {
      detail: { sessionId, phase: 'decorate', durationMs: record.firstDecorateMs },
    })
  } catch {
    // Performance API unavailable: the in-memory record still works.
  }
}

/** 清空打点记录（测试隔离）。 */
export function resetSessionOpenTimings(): void {
  records.clear()
}
