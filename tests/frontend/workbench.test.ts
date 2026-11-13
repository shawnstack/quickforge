import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// 工作台文本契约（与 bot-mascot.test.ts 同一套路：读源码断言关键结构）

const componentSource = readFileSync(
  new URL('../../src/components/workbench/Workbench.tsx', import.meta.url),
  'utf8',
)
const cssSource = readFileSync(
  new URL('../../src/components/workbench/workbench.css', import.meta.url),
  'utf8',
)
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const headerSource = readFileSync(new URL('../../src/components/app/ConversationHeader.tsx', import.meta.url), 'utf8')
const headerNavSource = readFileSync(new URL('../../src/components/sidebar/chat-sidebar/SidebarHeaderNav.tsx', import.meta.url), 'utf8')

describe('工作台（v8 塔台出港屏）', () => {
  it('出港队列合并 bot 心跳与定时任务的真实 nextRunAt，按时间排序', () => {
    expect(componentSource).toContain('fetchBots()')
    expect(componentSource).toContain('fetchScheduledTasks()')
    expect(componentSource).toContain('bot.heartbeat?.enabled && bot.heartbeat.nextRunAt')
    expect(componentSource).toContain('return list.sort((a, b) => a.at - b.at)')
  })

  it('诚实边界：暂停/完成的任务不出港；进港与到点未醒只来自会话内观察', () => {
    expect(componentSource).toContain("task.status === 'paused' || task.status === 'completed'")
    expect(componentSource).toContain('const MISSED_GRACE_MS = 90_000')
    expect(componentSource).toContain('if (prev?.busy && !busy) {')
    expect(componentSource).toContain('const ARRIVAL_CAP = 8')
  })

  it('状态章在跑优先于历史错误（催醒后立刻有反馈），舰队复用 botStatusSummary', () => {
    expect(componentSource).toContain('if (isBusy(bot)) return { text: t(\'wbRunning\'), tone: \'ok\' }')
    expect(componentSource).toContain('const summary = botStatusSummary(bot)')
    expect(componentSource).toContain('botStatusSummary(bot, now)')
  })

  it('进入对话走既有桥：ensureBotSessionOpen + requestOpenSession（skipMetadataPrecheck）', () => {
    expect(componentSource).toContain('ensureBotSessionOpen(bot.id)')
    expect(componentSource).toContain('requestOpenSession(sessionId, { skipMetadataPrecheck: true })')
  })

  it('抽屉控制全部落真端点：patchBot / wakeBot / feedBot / fetchBotMemory / goal 按需', () => {
    expect(componentSource).toContain('patchBot(bot.id, { heartbeat })')
    expect(componentSource).toContain('wakeBot(botId)')
    expect(componentSource).toContain('feedBot(bot.id, text)')
    expect(componentSource).toContain('fetchBotMemory(target.id)')
    expect(componentSource).toContain('/api/agents/${encodeURIComponent(sessionId)}/status')
  })

  it('NOTAM：error 来自 lastError 快照，warn 来自到点未醒；成功自动解除、可忽略', () => {
    expect(componentSource).toContain('const err = bot.heartbeat?.lastError')
    expect(componentSource).toContain("list.push({ key: item.key, kind: 'warn'")
    expect(componentSource).toContain('if (isBusy(bot) || (Number.isFinite(woke) && woke >= item.due - 60_000)) continue')
    expect(componentSource).toContain('return list.filter((item) => !dismissed[item.key])')
  })

  it('Esc 先关抽屉再关工作台；portal 到 body（对外签名与 v6 一致）', () => {
    expect(componentSource).toContain('if (drawer) setDrawer(null)')
    expect(componentSource).toContain('createPortal')
    expect(componentSource).toContain('export function WorkbenchPortal({ open, onClose }: { open: boolean; onClose: () => void })')
  })

  it('CSS：仪器恒暗常量 + 房间吃全局 token + 自绘滚动条', () => {
    expect(cssSource).toContain('--qf-wb-bd-bg: #101318;')
    expect(cssSource).toContain('background: var(--background);')
    expect(cssSource).toContain('background: var(--popover);')
    expect(cssSource).toContain('.qf-wb ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }')
  })

  it('CSS：减弱动效全关；窄屏抽屉满宽不越界、通告文本换行独占一行', () => {
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(cssSource).toContain('animation: none !important;')
    expect(cssSource).toContain('.qf-wb__drawer { left: 0; right: 0; width: auto; max-width: none; }')
    expect(cssSource).toContain('.qf-wb__notam-text { order: 5; flex: 1 1 100%; white-space: normal; overflow: visible; }')
  })

  it('CSS：窄屏班次名可换行不被 NEXT 挤成竖排，列宽重分配', () => {
    expect(cssSource).toContain('flex-wrap: wrap; font-size: 13px;')
    expect(cssSource).toContain('grid-template-columns: 62px 78px minmax(0, 1fr) 58px; gap: 6px;')
  })

  it('倒计时不带 T 前缀：未来纯 HH:MM:SS、过点 +HH:MM:SS', () => {
    expect(componentSource).not.toContain('T−')
    expect(componentSource).toContain(': fmtSpan(flight.at - now)')
    expect(componentSource).toContain('`+${fmtSpan(now - flight.at)}`')
  })

  it('入口不单独占 icon：顶栏无 TowerControl，左上角 QuickForge logo 点击开工作台', () => {
    expect(headerSource).not.toContain('TowerControl')
    expect(headerSource).toContain('<WorkbenchPortal open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />')
    expect(headerSource).toContain('useUIStore((s) => s.workbenchOpen)')
    expect(headerNavSource).toContain('onClick={() => setWorkbenchOpen(true)}')
    expect(headerNavSource).toContain('src="/favicon.svg"')
    expect(headerNavSource).toContain("aria-label={t('workbenchTitle')}")
  })

  it('普通会话在跑进「在跑」与进港：轮询 /api/agents，排除 bot/任务会话', () => {
    expect(componentSource).toContain("fetch('/api/agents')")
    expect(componentSource).toContain("s.status === 'running' && !botSessionIds.has(s.sessionId) && !taskSessionIds.has(s.sessionId)")
    expect(componentSource).toContain("kind: 'session'")
    expect(componentSource).toContain('runningSessions.map((session) =>')
    expect(componentSource).toContain('list.filter(isBusy).length + runningSessions.length')
  })

  it('i18n：v8 键 en/zh 双份齐全，舞台专用键已删除', () => {
    for (const key of ['wbDepartures', 'wbArrivals', 'wbFleet', 'wbNotamMissed', 'wbAlwaysWake', 'wbToastFed']) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))?.length).toBe(2)
    }
    for (const key of ['workbenchPhases', 'workbenchPhaseDawn', 'workbench24hAgo', 'workbenchEnterHint']) {
      expect(i18nSource).not.toContain(`${key}:`)
    }
  })
})