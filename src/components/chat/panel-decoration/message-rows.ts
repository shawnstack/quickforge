/**
 * 消息行枚举（单一实现）。
 *
 * 装饰层有 4 个模块需要「本列表直接拥有的消息行」：消息动作、过程折叠、
 * 上下文压缩横线、审批卡插入点、等待气泡。此前每个模块各写一份
 * `querySelectorAll('.qf-user-message, .qf-assistant-message')` + `closest` 过滤，
 * 于是一次装饰 pass 会对同一张列表重复做多遍全表扫描。
 *
 * 这里提供两件事：
 * - `readMessageRows`：唯一的枚举实现；
 * - `cachedMessageRows`：一次装饰 pass 内复用同一结果——调用方在 pass 开始时读
 *   一次，之后把数组传下去。
 *
 * 语义与原实现完全一致（只保留 `closest` 命中本列表的行，跳过流式尾行）。
 */

const MESSAGE_ROW_SELECTOR = 'user-message, assistant-message, .qf-user-message, .qf-assistant-message'
const MESSAGE_LIST_SELECTOR = '.qf-message-list'

/**
 * The selector keeps the legacy `user-message` / `assistant-message` tags even
 * though the React surface renders only `div.qf-*` (measured: 0 matches).
 * Dropping them saves ~2ms on a 618-row list, which is below the longtask
 * threshold — while `message-actions.test.ts` explicitly locks legacy-tag
 * compatibility through its fixture. Not worth trading a locked contract for an
 * unmeasurable win.
 */

export function getPrimaryMessageList(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>(MESSAGE_LIST_SELECTOR)
}

/**
 * 消息行，按文档顺序。仅包含直接归属该列表的行（嵌套列表的行被排除），
 * 并跳过流式尾行（它归过程折叠所有，不参与行级装饰）。
 */
export function readMessageRows(panel: HTMLElement): HTMLElement[] {
  const messageList = getPrimaryMessageList(panel)
  if (!messageList) return []
  const rows: HTMLElement[] = []
  for (const element of messageList.querySelectorAll<HTMLElement>(MESSAGE_ROW_SELECTOR)) {
    if ((element as { isStreaming?: boolean }).isStreaming === true) continue
    // Two separate lookups rather than one comma selector: the legacy tag is a
    // separate fallback, and keeping them distinct lets a minimal DOM stub
    // (tests) support the class form alone.
    const owner = element.closest('.qf-message-list') ?? element.closest('message-list')
    if (owner !== messageList) continue
    rows.push(element)
  }
  return rows
}

/**
 * 一次装饰 pass 内的行快照。
 *
 * 传入 `panel` 时按需枚举并记住结果；之后再调用直接返回同一数组。变换一律
 * 在 pass 内同步完成（装饰是同步的），所以不存在跨异步边界的失效问题。若某个
 * 装饰器改动了行结构，它必须在同一 pass 内重新调用 `readMessageRows`。
 */
export function createMessageRowSnapshot(panel: HTMLElement): {
  rows: () => HTMLElement[]
  invalidate: () => void
} {
  let cached: HTMLElement[] | null = null
  return {
    rows() {
      if (!cached) cached = readMessageRows(panel)
      return cached
    },
    invalidate() {
      cached = null
    },
  }
}
