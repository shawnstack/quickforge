import { describe, expect, it } from 'vitest'
import type { BotSummary } from '../../src/components/bots/bots-data'
import { botStatusSummary, formatBotAwakeAgo } from '../../src/components/bots/bots-data'
import { appTranslations } from '../../src/lib/i18n'

/**
 * 侧栏每行右侧那行状态小字。
 *
 * 它替代的是「靠 18px 吉祥物动画表达状态」——那个尺寸上看不出眼睛的动作，用户的原话是
 * 「bot 的状态好像没怎么变化」。状态改成文字之后，要守住的是**优先级**：
 * 出错不能被人「多久没醒」盖掉，在忙不能被「睡了」盖掉。
 */
function makeBot(
  patch: Partial<Omit<BotSummary, 'heartbeat'>> & { heartbeat?: Partial<BotSummary['heartbeat']> } = {},
): BotSummary {
  const base: BotSummary = {
    id: 'bot-1',
    name: '小助手',
    workspacePath: '/tmp/bots/bot-e7e445bf',
    memoryFile: '/tmp/bots/bot-e7e445bf/MEMORY.md',
    projectId: null,
    sessionId: null,
    thinkingLevel: 'medium',
    accessMode: 'default',
    heartbeat: {
      enabled: true,
      intervalMinutes: 30,
      nextRunAt: null,
      lastWakeAt: null,
      lastSessionId: null,
      lastIdleReason: null,
      lastError: null,
    },
    mascot: { body: 'ink', eye: 'dot', animated: true },
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
  }
  return {
    ...base,
    ...patch,
    heartbeat: { ...base.heartbeat, ...(patch.heartbeat ?? {}) },
  }
}

/** 文案按当前语言取，测试环境两种语言都校验，避免绑死某一种。 */
function matchesCopy(text: string, key: keyof typeof appTranslations.en, params: Record<string, number> = {}) {
  return [appTranslations.en[key], appTranslations.zh[key]].some((template) => {
    let filled: string = template
    for (const [name, value] of Object.entries(params)) {
      filled = filled.replaceAll(`{${name}}`, String(value))
    }
    return filled === text
  })
}

const NOW = Date.parse('2026-11-11T12:00:00.000Z')

describe('formatBotAwakeAgo', () => {
  it('一分钟以内算「刚刚」', () => {
    expect(matchesCopy(formatBotAwakeAgo(0), 'botStatusJustNow')).toBe(true)
    expect(matchesCopy(formatBotAwakeAgo(59_000), 'botStatusJustNow')).toBe(true)
  })

  it('分钟 / 小时 / 天各自取整', () => {
    expect(matchesCopy(formatBotAwakeAgo(5 * 60_000), 'botStatusMinutesAgo', { n: 5 })).toBe(true)
    expect(matchesCopy(formatBotAwakeAgo(50 * 60_000), 'botStatusMinutesAgo', { n: 50 })).toBe(true)
    expect(matchesCopy(formatBotAwakeAgo(3 * 3_600_000), 'botStatusHoursAgo', { n: 3 })).toBe(true)
    expect(matchesCopy(formatBotAwakeAgo(2 * 86_400_000), 'botStatusDaysAgo', { n: 2 })).toBe(true)
  })

  it('49 分钟不会被四舍五入成 0 分钟', () => {
    expect(matchesCopy(formatBotAwakeAgo(49 * 60_000), 'botStatusMinutesAgo', { n: 49 })).toBe(true)
  })
})

describe('botStatusSummary', () => {
  it('没事的时候显示上次醒来的时间', () => {
    const bot = makeBot({ heartbeat: { lastWakeAt: '2026-11-11T10:00:00.000Z' } })
    const status = botStatusSummary(bot, NOW)
    expect(status.tone).toBe('idle')
    expect(matchesCopy(status.text, 'botStatusHoursAgo', { n: 2 })).toBe(true)
  })

  it('从没醒过就说从没醒过，而不是编一个时间', () => {
    const status = botStatusSummary(makeBot(), NOW)
    expect(matchesCopy(status.text, 'botStatusNever')).toBe(true)
    expect(status.tone).toBe('idle')
  })

  it('心跳关掉 → 睡了', () => {
    const bot = makeBot({ heartbeat: { enabled: false, lastWakeAt: '2026-11-11T10:00:00.000Z' } })
    const status = botStatusSummary(bot, NOW)
    expect(matchesCopy(status.text, 'botStatusAsleep')).toBe(true)
    expect(status.tone).toBe('asleep')
  })

  it('在忙 → 干活中，压过「睡了」以外的一切时间信息', () => {
    const busy = botStatusSummary(makeBot({ busy: true }), NOW)
    expect(matchesCopy(busy.text, 'botStatusBusy')).toBe(true)
    expect(busy.tone).toBe('busy')

    const running = botStatusSummary(makeBot({ status: 'running' }), NOW)
    expect(matchesCopy(running.text, 'botStatusBusy')).toBe(true)
  })

  it('出错压过在忙和睡着', () => {
    const bot = makeBot({
      busy: true,
      heartbeat: { enabled: false, lastError: 'model overloaded' },
    })
    const status = botStatusSummary(bot, NOW)
    expect(matchesCopy(status.text, 'botStatusError')).toBe(true)
    expect(status.tone).toBe('error')
  })
})

describe('文案键', () => {
  it('两种语言都齐', () => {
    const keys = [
      'botStatusBusy',
      'botStatusError',
      'botStatusAsleep',
      'botStatusNever',
      'botStatusJustNow',
      'botStatusMinutesAgo',
      'botStatusHoursAgo',
      'botStatusDaysAgo',
    ] as const
    for (const key of keys) {
      expect(appTranslations.en[key]).toBeTruthy()
      expect(appTranslations.zh[key]).toBeTruthy()
      expect(appTranslations.zh[key]).not.toBe(appTranslations.en[key])
    }
  })
})
