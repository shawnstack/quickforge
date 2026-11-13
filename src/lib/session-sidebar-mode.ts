/** bot 会话 id 的约定前缀：`server/bot-session.mjs` 生成 `bot-<bot.id>-<uuid8>`。 */
const BOT_SESSION_ID_PREFIX = 'bot-'

/** 只要够用的形状：`BotSummary` / `botShell.bots` 都满足。 */
export type BotSessionLike = { sessionId?: string | null }

/**
 * 这条会话是不是某个 bot 的——侧栏该显示 bot 列表还是普通会话列表，就取决于它。
 *
 * 两条判据，先准后快：
 * 1. 已知 bots 列表里有人的 `sessionId` 就是它：数据真相，服务端将来改 id 规则也不受影响；
 * 2. 会话 id 的 `bot-` 前缀：即时兜底——列表可能还没加载完、或已过期（比如刚建的 bot），
 *    而 bot 会话 id 的 `bot-` 前缀是服务端约定（`server/bot-session.mjs`）。
 *
 * 普通会话 id 是 UUID 一类，不会以 `bot-` 开头，所以前缀兜底不会误判。
 */
export function isBotSession(sessionId: string, bots: readonly BotSessionLike[]): boolean {
  if (!sessionId) return false
  if (bots.some((bot) => Boolean(bot.sessionId) && bot.sessionId === sessionId)) return true
  return sessionId.startsWith(BOT_SESSION_ID_PREFIX)
}

/** 只取用得到的 store 形状（真实 `useUIStore` 满足，测试里可以塞假对象）。 */
export type SidebarModeStore = {
  getState: () => { botMode: boolean; setBotMode: (value: boolean) => void }
}

/**
 * 侧栏模式跟随「刚被打开的会话」：bot 会话 → bot 列表，普通会话 → 普通列表（双向）。
 *
 * 侧栏上的模式切换按钮之外，会话还会从工作台、设置页、系统通知进来——那些入口只
 * 发 `requestOpenSession` 请求，不会顺手改 `botMode`，所以模式由这条请求自己带过来：
 * 否则右侧是 bot 的对话、左侧还停在普通会话列表。
 *
 * 已经处在目标模式时不写 store（不做无意义的状态写入）；返回是否真的改了。
 */
export function syncSidebarModeToSession(
  sessionId: string,
  bots: readonly BotSessionLike[],
  store: SidebarModeStore,
): boolean {
  const wantBotMode = isBotSession(sessionId, bots)
  const state = store.getState()
  if (state.botMode === wantBotMode) return false
  state.setBotMode(wantBotMode)
  return true
}
