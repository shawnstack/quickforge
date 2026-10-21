/**
 * 滚动阅读锚点（单一真相）。
 *
 * 场景：一次变更会在视口**上方**插入或移除内容（后台补齐历史、加载更早一页、
 * 折叠组重建）。此时 `scrollTop` 不变，但上方高度变了，用户正在读的那一行会被
 * 推走。通用的解法是：变更前记住「顶部可见行 + 它相对容器顶边的偏移」，
 * 变更提交后重新测量同一行，把差值补进 `scrollTop`。
 *
 * 这里把该逻辑收成一个模块，避免每个调用点各写一遍（历史上有过两处实现，
 * 公式相同但各自维护）。
 *
 * 两个已核实的设计选择：
 *
 * 1. **用绝对 `data-message-index` 作为首选标识，ordinal 作为回退。** 插入内容会
 *    让所有 ordinal 位移，但 `data-message-index` 是消息在全量列表中的绝对下标
 *    （`messageIndexOffset` 恒为 0），插入后同一条消息仍是同一个值。而折叠过程组
 *    这类非消息行没有该属性，只能退回 ordinal。
 * 2. **不用 `offsetTop`。** 它在插入行的最终高度确定之前就被读取，算出的 delta
 *    是错的（实测复现过）。改用「相对容器顶边的视口偏移」，两侧用同一个基准。
 */

const MESSAGE_LIST_SELECTOR = '.qf-message-list'

export type ScrollAnchor = {
  /** 目标行在全量消息列表中的绝对下标；非消息行（折叠组等）为 undefined。 */
  messageIndex: string | undefined
  /** 目标行在渲染行列表中的位置（回退标识）。 */
  ordinal: number
  /** 目标行顶边相对滚动容器顶边的偏移（px）。 */
  offsetFromTop: number
  /** 捕获时的 scrollTop。 */
  scrollTop: number
}

type ReadAnchorOptions = {
  /**
   * 只在带 `data-message-index` 的行里选锚点。
   *
   * 「加载更早一页」需要这一点：它必须落回一条真实消息，不能拿折叠组当锚点
   * （分页后折叠组会被重建）。补齐历史则允许任意行，因为目标只是保持视觉位置。
   */
  requireMessageIndex?: boolean
}

function candidateRows(container: HTMLElement, options: ReadAnchorOptions): HTMLElement[] {
  const list = container.querySelector<HTMLElement>(MESSAGE_LIST_SELECTOR)
  if (!list) return []
  if (options.requireMessageIndex) {
    return Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-message-index]'))
  }
  return Array.from(list.children as HTMLCollectionOf<HTMLElement>)
}

/**
 * 读取当前顶部可见行作为锚点。找不到可用行时返回 null。
 */
export function readScrollAnchor(container: HTMLElement, options: ReadAnchorOptions = {}): ScrollAnchor | null {
  const rows = candidateRows(container, options)
  if (rows.length === 0) return null
  const containerTop = container.getBoundingClientRect().top
  const anchor = rows.find((row) => row.getBoundingClientRect().bottom > containerTop)
  if (!anchor) return null
  return {
    messageIndex: anchor.dataset.messageIndex,
    ordinal: rows.indexOf(anchor),
    offsetFromTop: anchor.getBoundingClientRect().top - containerTop,
    scrollTop: container.scrollTop,
  }
}

/**
 * 变更后重新定位锚点行。优先按绝对下标找，找不到再按 ordinal 回退。
 */
export function resolveAnchorRow(
  container: HTMLElement,
  anchor: ScrollAnchor,
  options: ReadAnchorOptions = {},
): HTMLElement | null {
  if (anchor.messageIndex !== undefined) {
    const byIndex = container.querySelector<HTMLElement>(
      `${MESSAGE_LIST_SELECTOR} > [data-message-index="${anchor.messageIndex}"]`,
    )
    if (byIndex) return byIndex
  }
  const rows = candidateRows(container, options)
  return (rows[anchor.ordinal] as HTMLElement | undefined) ?? null
}

/**
 * 变更后应写入的 scrollTop。返回 null 表示无需调整（锚点行已消失或未位移）。
 */
export function anchoredScrollTop(
  container: HTMLElement,
  anchor: ScrollAnchor,
  options: ReadAnchorOptions = {},
): number | null {
  const retained = resolveAnchorRow(container, anchor, options)
  if (!retained) return null
  const containerTop = container.getBoundingClientRect().top
  const delta = (retained.getBoundingClientRect().top - containerTop) - anchor.offsetFromTop
  if (delta === 0) return null
  return anchor.scrollTop + delta
}
