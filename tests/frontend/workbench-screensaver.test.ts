import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('@/storage', () => ({
  getAppStorage: () => ({ settings: { get: async () => null, set: async () => {} } }),
}))

import { screensaverDue, WORKBENCH_SCREENSAVER_IDLE_MS } from '@/lib/workbench-screensaver-settings'

const hookSource = readFileSync(new URL('../../src/hooks/useWorkbenchScreensaver.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const tabSource = readFileSync(new URL('../../src/components/settings/tabs/DefaultOptionsSettingsTab.tsx', import.meta.url), 'utf8')
const storeSource = readFileSync(new URL('../../src/stores/ui-store.ts', import.meta.url), 'utf8')

describe('工作台屏保', () => {
  it('阈值 30 分钟；纯判定仅在启用、未开工作台且 idle 达标时触发', () => {
    expect(WORKBENCH_SCREENSAVER_IDLE_MS).toBe(30 * 60 * 1000)
    const now = 1_000_000_000
    expect(screensaverDue(now - WORKBENCH_SCREENSAVER_IDLE_MS, now, true, false)).toBe(true)
    expect(screensaverDue(now - WORKBENCH_SCREENSAVER_IDLE_MS + 1, now, true, false)).toBe(false)
    expect(screensaverDue(now - WORKBENCH_SCREENSAVER_IDLE_MS, now, false, false)).toBe(false)
    expect(screensaverDue(now - WORKBENCH_SCREENSAVER_IDLE_MS, now, true, true)).toBe(false)
  })

  it('hook 监听用户活动、屏保期间任意操作退出、idle 判定接入定时器', () => {
    expect(hookSource).toContain("'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'")
    expect(hookSource).toContain('screensaverDue(lastActivityRef.current, Date.now()')
    expect(hookSource).toContain('setWorkbenchOpen(false)')
    expect(hookSource).toContain('setWorkbenchOpen(true)')
  })

  it('App 挂载 hook；设置页有开关；ui-store 有持久化字段与 setter', () => {
    expect(appSource).toContain('useWorkbenchScreensaver()')
    expect(tabSource).toContain('workbenchScreensaverTitle')
    expect(tabSource).toContain('saveWorkbenchScreensaver')
    expect(storeSource).toContain('workbenchScreensaver: boolean')
    expect(storeSource).toContain('setWorkbenchScreensaver')
  })
})