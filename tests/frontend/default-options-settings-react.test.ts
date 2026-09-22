import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { SystemNotificationPermission } from '../../src/lib/system-notifications'

// Exercise the new tab's rendered callbacks and real persistence without a DOM dependency.
const harness = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0, effects: [] as (() => void)[] }))
const notifications = vi.hoisted(() => ({
  permission: vi.fn<() => Promise<SystemNotificationPermission>>(),
  request: vi.fn<() => Promise<SystemNotificationPermission>>(),
  show: vi.fn(async () => true),
}))
const settings = vi.hoisted(() => ({ saveToolDisplay: vi.fn(), saveAutoCompact: vi.fn() }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void) => { harness.effects.push(effect) },
  useRef: (initial: unknown) => {
    const index = harness.refCursor++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value }]
  },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@/storage', () => ({ getAppStorage: () => ({}) }))
vi.mock('@/lib/pi-chat', () => ({
  defaultThinkingLevelForModel: () => 'off',
  getSelectableConfiguredModels: async () => [],
  loadDefaultOptions: async () => ({}),
  mergeAvailableModels: (models: unknown[]) => models,
  saveDefaultOptions: vi.fn(),
}))
vi.mock('@/lib/model-reference', () => ({ loadModelCatalog: async () => [] }))
vi.mock('@/lib/tool-display-settings', () => ({
  loadToolDisplaySettings: async () => ({ toolDisplayMode: 'detailed', showContextUsage: false, expandProcessStageByDefault: true }),
  saveToolDisplaySettings: settings.saveToolDisplay,
}))
vi.mock('@/lib/auto-compact-settings', () => ({
  loadAutoCompactSettings: async () => ({ enabled: true, requireConfirmation: false, thresholdPercent: 90, keepRecentTurns: 3 }),
  saveAutoCompactSettings: settings.saveAutoCompact,
}))
vi.mock('@/lib/goal-settings', () => ({ loadGoalSettings: async () => ({ maxIterations: 20 }), saveGoalSettings: vi.fn() }))
vi.mock('@/lib/auto-archive-settings', () => ({ loadAutoArchiveSettings: async () => ({ enabled: false }), saveAutoArchiveSettings: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key, getAppLanguage: () => 'zh', applyAppLanguage: vi.fn() }))
vi.mock('@/lib/system-notifications', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/lib/system-notifications')>(),
  getSystemNotificationPermission: notifications.permission,
  requestSystemNotificationPermission: notifications.request,
  showTaskSystemNotification: notifications.show,
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/settings/tabs/shared', () => ({ SettingsSwitch: () => null, SettingsSelect: () => null }))

import { DefaultOptionsSettingsTab } from '../../src/components/settings/tabs/DefaultOptionsSettingsTab'
import { SettingsSwitch } from '../../src/components/settings/tabs/shared'
import { isSystemNotificationsEnabled } from '../../src/lib/system-notifications'

type Node = ReactElement<{ children?: unknown; className?: string; checked?: boolean; disabled?: boolean; onChange?: (checked: boolean) => void; onClick?: () => void; role?: string }>
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as Node
  return [node, ...nodes(node.props.children)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  return tree && typeof tree === 'object' && 'props' in tree ? text((tree as Node).props.children) : ''
}
function render() {
  harness.cursor = 0
  harness.refCursor = 0
  harness.effects = []
  return nodes(DefaultOptionsSettingsTab())
}
function settingsSwitch(label: string) {
  const row = render().find((node) => node.props.className === 'quickforge-settings-row' && text(node).startsWith(label))
  const control = nodes(row).find((node) => node.type === SettingsSwitch)
  if (!control) throw new Error(`Missing switch ${label}`)
  return control
}
function notificationSwitch() {
  return settingsSwitch('systemNotifications')
}
function testButton() {
  return render().find((node) => node.type === 'button' && text(node) === 'systemNotificationsTest')
}
function message(role: string) {
  return text(render().find((node) => node.props.role === role))
}
async function mount() {
  render()
  for (const effect of harness.effects) effect()
  await vi.waitFor(() => expect(render().some((node) => node.props.className === 'quickforge-settings-stack')).toBe(true))
}
const storageKey = 'quickforge:system-notifications-enabled'
beforeEach(() => {
  vi.clearAllMocks()
  harness.states = []
  harness.refs = []
  const values = new Map<string, string>([[storageKey, '0']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
  notifications.permission.mockResolvedValue('prompt')
  notifications.request.mockResolvedValue('granted')
  notifications.show.mockResolvedValue(true)
})
afterEach(() => vi.unstubAllGlobals())

describe('React default options notification persistence', () => {
  it('preserves loaded sibling settings when rendered callbacks save a toggle', async () => {
    await mount()
    settingsSwitch('showContextUsage').props.onChange!(true)
    expect(settings.saveToolDisplay).toHaveBeenCalledWith({}, { toolDisplayMode: 'detailed', showContextUsage: true, expandProcessStageByDefault: true })
    settingsSwitch('autoCompactEnabled').props.onChange!(false)
    expect(settings.saveAutoCompact).toHaveBeenCalledWith({}, { enabled: false, requireConfirmation: false, thresholdPercent: 90, keepRecentTurns: 3, minSourceChars: 1600 })
  })

  it('renders the expand process stage switch expanded by default and saves it without dropping sibling settings', async () => {
    await mount()
    expect(settingsSwitch('expandProcessStageByDefault').props.checked).toBe(true)
    settingsSwitch('expandProcessStageByDefault').props.onChange!(false)
    expect(settings.saveToolDisplay).toHaveBeenCalledWith({}, { toolDisplayMode: 'detailed', showContextUsage: false, expandProcessStageByDefault: false })
  })

  it('allows a second proxy refresh after the first finishes', async () => {
    const refresh = () => render().find((node) => node.type === 'button' && ['networkProxyRefresh', 'saving'].includes(text(node)))!
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ config: { mode: 'system', proxyUrl: '' }, status: { supported: true } }), { status: 200 }))
    await mount()
    refresh().props.onClick!()
    expect(refresh().props.disabled).toBe(true)
    await vi.waitFor(() => expect(refresh().props.disabled).toBe(false))
    refresh().props.onClick!()
    await vi.waitFor(() => expect(refresh().props.disabled).toBe(false))
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === '/api/system/network-proxy/refresh')).toHaveLength(2)
  })

  it('persists disable and hides the test action without requesting permission', async () => {
    localStorage.setItem(storageKey, '1')
    notifications.permission.mockResolvedValue('granted')
    await mount()
    expect(notificationSwitch().props.checked).toBe(true)
    expect(testButton()).toBeDefined()
    notificationSwitch().props.onChange!(false)
    expect(localStorage.getItem(storageKey)).toBe('0')
    expect(isSystemNotificationsEnabled()).toBe(false)
    expect(notificationSwitch().props.checked).toBe(false)
    expect(testButton()).toBeUndefined()
    expect(notifications.request).not.toHaveBeenCalled()
    expect(message('status')).toBe('systemNotificationsDisabled')
  })

  it('persists enable before permission initialization, disables the pending control, then reflects grant', async () => {
    let resolve!: (permission: SystemNotificationPermission) => void
    notifications.request.mockImplementation(() => {
      expect(localStorage.getItem(storageKey)).toBe('1')
      return new Promise((done) => { resolve = done })
    })
    await mount()
    notificationSwitch().props.onChange!(true)
    expect(notificationSwitch().props.disabled).toBe(true)
    expect(testButton()).toBeUndefined()
    resolve('granted')
    await vi.waitFor(() => expect(notificationSwitch().props.disabled).toBe(false))
    expect(localStorage.getItem(storageKey)).toBe('1')
    expect(isSystemNotificationsEnabled()).toBe(true)
    expect(notificationSwitch().props.checked).toBe(true)
    expect(testButton()).toBeDefined()
    expect(message('status')).toBe('systemNotificationsEnabled')
    expect(message('alert')).toBe('')
  })

  it.each([
    ['denied', 'systemNotificationsDeniedHelp', false],
    ['unsupported', 'systemNotificationsUnsupported', true],
    ['prompt', '', false],
  ] as const)('keeps the enabled preference stored while reflecting %s permission in the UI', async (permission, error, disabled) => {
    notifications.request.mockResolvedValue(permission)
    await mount()
    notificationSwitch().props.onChange!(true)
    await vi.waitFor(() => {
      expect(message('alert')).toBe(error)
      expect(notificationSwitch().props.disabled).toBe(disabled)
    })
    expect(localStorage.getItem(storageKey)).toBe('1')
    expect(isSystemNotificationsEnabled()).toBe(true)
    expect(notificationSwitch().props.checked).toBe(false)
    expect(testButton()).toBeUndefined()
    expect(message('status')).toBe('')
  })

  it('keeps the enabled preference stored when the permission request throws', async () => {
    notifications.request.mockRejectedValue(new Error('permission failed'))
    await mount()
    notificationSwitch().props.onChange!(true)
    await vi.waitFor(() => expect(message('alert')).toBe('permission failed'))
    expect(localStorage.getItem(storageKey)).toBe('1')
    expect(isSystemNotificationsEnabled()).toBe(true)
    expect(notificationSwitch().props.checked).toBe(false)
    expect(notificationSwitch().props.disabled).toBe(false)
    expect(testButton()).toBeUndefined()
  })

  it.each(['denied', 'prompt', 'unsupported'] as const)('keeps the stored enable preference while showing %s permission as off on load', async (permission) => {
    localStorage.setItem(storageKey, '1')
    notifications.permission.mockResolvedValue(permission)
    await mount()
    expect(localStorage.getItem(storageKey)).toBe('1')
    expect(isSystemNotificationsEnabled()).toBe(true)
    expect(notificationSwitch().props.checked).toBe(false)
    expect(notificationSwitch().props.disabled).toBe(permission === 'unsupported')
    expect(testButton()).toBeUndefined()
    expect(notifications.request).not.toHaveBeenCalled()
  })

  it('keeps an explicit disabled choice even when permission is already granted', async () => {
    notifications.permission.mockResolvedValue('granted')
    await mount()
    expect(localStorage.getItem(storageKey)).toBe('0')
    expect(notificationSwitch().props.checked).toBe(false)
    expect(notifications.request).not.toHaveBeenCalled()
  })

  it('keeps the test notification callback and failure feedback', async () => {
    localStorage.setItem(storageKey, '1')
    notifications.permission.mockResolvedValue('granted')
    notifications.show.mockResolvedValue(false)
    await mount()
    testButton()!.props.onClick!()
    await vi.waitFor(() => expect(message('alert')).toBe('systemNotificationTestFailed'))
    expect(notifications.show).toHaveBeenCalledWith({ key: expect.stringMatching(/^test:/), title: 'systemNotificationTestTitle', status: 'idle', force: true })
    expect(notificationSwitch().props.checked).toBe(true)
    expect(localStorage.getItem(storageKey)).toBe('1')
    expect(testButton()!.props.disabled).toBe(false)
  })
})
