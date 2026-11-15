import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/storage', () => ({
  getAppStorage: () => ({ settings: { get: async () => null, set: async () => {} } }),
}))

import {
  DEFAULT_WORKBENCH_SCREENSAVER,
  SCREENSAVER_IDLE_RANGE,
  normalizeWorkbenchScreensaver,
  randomizeScreensaverAppearance,
  screensaverDue,
  screensaverIdleMs,
} from '@/lib/workbench-screensaver-settings'

const hookSource = readFileSync(new URL('../../src/hooks/useWorkbenchScreensaver.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const tabSource = readFileSync(new URL('../../src/components/settings/tabs/DefaultOptionsSettingsTab.tsx', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../../src/components/settings/tabs/WorkbenchScreensaverSettings.tsx', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../../src/stores/ui-store.ts', import.meta.url), 'utf8')
const towerSource = readFileSync(new URL('../../src/components/workbench/Workbench.tsx', import.meta.url), 'utf8')
const screensaverSource = readFileSync(new URL('../../src/components/workbench/WorkbenchScreensaver.tsx', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/components/workbench/workbench-screensaver.css', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

describe('工作台屏保：idle 阈值', () => {
  it('默认 10 分钟，纯判定只在启用、未开工作台且 idle 达标时触发', () => {
    expect(DEFAULT_WORKBENCH_SCREENSAVER.idleMinutes).toBe(10)
    expect(DEFAULT_WORKBENCH_SCREENSAVER.enabled).toBe(true)
    const idle = screensaverIdleMs(10)
    expect(idle).toBe(10 * 60 * 1000)
    const now = 1_000_000_000
    expect(screensaverDue(now - idle, now, true, false, 10)).toBe(true)
    expect(screensaverDue(now - idle + 1, now, true, false, 10)).toBe(false)
    expect(screensaverDue(now - idle, now, false, false, 10)).toBe(false)
    expect(screensaverDue(now - idle, now, true, true, 10)).toBe(false)
  })

  it('阈值跟着配置走，越界值被夹回量程而不是变成 0 或 Infinity', () => {
    const now = 5_000_000
    expect(screensaverDue(now - 60_000, now, true, false, 1)).toBe(true)
    expect(screensaverDue(now - 60_000, now, true, false, 2)).toBe(false)
    expect(screensaverIdleMs(0)).toBe(SCREENSAVER_IDLE_RANGE.min * 60_000)
    expect(screensaverIdleMs(9999)).toBe(SCREENSAVER_IDLE_RANGE.max * 60_000)
    expect(screensaverIdleMs(Number.NaN)).toBe(DEFAULT_WORKBENCH_SCREENSAVER.idleMinutes * 60_000)
  })

  it('normalize 兼容旧 boolean 值，并逐项夹紧与回退', () => {
    expect(normalizeWorkbenchScreensaver(true)).toEqual({ ...DEFAULT_WORKBENCH_SCREENSAVER, enabled: true })
    expect(normalizeWorkbenchScreensaver(false).enabled).toBe(false)
    expect(normalizeWorkbenchScreensaver(null)).toEqual(DEFAULT_WORKBENCH_SCREENSAVER)
    const normalized = normalizeWorkbenchScreensaver({
      enabled: false,
      idleMinutes: 900,
      accent: 'javascript:alert(1)',
      motion: -20,
      glow: 300,
      density: 'x',
      clockScale: 12,
      drift: 'yes',
      showToday: false,
    })
    expect(normalized).toEqual({
      ...DEFAULT_WORKBENCH_SCREENSAVER,
      enabled: false,
      idleMinutes: SCREENSAVER_IDLE_RANGE.max,
      motion: 0,
      glow: 100,
      clockScale: 70,
      showToday: false,
    })
    expect(normalizeWorkbenchScreensaver({ accent: '#6CB6FF' }).accent).toBe('#6cb6ff')
  })

  it('随机只动外观：开关与 idle 时长不被骰子改掉', () => {
    const base = normalizeWorkbenchScreensaver({ enabled: false, idleMinutes: 42, showRunning: false })
    for (let i = 0; i < 12; i++) {
      const next = randomizeScreensaverAppearance(base)
      expect(next.enabled).toBe(false)
      expect(next.idleMinutes).toBe(42)
      expect(next.showRunning).toBe(false)
      expect(next.accent).not.toBe(base.accent)
      expect(next.motion).toBeGreaterThanOrEqual(0)
      expect(next.motion).toBeLessThanOrEqual(100)
    }
  })
})

describe('工作台屏保：触发与退出', () => {
  it('hook 监听用户输入活动，但不把自动滚动的 scroll 当成有人操作', () => {
    expect(hookSource).toContain("'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'")
    expect(hookSource).not.toContain("'scroll'")
    expect(hookSource).toContain('screensaverDue(lastActivityRef.current, Date.now()')
    expect(hookSource).toContain('settings.idleMinutes')
  })

  it('到点进 idle 屏保、任意操作退出；预览只被点击/按键/滚轮关掉', () => {
    expect(hookSource).toContain("enterWorkbenchScreensaver('idle')")
    expect(hookSource).toContain("if (current === 'idle') {")
    expect(hookSource).toContain('setWorkbenchOpen(false)')
    expect(hookSource).toContain("const PREVIEW_EXIT_EVENTS = new Set<string>(['pointerdown', 'keydown', 'wheel', 'touchstart'])")
    expect(hookSource).toContain("current === 'preview' && PREVIEW_EXIT_EVENTS.has(event.type)")
    expect(hookSource).toContain("if (!enabled && useUIStore.getState().workbenchScreensaverMode === 'idle') setWorkbenchOpen(false)")
  })

  it('App 挂载 hook；store 持配置对象与呈现形态，关闭即归 off', () => {
    expect(appSource).toContain('useWorkbenchScreensaver()')
    expect(storeSource).toContain('workbenchScreensaver: WorkbenchScreensaverSettings')
    expect(storeSource).toContain("workbenchScreensaverMode: 'off'")
    expect(storeSource).toContain("enterWorkbenchScreensaver: (mode) => set({ workbenchOpen: true, workbenchScreensaverMode: mode })")
    expect(storeSource).toContain("workbenchScreensaverMode: open ? s.workbenchScreensaverMode : 'off'")
  })

  it('屏保复用工作台已加载的实时数据，自己不发请求', () => {
    expect(towerSource).toContain("if (screensaverMode !== 'off') {")
    expect(towerSource).toContain('<WorkbenchScreensaver settings={screensaverSettings} data={screensaverData} mode={screensaverMode} onExit={onClose} />')
    expect(towerSource).toContain('schedule: allFlights.slice(0, 3)')
    expect(screensaverSource).not.toContain('fetch(')
  })
})

describe('工作台屏保：设置控制区', () => {
  it('默认选项页挂载屏保分组，控制区常驻不折叠', () => {
    expect(tabSource).toContain('<WorkbenchScreensaverSettings active={active} onError={setError} />')
    expect(settingsSource).toContain('quickforge-screensaver-layout')
    expect(settingsSource).not.toContain('details')
    expect(settingsSource).toContain('<WorkbenchScreensaver settings={settings} data={sampleData(now)} mode="preview" embedded />')
  })

  it('至少七项实时参数 + 随机/恢复默认/全屏预览，全部走同一 update 落库', () => {
    for (const key of ['enabled', 'idleMinutes', 'accent', 'motion', 'glow', 'density', 'clockScale', 'drift', 'showSchedule']) {
      expect(settingsSource).toContain(key)
    }
    expect(settingsSource).toContain('randomizeScreensaverAppearance(pendingRef.current)')
    expect(settingsSource).toContain('{ ...DEFAULT_WORKBENCH_SCREENSAVER, enabled: settings.enabled }')
    expect(settingsSource).toContain("enterScreensaver('preview')")
    expect(settingsSource).toContain('saveWorkbenchScreensaverSettings(pendingRef.current)')
    expect(settingsSource).toContain('window.clearTimeout(timerRef.current)')
  })

  it('预览标明示例数据，全屏预览才用真实数据', () => {
    expect(settingsSource).toContain("t('workbenchScreensaverSample')")
    expect(i18nSource).toContain('示例数据 · 全屏预览用真实数据')
  })
})

describe('工作台屏保：视觉与文案契约', () => {
  it('尺寸走容器查询，全屏与缩略预览共用一份样式', () => {
    expect(cssSource).toContain('container-type: size;')
    expect(cssSource).toContain('container-name: ss;')
    expect(cssSource).toContain('@container ss (max-width: 620px)')
    expect(cssSource).toContain('@container ss (max-height: 260px)')
    expect(cssSource).toContain('.qf-ss--embed')
  })

  it('漂移可关、减弱动效全关、滚动条自绘、焦点可见', () => {
    expect(cssSource).toContain('.qf-ss.is-static .qf-ss__drift')
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(cssSource).toContain('animation: none !important;')
    expect(cssSource).toContain('.qf-ss__card-list::-webkit-scrollbar-thumb')
    expect(cssSource).toContain('.qf-ss :focus-visible')
    expect(screensaverSource).toContain("(!settings.drift || reducedMotion) && 'is-static'")
  })

  it('倒计时不带 T 前缀：未来纯 HH:MM:SS、过点 +HH:MM:SS 变红', () => {
    expect(screensaverSource).not.toContain('T−')
    expect(screensaverSource).toContain('fmtSpan(next.at - data.now)')
    expect(screensaverSource).toContain('`+${fmtSpan(data.now - next.at)}`')
    expect(cssSource).toContain('.qf-ss__card-value.is-overdue { color: var(--qf-ss-err); }')
  })

  it('canvas 氛围场单循环、可销毁，拿不到 context 时退化不白屏', () => {
    const fieldSource = readFileSync(new URL('../../src/components/workbench/screensaver-field.ts', import.meta.url), 'utf8')
    expect(fieldSource).toContain('if (!ctx) return { update: () => {}, destroy: () => {} }')
    expect(fieldSource).toContain('const MAX_DPR = 1.75')
    expect(fieldSource).toContain("document.addEventListener('visibilitychange', onVisibility)")
    expect(fieldSource).toContain("document.removeEventListener('visibilitychange', onVisibility)")
    expect(fieldSource).toContain('observer?.disconnect()')
    expect(fieldSource).toContain('if (destroyed || raf) return')
    expect(screensaverSource).toContain('return () => { field.destroy(); fieldRef.current = null }')
  })

  it('i18n：屏保新键 en/zh 双份齐全，时长文案参数化不再写死 30', () => {
    const keys = [
      'workbenchScreensaverEnable', 'workbenchScreensaverIdle', 'workbenchScreensaverAccent',
      'workbenchScreensaverMotion', 'workbenchScreensaverGlow', 'workbenchScreensaverDensity',
      'workbenchScreensaverClock', 'workbenchScreensaverDrift', 'workbenchScreensaverPanels',
      'workbenchScreensaverFullPreview', 'workbenchScreensaverRandom', 'workbenchScreensaverReset',
      'ssBadge', 'ssNextUp', 'ssNoSchedule', 'ssExitHint', 'ssPreviewExitHint', 'ssExitPreview', 'ssErrors',
    ]
    for (const key of keys) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))?.length).toBe(2)
    }
    expect(i18nSource).toContain('无操作 {minutes} 分钟后工作台接管全屏')
    expect(i18nSource).not.toContain('无操作 30 分钟')
  })
})