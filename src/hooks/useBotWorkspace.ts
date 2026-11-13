import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createBot as createBotRequest,
  deleteBot as deleteBotRequest,
  ensureBotSessionOpen,
  fetchBots,
  reorderBots,
  wakeBot as wakeBotRequest,
  type BotSummary,
} from '@/components/bots/bots-data'
import { containsPraise, useMascotActions } from '@/components/bots/mascot/use-mascot-actions'
import { useMascotStroll } from '@/components/bots/mascot/use-mascot-stroll'
import { useMascotState } from '@/components/bots/mascot/use-mascot-state'
import { showAlert } from '@/components/ui/confirm-dialog'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { useUIStore } from '@/stores/ui-store'

type BotAgentLike = {
  sessionId: string
  state: {
    isStreaming?: boolean
    errorMessage?: string | null
    pendingToolCalls?: Set<string> | string[]
    pendingToolApproval?: unknown
    pendingAsk?: unknown
  }
} | null | undefined

/** bot 模式的工作区状态（原 MainApp 内联的 bot 块）。
 *
 *  一个 bot = 一条持久会话 + 一个独占目录。侧栏换成 bot 列表，主区仍然
 *  复用普通会话视图；这里收拢 bot 列表的加载 / 增删改 / 拖动排序 / 催醒、
 *  bot 模式切换（进模式自动打开第一个 bot、退模式反向补偿落到新对话
 *  空态）与主区吉祥物的状态派生。
 */
export function useBotWorkspace(context: {
  needsModelSetup: boolean
  currentSessionId: string | undefined
  agent: BotAgentLike
  completedSessionIds: ReadonlySet<string>
  startNewDefaultSession: () => void
}) {
  const { needsModelSetup, currentSessionId, agent, completedSessionIds, startNewDefaultSession } = context

  const botMode = useUIStore((s) => s.botMode)
  const setBotMode = useUIStore((s) => s.setBotMode)
  const [bots, setBots] = useState<BotSummary[]>([])
  const [botsLoading, setBotsLoading] = useState(true)
  const [botsError, setBotsError] = useState<string | null>(null)
  const [newBotOpen, setNewBotOpen] = useState(false)
  const [newBotPending, setNewBotPending] = useState(false)
  const [newBotError, setNewBotError] = useState<string | null>(null)
  const [botSettings, setBotSettings] = useState<BotSummary | null>(null)

  // effect 里不能同步 setState（会级联渲染），所以这里所有状态更新都发生在 await 之后。
  // 返回拿到的列表：切进 bot 模式时要立刻用它挑第一个 bot，不能只依赖 state。
  const refreshBots = useCallback(async (): Promise<BotSummary[]> => {
    try {
      const list = await fetchBots()
      setBots(list)
      setBotsError(null)
      return list
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : String(error))
      return []
    } finally {
      setBotsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!botMode) return
    // 放到下一个任务里跑：effect 体内同步 setState 会触发级联渲染，
    // 而这个加载本身不依赖任何 DOM 测量结果，延后一帧没有副作用。
    const timer = setTimeout(() => { void refreshBots() }, 0)
    return () => clearTimeout(timer)
  }, [botMode, refreshBots])

  const openBotSession = useCallback(async (bot: BotSummary) => {
    try {
      // 不能直接拿 bot.sessionId 去开会话：空会话不落盘，那个 id 只保证「永远是同一个」。
      const sessionId = await ensureBotSessionOpen(bot.id)
      // bot 的会话在第一次发言前只有内存态、没有存储记录，所以跳过 metadata 预检；
      // 真正能不能打开由随后的 loadSession 决定。
      useUIStore.getState().requestOpenSession(sessionId, { skipMetadataPrecheck: true })
    } catch (error) {
      void showAlert(error instanceof Error ? error.message : t('sessionNotFound'))
    }
  }, [])

  const toggleBotMode = useCallback(async () => {
    const next = !useUIStore.getState().botMode
    setBotMode(next)
    if (!next) return
    // 刚切进 bot 模式时列表可能还没加载完（刷新放在 effect 里）。这里先等一次，
    // 否则 `bots` 还是空的，什么都打不开，主区会继续停在刚才那条普通会话上。
    const list = bots.length > 0 ? bots : await refreshBots()
    // 当前这条会话不属于任何 bot，就顺手打开第一个 bot，免得用户对着一堆
    // 普通对话发呆（bot 模式下主区不显示项目/分支，停在普通会话上会自相矛盾）。
    const belongsToBot = list.some((bot) => bot.sessionId && bot.sessionId === currentSessionId)
    const first = list.find((bot) => bot.sessionId)
    if (!belongsToBot && first) await openBotSession(first)
  }, [setBotMode, bots, refreshBots, openBotSession, currentSessionId])

  // 退出 bot 模式的反向补偿：进 bot 模式会自动打开一个 bot，退出时主区却可能还停在
  // 那个 bot 的会话上。继续显示它的历史对话不只是观感问题 —— 此时 chatCapabilities
  // 仍按 bot 项目判定，顶栏、吉祥物、消息落点都还挂在 bot 上，用户看到的是「人还在
  // bot 里」。所以落到新对话空态，由用户自己选要进哪条对话。
  // 放在 effect 里而不是 toggleBotMode 里：在那里读 currentSessionId
  // 会被 react-hooks/refs 判成「render 期间读 ref」。
  const previousBotModeRef = useRef(botMode)
  useEffect(() => {
    const wasBotMode = previousBotModeRef.current
    previousBotModeRef.current = botMode
    if (!wasBotMode || botMode || needsModelSetup) return
    // 和上面的 refreshBots 同理：effect 体内同步 setState 会触发级联渲染，
    // 而这里只是「换一条会话」，延后到下一个任务没有副作用。
    const timer = setTimeout(() => {
      const currentBotSessionId = currentSessionId
      if (bots.some((bot) => bot.sessionId === currentBotSessionId)) startNewDefaultSession()
    }, 0)
    return () => clearTimeout(timer)
  }, [botMode, needsModelSetup, bots, currentSessionId, startNewDefaultSession])

  const openNewBotDialog = useCallback(() => {
    setNewBotError(null)
    setNewBotOpen(true)
  }, [])

  const closeNewBotDialog = useCallback(() => {
    setNewBotOpen(false)
  }, [])

  const handleCreateBot = useCallback(async (name: string) => {
    setNewBotPending(true)
    setNewBotError(null)
    try {
      const bot = await createBotRequest(name)
      setBots((previous) => [...previous, bot])
      setNewBotOpen(false)
      setBotMode(true)
      void openBotSession(bot)
    } catch (error) {
      setNewBotError(error instanceof Error ? error.message : String(error))
    } finally {
      setNewBotPending(false)
    }
  }, [setBotMode, openBotSession])

  const handleBotChanged = useCallback((bot: BotSummary) => {
    setBotSettings(bot)
    setBots((previous) => previous.map((item) => (item.id === bot.id ? { ...item, ...bot } : item)))
  }, [])

  const handleDeleteBot = useCallback(async (botId: string) => {
    try {
      await deleteBotRequest(botId)
      const deleted = bots.find((bot) => bot.id === botId)
      setBots((previous) => previous.filter((bot) => bot.id !== botId))
      setBotSettings(null)
      // 服务端已销毁该 bot 的会话（destroyAgent）。如果主区正停在这条会话上，
      // 必须主动离开：SSE 订阅与消息落点都挂在 currentSessionId 上，不切走
      // 的话实时显示会继续渲染已死会话的残留事件。与退出 bot 模式的补偿
      // 逻辑同构——落到新对话空态。
      if (deleted?.sessionId && deleted.sessionId === currentSessionId) {
        startNewDefaultSession()
      }
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : String(error))
    }
  }, [bots, currentSessionId, startNewDefaultSession])

  // 催醒：立刻跑一跳（服务端跳过判活）。wake 请求本身很快返回（runPrompt 即回），
  // 真正的生成在后台跑；这里随后刷新一次列表，让状态小字尽快反映「在忙」。
  const handleWakeBot = useCallback(async (bot: BotSummary) => {
    try {
      await wakeBotRequest(bot.id)
      void refreshBots()
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : String(error))
    }
  }, [refreshBots])

  // 拖动排序：先把乐观顺序摆上去（松手立刻就是新顺序），服务端落盘后用返回值
  // 校准；失败就整表刷新回滚。与 useProject 的 reorderProjects 同一套路。
  const handleReorderBots = useCallback(async (orderedIds: string[]) => {
    setBots((previous) => {
      const byId = new Map(previous.map((bot) => [bot.id, bot]))
      const next: BotSummary[] = []
      for (const id of orderedIds) {
        const bot = byId.get(id)
        if (bot) {
          next.push(bot)
          byId.delete(id)
        }
      }
      return [...next, ...byId.values()]
    })
    try {
      const list = await reorderBots(orderedIds)
      if (list.length > 0) setBots(list)
    } catch (error) {
      logger.error('Failed to reorder bots:', error)
      void refreshBots()
    }
  }, [refreshBots])

  const botShell = useMemo(() => ({
    mode: botMode,
    bots,
    activeBotId: bots.find((bot) => bot.sessionId && bot.sessionId === currentSessionId)?.id,
    loading: botsLoading,
    error: botsError,
    onSelect: openBotSession,
    onOpenSettings: setBotSettings,
    onWake: handleWakeBot,
    onReorder: handleReorderBots,
    onToggleMode: toggleBotMode,
    onStartNew: openNewBotDialog,
  }), [
    botMode,
    bots,
    botsLoading,
    botsError,
    openBotSession,
    handleWakeBot,
    handleReorderBots,
    toggleBotMode,
    openNewBotDialog,
    currentSessionId,
  ])

  // bot 主区的吉祥物：用会话的细粒度状态驱动动作（思考 / 干活 / 等审批 / 出错 / 刚完成）。
  const activeBot = useMemo(
    () => bots.find((bot) => bot.id === botShell.activeBotId) ?? null,
    [bots, botShell.activeBotId],
  )
  const activeBotSessionId = agent?.sessionId ?? null
  // agent.state 的静态类型比运行时窄（审批/追问是可选字段，待执行工具是 Set），
  // 这里按运行时实际形状收窄一次，别在下面到处 as。
  const agentState = agent?.state as
    | {
        isStreaming?: boolean
        errorMessage?: string | null
        pendingToolCalls?: Set<string> | string[]
        pendingToolApproval?: unknown
        pendingAsk?: unknown
      }
    | undefined
  const pendingToolCalls = agentState?.pendingToolCalls
  const pendingToolCount = pendingToolCalls instanceof Set
    ? pendingToolCalls.size
    : (pendingToolCalls?.length ?? 0)
  const mascotState = useMascotState({
    error: agentState?.errorMessage ?? activeBot?.heartbeat?.lastError ?? null,
    waitingForUser: Boolean(agentState?.pendingToolApproval) || Boolean(agentState?.pendingAsk),
    toolRunning: pendingToolCount > 0,
    streaming: Boolean(agentState?.isStreaming),
    justCompleted: Boolean(activeBotSessionId && completedSessionIds.has(activeBotSessionId)),
    paused: activeBot?.heartbeat?.enabled === false,
  })
  // 只有「闲着」才偶尔溜达一下；有状态时吉祥物演状态，不走路。
  const mascotStrolling = useMascotStroll(botMode && mascotState === 'idle')
  // 「在输入框上方显示」由 bot 设置控制（默认开，见 server/bots.mjs 的 DEFAULT_MASCOT）。
  // 拿不到 activeBot 时保持显示 —— 和「拿不到就用默认外观」同一语义，免得加载竞态
  // 被误读成「坏了」；列表到了之后才按用户的选择真正隐藏。侧栏行首的小吉祥物不受它管。
  const composerMascotVisible = activeBot ? activeBot.mascot.showOnComposer !== false : true
  // 事件触发的小动作组（打招呼 / 伸懒腰 / 打哈欠 / 偷看打字 / 被夸），详见 use-mascot-actions。
  const [praiseCounter, setPraiseCounter] = useState(0)
  const mascotAction = useMascotActions(
    botMode && composerMascotVisible && (activeBot?.mascot.animated ?? true),
    mascotState,
    mascotStrolling,
    botShell.activeBotId,
    praiseCounter,
  )
  /** 主面板发送的消息带夸奖词时记一笔，bot 回答完成的那一小会儿演「被夸」。 */
  const handleComposerSend = useCallback((text: string) => {
    if (containsPraise(text)) setPraiseCounter((n) => n + 1)
  }, [])

  return {
    botMode,
    botShell,
    activeBot,
    mascotState,
    mascotStrolling,
    mascotAction,
    composerMascotVisible,
    handleComposerSend,
    newBotOpen,
    newBotPending,
    newBotError,
    closeNewBotDialog,
    handleCreateBot,
    botSettings,
    closeBotSettings: setBotSettings,
    handleBotChanged,
    handleDeleteBot,
  }
}
