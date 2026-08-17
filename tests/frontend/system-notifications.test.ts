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
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    vi.stubGlobal('location', {
      hostname: 'quickforge.example.ts.net',
      search: '',
    })
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: true,
      location: { origin: 'https://quickforge.example.ts.net' },
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

  it('defaults to enabled and persists explicit disable and enable choices', async () => {
    const notifications = await loadModule()

    expect(notifications.isSystemNotificationsEnabled()).toBe(true)
    notifications.setSystemNotificationsEnabled(false)
    expect(localStorage.getItem('quickforge:system-notifications-enabled')).toBe('0')
    expect(notifications.isSystemNotificationsEnabled()).toBe(false)
    notifications.setSystemNotificationsEnabled(true)
    expect(localStorage.getItem('quickforge:system-notifications-enabled')).toBe('1')
    expect(notifications.isSystemNotificationsEnabled()).toBe(true)
  })

  it('requests browser permission without doing so during initialization', async () => {
    MockNotification.requestPermission.mockResolvedValue('granted')
    const notifications = await loadModule()

    await notifications.initializeSystemNotifications()
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
    await expect(notifications.requestSystemNotificationPermission()).resolves.toBe('granted')
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

  it('uses a Service Worker registration for browser notifications when available', async () => {
    MockNotification.permission = 'granted'
    const showNotification = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({ showNotification }),
        addEventListener: vi.fn(),
      },
    })
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)

    await expect(notifications.showTaskSystemNotification({
      key: 'agent:session-sw:idle',
      sessionId: 'session-sw',
      title: 'Android build complete',
      status: 'idle',
    })).resolves.toBe(true)

    expect(showNotification).toHaveBeenCalledWith('Android build complete', expect.objectContaining({
      tag: 'agent:session-sw:idle',
      data: { sessionId: 'session-sw' },
    }))
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('does not use the Notification constructor on Android when Service Worker delivery is unavailable', async () => {
    MockNotification.permission = 'granted'
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
      },
    })
    const notifications = await loadModule()
    notifications.setSystemNotificationsEnabled(true)

    await expect(notifications.showTaskSystemNotification({
      key: 'agent:session-no-sw:idle',
      sessionId: 'session-no-sw',
      title: 'Android build complete',
      status: 'idle',
    })).resolves.toBe(false)
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('opens a session from a Service Worker notification message and initializes the listener once', async () => {
    const addEventListener = vi.fn()
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      serviceWorker: { addEventListener },
    })
    const notifications = await loadModule()

    await notifications.initializeSystemNotifications()
    await notifications.initializeSystemNotifications()

    expect(addEventListener).toHaveBeenCalledTimes(1)
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    const handler = addEventListener.mock.calls[0]?.[1] as (event: MessageEvent) => void
    handler({ data: { type: 'quickforge:open-session', sessionId: 'session-clicked' } } as MessageEvent)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'quickforge:open-session-from-settings',
      detail: { sessionId: 'session-clicked' },
    }))
  })

  it('requests notification permission once on the first valid Android remote send', async () => {
    let resolvePermission: ((permission: NotificationPermission) => void) | undefined
    MockNotification.requestPermission.mockImplementation(() => new Promise((resolve) => {
      resolvePermission = resolve
    }))
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      serviceWorker: { addEventListener: vi.fn() },
    })
    const notifications = await loadModule()

    notifications.requestAndroidRemoteSystemNotificationPermissionOnce()
    expect(localStorage.getItem('quickforge:android-remote-notification-permission-requested:v1')).toBe('1')
    notifications.requestAndroidRemoteSystemNotificationPermissionOnce()
    expect(MockNotification.requestPermission).toHaveBeenCalledTimes(1)
    resolvePermission?.('granted')
    await Promise.resolve()
  })

  it.each([
    ['an insecure context', { secure: false, userAgent: 'Mozilla/5.0 (Linux; Android 15)', native: false, hostname: 'quickforge.example.ts.net' }],
    ['a non-Android browser', { secure: true, userAgent: 'Mozilla/5.0 (iPhone)', native: false, hostname: 'quickforge.example.ts.net' }],
    ['a Capacitor client', { secure: true, userAgent: 'Mozilla/5.0 (Linux; Android 15)', native: true, hostname: 'quickforge.example.ts.net' }],
    ['a local Android client', { secure: true, userAgent: 'Mozilla/5.0 (Linux; Android 15)', native: false, hostname: 'localhost' }],
  ])('does not auto-request notification permission for %s', async (_name, scenario) => {
    MockNotification.requestPermission.mockResolvedValue('granted')
    capacitorMocks.isNativePlatform.mockReturnValue(scenario.native)
    vi.stubGlobal('navigator', {
      userAgent: scenario.userAgent,
      serviceWorker: { addEventListener: vi.fn() },
    })
    vi.stubGlobal('location', {
      hostname: scenario.hostname,
      search: '',
    })
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: scenario.secure,
      location: { origin: `https://${scenario.hostname}` },
    })
    const notifications = await loadModule()

    notifications.requestAndroidRemoteSystemNotificationPermissionOnce()
    await Promise.resolve()
    expect(MockNotification.requestPermission).not.toHaveBeenCalled()
  })

  it('maps Desktop support to permission and delivers payload through the bridge', async () => {
    const desktopBridge = {
      isSupported: vi.fn().mockResolvedValue(true),
      show: vi.fn().mockResolvedValue(true),
      onOpenSession: vi.fn(() => vi.fn()),
    }
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: true,
      location: { origin: 'http://127.0.0.1:5177' },
      QuickForgeDesktopNotifications: desktopBridge,
    })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      serviceWorker: {
        getRegistration: vi.fn(),
        addEventListener: vi.fn(),
      },
    })
    const notifications = await loadModule()

    await expect(notifications.getSystemNotificationPermission()).resolves.toBe('granted')
    await expect(notifications.showTaskSystemNotification({
      key: 'desktop:session-1:idle',
      sessionId: 'session-1',
      title: 'Desktop build complete',
      status: 'idle',
    })).resolves.toBe(true)

    expect(desktopBridge.show).toHaveBeenCalledWith({
      title: 'Desktop build complete',
      body: 'taskCompleted. systemNotificationOpenDetails',
      sessionId: 'session-1',
    })
    expect(navigator.serviceWorker.getRegistration).not.toHaveBeenCalled()
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('reports unsupported Desktop notifications without falling back to Web notifications', async () => {
    const desktopBridge = {
      isSupported: vi.fn().mockResolvedValue(false),
      show: vi.fn(),
      onOpenSession: vi.fn(() => vi.fn()),
    }
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: true,
      location: { origin: 'http://127.0.0.1:5177' },
      QuickForgeDesktopNotifications: desktopBridge,
    })
    MockNotification.permission = 'granted'
    const notifications = await loadModule()

    await expect(notifications.getSystemNotificationPermission()).resolves.toBe('unsupported')
    await expect(notifications.showTaskSystemNotification({
      key: 'desktop:unsupported:idle',
      title: 'Unsupported desktop notification',
      status: 'idle',
    })).resolves.toBe(false)
    expect(desktopBridge.show).not.toHaveBeenCalled()
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('opens Desktop notification sessions and initializes the Desktop listener once', async () => {
    let openSessionCallback: ((sessionId: string) => void) | undefined
    const desktopBridge = {
      isSupported: vi.fn().mockResolvedValue(true),
      show: vi.fn().mockResolvedValue(true),
      onOpenSession: vi.fn((callback: (sessionId: string) => void) => {
        openSessionCallback = callback
        return vi.fn()
      }),
    }
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: true,
      location: { origin: 'http://127.0.0.1:5177' },
      QuickForgeDesktopNotifications: desktopBridge,
    })
    const notifications = await loadModule()

    await notifications.initializeSystemNotifications()
    await notifications.initializeSystemNotifications()
    expect(desktopBridge.onOpenSession).toHaveBeenCalledTimes(1)

    openSessionCallback?.('desktop-session-clicked')
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'quickforge:open-session-from-settings',
      detail: { sessionId: 'desktop-session-clicked' },
    }))
  })

  it('keeps Capacitor delivery ahead of the Desktop bridge', async () => {
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.isPluginAvailable.mockReturnValue(true)
    localNotificationMocks.checkPermissions.mockResolvedValue({ display: 'granted' })
    localNotificationMocks.addListener.mockResolvedValue({ remove: vi.fn() })
    localNotificationMocks.schedule.mockResolvedValue({ notifications: [] })
    const desktopBridge = {
      isSupported: vi.fn().mockResolvedValue(true),
      show: vi.fn().mockResolvedValue(true),
      onOpenSession: vi.fn(() => vi.fn()),
    }
    vi.stubGlobal('window', {
      focus: vi.fn(),
      dispatchEvent: vi.fn(),
      isSecureContext: true,
      location: { origin: 'http://127.0.0.1:5177' },
      QuickForgeDesktopNotifications: desktopBridge,
    })
    const notifications = await loadModule()

    await expect(notifications.showTaskSystemNotification({
      key: 'native-before-desktop:idle',
      title: 'Native first',
      status: 'idle',
    })).resolves.toBe(true)

    expect(localNotificationMocks.schedule).toHaveBeenCalledTimes(1)
    expect(desktopBridge.show).not.toHaveBeenCalled()
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
