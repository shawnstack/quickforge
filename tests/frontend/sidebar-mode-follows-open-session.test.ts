import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isBotSession, syncSidebarModeToSession } from '../../src/lib/session-sidebar-mode'
import { useUIStore } from '../../src/stores/ui-store'

/**
 * 侧栏模式跟随当前会话（双向）。
 *
 * 场景：从工作台 / 设置页 / 系统通知点一个会话，这些入口只发 `requestOpenSession`
 * 请求，不经过侧栏的模式切换按钮；不联动 `botMode` 就会出现「右侧是 bot 对话、
 * 左侧还是普通会话列表」。
 *
 * 这里覆盖三件事：① 判定（bot 列表命中 / `bot-` 前缀兜底 / 非 bot 前缀不误判）；
 * ② 联动本身对真实 ui-store 的写入结果；③ App 的消费 effect 确实按这个顺序接线。
 */

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

describe('isBotSession 判定', () => {
  it('bots 列表里有人的 sessionId 就是它 → bot 会话（数据真相优先于 id 形状）', () => {
    expect(isBotSession('bot-1-abcdef12', [])).toBe(true)
    // 将来服务端改了 id 规则，列表命中依然成立。
    expect(isBotSession('legacy-bot-session', [{ sessionId: 'legacy-bot-session' }])).toBe(true)
  })

  it('列表还没加载完 / 这条 bot 的 sessionId 是 null 时，靠 bot- 前缀兜底', () => {
    expect(isBotSession('bot-1-abcdef12', [])).toBe(true)
    expect(isBotSession('bot-1-abcdef12', [{ sessionId: null }, { sessionId: 'bot-2-99999999' }])).toBe(true)
  })

  it('普通会话（UUID 一类）不误判', () => {
    const uuid = '4f3e6f1a-2b7c-4d5e-8f90-112233445566'
    expect(isBotSession(uuid, [])).toBe(false)
    expect(isBotSession(uuid, [{ sessionId: 'bot-1-abcdef12' }])).toBe(false)
    // 只是「以 bot 开头」不算：必须带约定里的连字符。
    expect(isBotSession('botanical-garden', [])).toBe(false)
    expect(isBotSession('bot', [])).toBe(false)
    expect(isBotSession('bottom-up-notes', [])).toBe(false)
    expect(isBotSession('', [])).toBe(false)
  })
})

describe('syncSidebarModeToSession 联动真实 ui-store', () => {
  beforeEach(() => {
    useUIStore.setState({ botMode: false })
  })

  it('打开 bot 会话 → botMode 变 true（侧栏切到 bot 列表）', () => {
    const changed = syncSidebarModeToSession('bot-1-abcdef12', [], useUIStore)

    expect(changed).toBe(true)
    expect(useUIStore.getState().botMode).toBe(true)
  })

  it('打开普通会话且当前在 bot 模式 → botMode 变 false（侧栏切回普通列表）', () => {
    useUIStore.setState({ botMode: true })

    const changed = syncSidebarModeToSession('4f3e6f1a-2b7c-4d5e-8f90-112233445566', [], useUIStore)

    expect(changed).toBe(true)
    expect(useUIStore.getState().botMode).toBe(false)
  })

  it('非 bot 前缀的会话名不会把人误送进 bot 模式', () => {
    useUIStore.setState({ botMode: false })

    expect(syncSidebarModeToSession('bottom-up-notes', [], useUIStore)).toBe(false)
    expect(useUIStore.getState().botMode).toBe(false)
  })

  it('已经处在目标模式时不重复写 store', () => {
    useUIStore.setState({ botMode: true })
    const calls: boolean[] = []
    const fakeStore = {
      getState: () => ({ botMode: true, setBotMode: (value: boolean) => { calls.push(value) } }),
    }

    expect(syncSidebarModeToSession('bot-1-abcdef12', [], fakeStore)).toBe(false)
    expect(calls).toEqual([])
  })
})

describe('App 的 openSessionRequest 消费 effect', () => {
  const effectSource = (() => {
    const start = appSource.indexOf('const request = openSessionRequest')
    expect(start).toBeGreaterThan(-1)
    return appSource.slice(start, appSource.indexOf('}, [openSessionRequest', start))
  })()

  it('先打开会话，再按会话判定侧栏模式，最后清掉请求', () => {
    const openAt = effectSource.indexOf('handleOpenSessionFromSettings(request.sessionId')
    const syncAt = effectSource.indexOf('syncSidebarModeToSession(request.sessionId, botShell.bots, useUIStore)')
    const clearAt = effectSource.indexOf('clearOpenSessionRequest()')

    expect(openAt).toBeGreaterThan(-1)
    expect(syncAt).toBeGreaterThan(openAt)
    expect(clearAt).toBeGreaterThan(syncAt)
  })

  it('判定用的是 App 已有的 bots 数据源，不新增全局请求', () => {
    // botShell.bots 来自 useBotWorkspace（列表命中）＋ id 前缀兜底，都在 App 内部完成。
    expect(effectSource).toContain('botShell.bots')
    expect(appSource).toContain('}, [openSessionRequest, handleOpenSessionFromSettings, botShell.bots])')
  })
})
