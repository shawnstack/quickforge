import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  isPluginAvailable: vi.fn(() => false),
}))

const localNotificationMocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  addListener: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMocks,
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: localNotificationMocks,
}))

vi.mock('../../src/lib/i18n', () => ({
  t: (key: string) => key,
}))

vi.mock('../../src/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

function createLocalStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) },
  }
}

class MockNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>()
  static instances: MockNotification[] = []

  onclick: (() => void) | null = null
  close = vi.fn()

  constructor(
    public readonly title: string,
    public readonly options?: NotificationOptions,
  ) {
    MockNotification.instances.push(this)
  }
}

async function loadModule() {
  return import('../../src/lib/system-notifications')
}

describe('system notifications', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    vi.stubGlobal('Notification', MockNotification)
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      hasFocus: () => false,
      body: { classList: { contains: () => false } },
    })
    capacitorMocks.isNativePlatform.mockReturnValue(false)
    capacitorMocks.isPluginAvailable.mockReturnValue(false)
    MockNotification.permission = 'default'
    MockNotification.requestPermission.mockReset()
    MockNotification.instances = []
    localNotificationMocks.checkPermissions.mockReset()
    localNotificationMocks.requestPermissions.mockReset()
    localNotificationMocks.schedule.mockReset()
    localNotificationMocks.addListener.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('requests browser permission and persists the device-local setting', async () => {
    MockNotification.requestPermission.mockResolvedValue('granted')
    const notifications = await loadModule()

    await expect(notifications.requestSystemNotificationPermission()).resolves.toBe('granted')
    expect(notifications.isSystemNotificationsEnabled()).toBe(true)
  })

  it('shows a browser notification only when enabled and the page is in the background', async () => {
    MockNotification.permission = 'granted'
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)

    await expect(notifications.showTaskSystemNotification({
      key: 'agent:session-1:idle',
      sessionId: 'session-1',
      title: 'Build complete',
      status: 'idle',
    })).resolves.toBe(true)

    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0]?.title).toBe('Build complete')
    expect(MockNotification.instances[0]?.options).toMatchObject({
      tag: 'agent:session-1:idle',
      icon: '/pwa-icon-192.png',
    })
  })

  it('notifies terminal task states even when the page is focused', async () => {
    MockNotification.permission = 'granted'
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true,
      body: { classList: { contains: () => false } },
    })

    await expect(notifications.showTaskSystemNotification({
      key: 'agent:session-1:idle',
      sessionId: 'session-1',
      title: 'Build complete',
      status: 'idle',
    })).resolves.toBe(true)
    expect(MockNotification.instances).toHaveLength(1)
    expect(MockNotification.instances[0]?.title).toBe('Build complete')
  })

  it('suppresses running and duplicate browser notifications', async () => {
    MockNotification.permission = 'granted'
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      hasFocus: () => true,
      body: { classList: { contains: () => false } },
    })

    const payload = { key: 'scheduled:run-1', title: 'Daily report', status: 'running' as const }
    await expect(notifications.showTaskSystemNotification(payload)).resolves.toBe(false)

    vi.stubGlobal('document', {
      visibilityState: 'hidden',
      hasFocus: () => false,
      body: { classList: { contains: () => false } },
    })
    await expect(notifications.showTaskSystemNotification({ ...payload, status: 'idle' })).resolves.toBe(true)
    await expect(notifications.showTaskSystemNotification({ ...payload, status: 'idle' })).resolves.toBe(false)
    expect(MockNotification.instances).toHaveLength(1)
  })

  it('uses Capacitor Local Notifications on native Android', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.isPluginAvailable.mockReturnValue(true)
    localNotificationMocks.checkPermissions.mockResolvedValue({ display: 'granted' })
    localNotificationMocks.addListener.mockResolvedValue({ remove: vi.fn() })
    localNotificationMocks.schedule.mockResolvedValue({ notifications: [] })
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)

    await expect(notifications.showTaskSystemNotification({
      key: 'scheduled:run-2',
      sessionId: 'session-2',
      title: 'Android task',
      status: 'error',
    })).resolves.toBe(true)

    expect(localNotificationMocks.schedule).toHaveBeenCalledWith({
      notifications: [expect.objectContaining({
        title: 'Android task',
        extra: { sessionId: 'session-2' },
      })],
    })
    expect(MockNotification.instances).toHaveLength(0)
  })
})
