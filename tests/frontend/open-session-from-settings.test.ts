import { beforeEach, describe, expect, it, vi } from 'vitest'

const storageMocks = vi.hoisted(() => ({
  getMetadata: vi.fn(),
}))

vi.mock('../../src/storage', () => ({
  getAppStorage: () => ({
    sessions: {
      getMetadata: storageMocks.getMetadata,
    },
  }),
}))

vi.mock('../../src/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

type Handler = typeof import('../../src/lib/open-session-from-settings')['openSessionFromSettings']

describe('openSessionFromSettings', () => {
  let openSessionFromSettings: Handler
  let closeSettingsPage: ReturnType<typeof vi.fn>
  let scheduleSessionLoad: ReturnType<typeof vi.fn>
  let loadSession: ReturnType<typeof vi.fn>
  let onMissingSession: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    closeSettingsPage = vi.fn()
    scheduleSessionLoad = vi.fn()
    loadSession = vi.fn()
    onMissingSession = vi.fn()
    ;({ openSessionFromSettings } = await import('../../src/lib/open-session-from-settings'))
  })

  it('does nothing without a session id', async () => {
    await openSessionFromSettings({
      sessionId: '',
      closeSettingsPage,
      scheduleSessionLoad,
      loadSession,
      onMissingSession,
    })

    expect(storageMocks.getMetadata).not.toHaveBeenCalled()
    expect(onMissingSession).not.toHaveBeenCalled()
    expect(closeSettingsPage).not.toHaveBeenCalled()
    expect(scheduleSessionLoad).not.toHaveBeenCalled()
  })

  it('alerts and keeps the settings page open when local metadata is missing', async () => {
    storageMocks.getMetadata.mockResolvedValue(null)

    await openSessionFromSettings({
      sessionId: 'session-missing',
      closeSettingsPage,
      scheduleSessionLoad,
      loadSession,
      onMissingSession,
    })

    expect(storageMocks.getMetadata).toHaveBeenCalledWith('session-missing')
    expect(onMissingSession).toHaveBeenCalledTimes(1)
    expect(closeSettingsPage).not.toHaveBeenCalled()
    expect(scheduleSessionLoad).not.toHaveBeenCalled()
    expect(loadSession).not.toHaveBeenCalled()
  })

  it('closes the settings page and loads the session when metadata exists', async () => {
    storageMocks.getMetadata.mockResolvedValue({ id: 'session-1', title: 'Task run' })
    loadSession.mockResolvedValue(true)

    await openSessionFromSettings({
      sessionId: 'session-1',
      closeSettingsPage,
      scheduleSessionLoad,
      loadSession,
      onMissingSession,
    })

    expect(onMissingSession).not.toHaveBeenCalled()
    expect(closeSettingsPage).toHaveBeenCalledTimes(1)
    expect(scheduleSessionLoad).toHaveBeenCalledTimes(1)
    expect(scheduleSessionLoad.mock.calls[0][0]).toBe('session-1')
    const load = scheduleSessionLoad.mock.calls[0][1] as () => Promise<boolean>

    await expect(load()).resolves.toBe(true)
    expect(loadSession).toHaveBeenCalledWith('session-1')
    expect(onMissingSession).not.toHaveBeenCalled()
  })

  it('falls back to the missing-session alert when the load returns false', async () => {
    storageMocks.getMetadata.mockResolvedValue({ id: 'session-1', title: 'Task run' })
    loadSession.mockResolvedValue(false)

    await openSessionFromSettings({
      sessionId: 'session-1',
      closeSettingsPage,
      scheduleSessionLoad,
      loadSession,
      onMissingSession,
    })

    const load = scheduleSessionLoad.mock.calls[0][1] as () => Promise<boolean>
    await expect(load()).resolves.toBe(false)
    expect(loadSession).toHaveBeenCalledWith('session-1')
    expect(onMissingSession).toHaveBeenCalledTimes(1)
  })

  it('does not block navigation when the metadata precheck itself throws', async () => {
    storageMocks.getMetadata.mockRejectedValue(new Error('storage unavailable'))
    loadSession.mockResolvedValue(true)

    await openSessionFromSettings({
      sessionId: 'session-1',
      closeSettingsPage,
      scheduleSessionLoad,
      loadSession,
      onMissingSession,
    })

    expect(closeSettingsPage).toHaveBeenCalledTimes(1)
    expect(scheduleSessionLoad).toHaveBeenCalledTimes(1)
    expect(onMissingSession).not.toHaveBeenCalled()
  })
})
