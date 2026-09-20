import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { harness, nodes } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
const mocks = vi.hoisted(() => ({ load: vi.fn(), catalog: vi.fn(), save: vi.fn(), compact: vi.fn(), goal: vi.fn() }))
vi.mock('@/storage', () => ({ getAppStorage: () => ({}) }))
vi.mock('@/lib/pi-chat', () => ({ defaultThinkingLevelForModel: () => 'off', getSelectableConfiguredModels: async () => [], loadDefaultOptions: mocks.load, mergeAvailableModels: (models: unknown[]) => models, saveDefaultOptions: mocks.save }))
vi.mock('@/lib/model-reference', () => ({ loadModelCatalog: mocks.catalog }))
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

const baseModel = { id: 'base', name: 'Base', provider: 'custom', api: 'openai-completions', baseUrl: 'https://base.example/v1' } as Model<Api>
const secondModel = { ...baseModel, id: 'second', name: 'Second' }
function modelKey(model: Model<Api>) { return JSON.stringify([model.provider, model.id, model.api, (model.baseUrl ?? '').trim().replace(/\/$/, '')]) }
function render() { harness.begin(); return nodes(DefaultOptionsSettingsTab()) }
function modelSelect() { return render().find((node) => node.props.label === 'defaultModel')! }
function numberInput(label: string) { return render().find((node) => node.props['aria-label'] === label)! }
async function mount() { render(); harness.effects.forEach((effect) => effect()); await vi.waitFor(() => expect(modelSelect()).toBeDefined()) }
beforeEach(() => {
  harness.reset(); vi.clearAllMocks()
  mocks.load.mockResolvedValue({}); mocks.catalog.mockResolvedValue([baseModel, secondModel])
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('React default settings model catalog', () => {
  it('auto-selects the saved default', async () => {
    mocks.load.mockResolvedValue({ model: secondModel }); await mount()
    expect(modelSelect().props.options.map((option: { value: string }) => option.value)).toEqual([modelKey(baseModel), modelKey(secondModel)])
    expect(modelSelect().props.value).toBe(modelKey(secondModel))
  })
  it('falls back when the saved default is missing', async () => {
    mocks.load.mockResolvedValue({ model: { ...baseModel, id: 'removed' } }); await mount()
    expect(modelSelect().props.value).toBe(modelKey(baseModel))
  })
  it('immediately displays and persists a manual selection', async () => {
    await mount(); modelSelect().props.onChange(modelKey(secondModel))
    expect(modelSelect().props.value).toBe(modelKey(secondModel))
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledWith({}, expect.objectContaining({ model: secondModel })))
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
