import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
const mocks = vi.hoisted(() => ({ compact: vi.fn(), goal: vi.fn() }))
vi.mock('@/storage', () => ({ getAppStorage: () => ({}) }))
vi.mock('@/lib/tool-display-settings', () => ({ loadToolDisplaySettings: async () => ({ toolDisplayMode: 'compact', showContextUsage: false }), saveToolDisplaySettings: vi.fn() }))
vi.mock('@/lib/auto-compact-settings', () => ({ loadAutoCompactSettings: async () => ({ enabled: true, requireConfirmation: true, thresholdPercent: 80, keepRecentTurns: 0 }), saveAutoCompactSettings: mocks.compact }))
vi.mock('@/lib/goal-settings', () => ({ loadGoalSettings: async () => ({ maxIterations: 20 }), saveGoalSettings: mocks.goal }))
vi.mock('@/lib/auto-archive-settings', () => ({ loadAutoArchiveSettings: async () => ({ enabled: false }), saveAutoArchiveSettings: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ applyAppLanguage: vi.fn(), getAppLanguage: () => 'zh', t: (key: string) => key }))
vi.mock('@/lib/system-notifications', () => ({ getSystemNotificationPermission: async () => 'denied', isSystemNotificationsEnabled: () => false, requestSystemNotificationPermission: vi.fn(), setSystemNotificationsEnabled: vi.fn(), showTaskSystemNotification: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/settings/tabs/shared', () => ({ SettingsSelect: () => null, SettingsSwitch: () => null }))
import { DefaultOptionsSettingsTab } from '../../src/components/settings/tabs/DefaultOptionsSettingsTab'

function render() { harness.begin(); return nodes(DefaultOptionsSettingsTab()) }
function numberInput(label: string) { return render().find((node) => node.props['aria-label'] === label)! }
async function mount() { render(); harness.effects.forEach((effect) => effect()); await vi.waitFor(() => expect(numberInput('autoCompactThresholdPercent')).toBeDefined()) }
beforeEach(() => {
  harness.reset(); vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('React default settings tab', () => {
  // 设置页不再提供「默认模型 / 默认思考等级」两项：新会话直接沿用最近一次选择。
  it('no longer renders model or thinking-level default rows', async () => {
    await mount()
    const labels = render().map((node) => node.props.label).filter(Boolean)
    expect(labels).not.toContain('defaultModel')
    expect(labels).not.toContain('defaultThinkingLevel')
  })

  // 「工具调用列表默认展开」已固化为渲染常量（PROCESS_STAGE_DEFAULT_EXPANDED），不再可配置。
  it('no longer renders the expand-process-stage-default row', async () => {
    await mount()
    const all = render()
    expect(all.some((node) => text(node).includes('expandProcessStageByDefault'))).toBe(false)
  })
})
describe('React default numeric settings', () => {
  it.each([['autoCompactThresholdPercent', '99', '95', 'thresholdPercent', 95], ['autoCompactKeepRecentTurns', '23.5', '20', 'keepRecentTurns', 20]] as const)('normalizes %s only on commit and preserves siblings', async (label, draft, display, key, expected) => {
    await mount(); numberInput(label).props.onInput(draft)
    expect(mocks.compact).not.toHaveBeenCalled()
    numberInput(label).props.onCommit(draft)
    expect(String(numberInput(label).props.value)).toBe(display)
    expect(mocks.compact).toHaveBeenCalledWith({}, expect.objectContaining({ enabled: true, requireConfirmation: true, [key]: expected }))
  })
  it('clamps goal iteration commits and normalizes the displayed draft', async () => {
    await mount(); numberInput('goalMaxIterations').props.onInput('0')
    expect(mocks.goal).not.toHaveBeenCalled()
    numberInput('goalMaxIterations').props.onCommit('0')
    expect(numberInput('goalMaxIterations').props.value).toBe('1')
    expect(mocks.goal).toHaveBeenCalledWith({}, { maxIterations: 1 })
  })
})
