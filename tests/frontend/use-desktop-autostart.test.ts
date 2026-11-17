import { afterEach, describe, expect, it, vi } from 'vitest'
import { HookLifecycle, deferred, flushPromises, reactMockWithRuntime } from './helpers/hook-lifecycle'

vi.mock('react', async (importOriginal) => reactMockWithRuntime(await importOriginal<typeof import('react')>()))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

const bridge = vi.hoisted(() => ({ getState: vi.fn(), setEnabled: vi.fn() }))

vi.mock('@/lib/desktop-autostart-bridge', () => ({
  DEFAULT_DESKTOP_AUTOSTART_STATE: { supported: false, openAtLogin: false },
  getDesktopAutostartBridge: () => ({ getState: bridge.getState, setEnabled: bridge.setEnabled }),
}))

import { useDesktopAutostart } from '../../src/hooks/useDesktopAutostart'

let lifecycle = new HookLifecycle()

afterEach(() => {
  lifecycle.unmount()
  lifecycle = new HookLifecycle()
  vi.clearAllMocks()
})

function render(options: { active?: boolean } = {}) {
  return lifecycle.render(() => useDesktopAutostart(options))
}

describe('useDesktopAutostart', () => {
  it('mirrors the system login item state instead of keeping its own copy', async () => {
    const state = deferred<{ supported: boolean; openAtLogin: boolean }>()
    bridge.getState.mockReturnValue(state.promise)

    let controller = render()
    expect(controller.loading).toBe(true)
    expect(controller.state).toEqual({ supported: false, openAtLogin: false })

    state.resolve({ supported: true, openAtLogin: true })
    await flushPromises()
    controller = render()

    expect(controller.state).toEqual({ supported: true, openAtLogin: true })
    expect(controller.loading).toBe(false)
  })

  it('does not read the login item while the settings tab is inactive', () => {
    render({ active: false })
    expect(bridge.getState).not.toHaveBeenCalled()
  })

  it('drops a late response from an older toggle instead of overwriting the newer value', async () => {
    bridge.getState.mockResolvedValue({ supported: true, openAtLogin: false })
    render()
    await flushPromises()
    let controller = render()

    // 先发「开」、再发「关」；后发的先回，先发的后回。
    const enableResponse = deferred<{ supported: boolean; openAtLogin: boolean }>()
    const disableResponse = deferred<{ supported: boolean; openAtLogin: boolean }>()
    bridge.setEnabled
      .mockReturnValueOnce(enableResponse.promise)
      .mockReturnValueOnce(disableResponse.promise)

    const enabling = controller.setEnabled(true)
    const disabling = controller.setEnabled(false)

    disableResponse.resolve({ supported: true, openAtLogin: false })
    await flushPromises()
    controller = render()
    expect(controller.state.openAtLogin).toBe(false)
    expect(controller.saving).toBe(false)

    // 旧响应晚到：它描述的是已经被第二次点击取代的状态，必须整条丢弃。
    enableResponse.resolve({ supported: true, openAtLogin: true })
    await flushPromises()
    controller = render()
    expect(controller.state.openAtLogin).toBe(false)
    expect(controller.saving).toBe(false)

    await Promise.all([enabling, disabling])
  })

  it('reports a failure without pretending the switch flipped', async () => {
    bridge.getState.mockResolvedValue({ supported: true, openAtLogin: false })
    bridge.setEnabled.mockRejectedValue(new Error('denied'))
    render()
    await flushPromises()
    let controller = render()

    await controller.setEnabled(true)
    controller = render()

    expect(controller.state.openAtLogin).toBe(false)
    expect(controller.error).toBe('launchAtStartupFailed')
    expect(controller.saving).toBe(false)
  })
})
