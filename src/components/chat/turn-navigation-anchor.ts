/**
 * 轮次导航的滚动锚点解析（单一真相）。
 *
 * 导航节点来自**全量消息**（`buildConversationTurns`），而可滚动目标只有
 * `MessageList` 实际渲染出来的行。两条链路过去用「第 n 个 `.qf-user-message`」
 * 的序号算术把两者对上，遇到下面两类行就会错位：
 *
 * 1. **`display: none` 的 user 行。** goal 续跑提示（`metadata.quickforgeGoalRun`）
 *    和后台命令完成通知（`details.quickforgeBackgroundCommand`）都是
 *    `role: 'user'`，但渲染层给它们加 `quickforge-goal-internal-user-message`
 *    并把整行隐藏（见 `src/styles/chat/messages.css`）。`querySelectorAll` 不看可见性，序号
 *    计数照旧把它们算进去，于是选中的 "用户消息" 是一个零尺寸节点：它的
 *    `getBoundingClientRect().top` 恒为 0，既让 `top <= threshold` 永远成立
 *    （高亮随机跳格），也让点击跳转算出一个和视口无关的目标位置。
 * 2. **被窗口裁掉的行。** 序号只在当前窗口内有效，pin 到中间窗口时前后
 *    偏移全部漂移。
 *
 * 因此改为按 `MessageList` 写在行上的绝对 `data-message-index` 解析锚点
 * （`MessageList.tsx` 的 `useLayoutEffect`）：它是消息在全量数组里的下标，
 * 与窗口起点无关，正是 `turns[].messageIndex` 的同一套坐标。
 */

import type { ConversationTurn } from './turn-navigation-data'

/** 一行渲染消息：`data-message-index` 是它对应的全量消息下标。 */
export type IndexedRow = {
  element: HTMLElement
  messageIndex: number
}

/** 一个导航节点对应的滚动目标。 */
export type TurnAnchor = {
  ordinal: number
  element: HTMLElement
}

/**
 * 行是否参与布局。
 *
 * `display: none` 的行没有任何 client rect；它的盒模型几何读出来是全 0，
 * 直接当锚点会把视口带到无关位置（0 也恒小于任何高亮阈值）。没有
 * `getClientRects` 的环境（测试桩）按「有布局」处理。
 */
export function isLaidOutRow(element: HTMLElement): boolean {
  if (typeof element.getClientRects !== 'function') return true
  return element.getClientRects().length > 0
}

/**
 * 收集 `.qf-message-list` 的直接子行中带绝对下标的那些。
 *
 * 只看直接子级：subagent 过程列表会嵌套另一份 `.qf-message-list`，它的行
 * 不属于当前对话的轮次。缺下标（React 尚未提交 `useLayoutEffect`）的行直接
 * 跳过 —— 宁可本轮不高亮，也不要按序号猜。
 */
export function collectIndexedRows(list: HTMLElement): IndexedRow[] {
  const rows: IndexedRow[] = []
  const children = list.children as HTMLCollectionOf<HTMLElement> | undefined
  if (!children) return rows
  for (const element of Array.from(children)) {
    const raw = element.dataset?.messageIndex
    if (raw === undefined || raw === '') continue
    const messageIndex = Number(raw)
    if (!Number.isFinite(messageIndex)) continue
    rows.push({ element, messageIndex })
  }
  return rows
}

/**
 * 解析一条轮次的滚动目标。
 *
 * - 轮次自身的 user 行可见 → 就是它（正常路径）。
 * - 自身行被隐藏（goal 续跑 / 后台通知）→ 该轮次之后第一个可见行；没有则退到
 *   之前最后一个可见行。这样这些节点的点击与高亮仍然落在有内容的邻近位置。
 * - 自身行根本不在 DOM 里（被窗口裁掉、或尚未渲染）→ `null`，不猜。
 */
export function resolveTurnAnchor(rows: IndexedRow[], messageIndex: number): HTMLElement | null {
  const own = rows.find((row) => row.messageIndex === messageIndex)
  if (!own) return null
  if (isLaidOutRow(own.element)) return own.element

  const later = rows.find((row) => row.messageIndex > messageIndex && isLaidOutRow(row.element))
  if (later) return later.element

  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row.messageIndex < messageIndex && isLaidOutRow(row.element)) return row.element
  }
  return null
}

/** 每个（当前渲染出来的）轮次对应哪个滚动目标，按轮次顺序返回。 */
export function collectTurnAnchors(list: HTMLElement, turns: ConversationTurn[]): TurnAnchor[] {
  const rows = collectIndexedRows(list)
  if (rows.length === 0) return []
  const anchors: TurnAnchor[] = []
  turns.forEach((turn, ordinal) => {
    const element = resolveTurnAnchor(rows, turn.messageIndex)
    if (element) anchors.push({ ordinal, element })
  })
  return anchors
}
