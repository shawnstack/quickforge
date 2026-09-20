import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
const storageValues = new Map<string, unknown>()
const storageSet = vi.fn(async (key: string, value: unknown) => { storageValues.set(key, value) })
vi.mock('@/storage', () => ({ getAppStorage: () => ({ settings: { get: async (key: string) => storageValues.get(key), set: storageSet } }) }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: confirmMock }))
import { HooksSettingsTab } from '../../src/components/settings/tabs/HooksSettingsTab'
import { SettingsSwitch } from '../../src/components/settings/tabs/shared'

const fetchMock = vi.fn()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

const storedHook = {
  id: 'hook-1',
  name: 'Build notify',
  enabled: true,
  events: ['error'],
  action: { type: 'command', command: 'notify-send "{{message}}"' },
  timeoutSeconds: 10,
  silentOnFailure: false,
}

const executionError = {
  id: 'exec-1',
  hookId: 'hook-1',
  hookName: 'Build notify',
  event: 'error',
  startedAt: '2026-01-01T10:39:00.000Z',
  durationMs: 120,
  status: 'error',
  exitCode: 127,
  output: 'notify-send: command not found',
}
const executionSuccess = {
  id: 'exec-2',
  hookId: 'hook-1',
  hookName: 'Build notify',
  event: 'error',
  startedAt: '2026-01-01T10:42:00.000Z',
  durationMs: 380,
  status: 'success',
}

function render() { harness.begin(); return nodes(HooksSettingsTab()) }
function hasText(value: string) { return render().some((node) => text(node).includes(value)) }
function button(label: string) { return render().find((node) => node.type === 'button' && text(node) === label)! }
async function mount(executions: unknown[] = [executionError, executionSuccess]) {
  storageValues.clear()
  storageValues.set('hooks-settings', { enabled: true, hooks: [storedHook] })
  fetchMock.mockImplementation(async () => json({ executions }))
  render()
  harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(hasText('Build notify')).toBe(true))
  storageSet.mockClear()
}
beforeEach(() => { harness.reset(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('window', globalThis) })
afterEach(() => vi.unstubAllGlobals())

describe('React hooks settings tab', () => {
  it('renders hook rows with badges and mono summary, and executions (no master switch)', async () => {
    await mount()
    // 总开关已移除：列表内开关与 Hook 一一对应。
    const switches = render().filter((node) => node.type === SettingsSwitch)
    expect(switches).toHaveLength(1)
    expect(switches[0].props.checked).toBe(true)
    expect(hasText('notify-send "{{message}}"')).toBe(true)
    expect(hasText('hooksEventError')).toBe(true)
    expect(hasText('hooksStatusError')).toBe(true)
    expect(hasText('hooksStatusSuccess')).toBe(true)
    expect(hasText('0.1s')).toBe(true)
    expect(hasText('0.4s')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/hooks/executions', expect.objectContaining({ cache: 'no-store' }))
  })

  it('toggles a hook switch and persists the normalized settings payload with enabled pinned to true', async () => {
    await mount()
    const hookSwitch = render().find((node) => node.type === SettingsSwitch)!
    expect(hookSwitch.props.checked).toBe(true)
    hookSwitch.props.onChange(false)
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledWith('hooks-settings', { enabled: true, hooks: [{ ...storedHook, enabled: false }] }))
    expect(render().find((node) => node.type === SettingsSwitch)!.props.checked).toBe(false)
  })

  it('rolls back the hook switch when saving fails', async () => {
    await mount()
    storageSet.mockRejectedValueOnce(new Error('disk full'))
    render().find((node) => node.type === SettingsSwitch)!.props.onChange(false)
    await vi.waitFor(() => expect(hasText('disk full')).toBe(true))
    expect(render().find((node) => node.type === SettingsSwitch)!.props.checked).toBe(true)
  })

  it('resets a legacy disabled master flag to enabled on the next save', async () => {
    storageValues.clear()
    storageValues.set('hooks-settings', { enabled: false, hooks: [storedHook] })
    fetchMock.mockImplementation(async () => json({ executions: [] }))
    render()
    harness.effects.forEach((effect) => effect())
    await vi.waitFor(() => expect(hasText('Build notify')).toBe(true))
    render().find((node) => node.type === SettingsSwitch)!.props.onChange(false)
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledWith('hooks-settings', { enabled: true, hooks: [{ ...storedHook, enabled: false }] }))
  })

  it('prefills the edit modal from the stored hook and saves changes', async () => {
    await mount()
    render().find((node) => node.props['aria-label'] === 'hooksEditHook')!.props.onClick()
    await vi.waitFor(() => expect(render().some((node) => node.props.role === 'dialog')).toBe(true))
    const nameInput = render().find((node) => node.type === 'input' && node.props.value === 'Build notify')!
    expect(nameInput.props.id).toBe('hooks-editor-name')
    expect(render().find((node) => node.props.id === 'hooks-editor-command')!.props.value).toBe('notify-send "{{message}}"')
    nameInput.props.onChange({ currentTarget: { value: 'Renamed hook' } })
    button('save').props.onClick()
    await vi.waitFor(() => expect(render().some((node) => node.props.role === 'dialog')).toBe(false))
    expect(storageSet).toHaveBeenCalledWith('hooks-settings', {
      enabled: true,
      hooks: [{ ...storedHook, name: 'Renamed hook' }],
    })
    await vi.waitFor(() => expect(hasText('Renamed hook')).toBe(true))
  })

  it('blocks saving from an empty add form and shows inline validation errors', async () => {
    await mount()
    button('hooksAdd').props.onClick()
    await vi.waitFor(() => expect(render().some((node) => node.props.role === 'dialog')).toBe(true))
    button('save').props.onClick()
    expect(storageSet).not.toHaveBeenCalled()
    expect(hasText('hooksValidationErrorName')).toBe(true)
    expect(hasText('hooksValidationErrorEvents')).toBe(true)
    expect(hasText('hooksValidationErrorCommand')).toBe(true)
    expect(render().find((node) => node.props.role === 'dialog')).toBeTruthy()

    render().find((node) => node.type === 'input' && node.props.value === '')!.props.onChange({ currentTarget: { value: 'New hook' } })
    render().find((node) => node.type === 'button' && text(node) === 'hooksEventError')!.props.onClick()
    render().find((node) => node.props.id === 'hooks-editor-command')!.props.onChange({ currentTarget: { value: 'qf notify --session {{session.id}}' } })
    button('save').props.onClick()
    await vi.waitFor(() => expect(render().some((node) => node.props.role === 'dialog')).toBe(false))
    expect(storageSet).toHaveBeenCalledTimes(1)
    const [, saved] = storageSet.mock.calls[0]
    expect(saved.enabled).toBe(true)
    expect(saved.hooks).toHaveLength(2)
    expect(saved.hooks[1]).toMatchObject({
      name: 'New hook',
      enabled: true,
      events: ['error'],
      action: { type: 'command', command: 'qf notify --session {{session.id}}' },
      timeoutSeconds: 10,
    })
  })

  it('rejects an invalid webhook url before saving', async () => {
    await mount()
    button('hooksAdd').props.onClick()
    render().find((node) => node.type === 'input' && node.props.value === '')!.props.onChange({ currentTarget: { value: 'Webhook hook' } })
    render().find((node) => node.type === 'button' && text(node) === 'hooksEventError')!.props.onClick()
    render().find((node) => node.type === 'button' && text(node) === 'hooksActionSendWebhook')!.props.onClick()
    render().find((node) => node.props.id === 'hooks-editor-url')!.props.onChange({ currentTarget: { value: 'ftp://bad' } })
    button('save').props.onClick()
    expect(storageSet).not.toHaveBeenCalled()
    expect(hasText('hooksValidationErrorUrl')).toBe(true)
  })

  it('posts the draft hook to the test endpoint and renders the record', async () => {
    await mount()
    fetchMock.mockImplementation(async () => json({ execution: {
      id: 'test-exec',
      hookId: 'hook-1',
      hookName: 'Build notify',
      event: 'test',
      startedAt: '2026-01-01T10:00:00.000Z',
      durationMs: 420,
      status: 'success',
      exitCode: 0,
      output: 'ok',
      test: true,
    } }))
    render().find((node) => node.props['aria-label'] === 'hooksEditHook')!.props.onClick()
    await vi.waitFor(() => expect(render().some((node) => node.props.role === 'dialog')).toBe(true))
    button('hooksTestRun').props.onClick()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/hooks/test', expect.objectContaining({
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
    })))
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/hooks/test')!
    expect(JSON.parse(call[1].body)).toEqual({ hook: storedHook })
    await vi.waitFor(() => expect(hasText('hooksTestSuccess')).toBe(true))
    expect(hasText('0.4s')).toBe(true)
    expect(hasText('exit 0')).toBe(true)
  })

  it('shows the test failure message when the endpoint fails', async () => {
    await mount()
    fetchMock.mockImplementation(async (url: string) => (url === '/api/hooks/executions' ? json({ executions: [] }) : json({ error: 'spawn failed' }, 500)))
    render().find((node) => node.props['aria-label'] === 'hooksEditHook')!.props.onClick()
    button('hooksTestRun').props.onClick()
    await vi.waitFor(() => expect(hasText('spawn failed')).toBe(true))
    expect(hasText('hooksTestSuccess')).toBe(false)
  })

  it('deletes a hook after confirmation', async () => {
    await mount()
    confirmMock.mockResolvedValue(true)
    render().find((node) => node.props['aria-label'] === 'hooksDeleteHook')!.props.onClick()
    await vi.waitFor(() => expect(storageSet).toHaveBeenCalledWith('hooks-settings', { enabled: true, hooks: [] }))
    expect(confirmMock).toHaveBeenCalledWith({
      title: 'hooksDeleteTitle',
      description: 'hooksDeleteDescription',
      confirmLabel: 'delete',
      cancelLabel: 'cancel',
      variant: 'destructive',
    })
  })

  it('keeps the hook when the delete confirmation is dismissed', async () => {
    await mount()
    confirmMock.mockResolvedValue(false)
    render().find((node) => node.props['aria-label'] === 'hooksDeleteHook')!.props.onClick()
    await vi.waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(storageSet).not.toHaveBeenCalled()
    expect(hasText('Build notify')).toBe(true)
  })

  it('expands and collapses the failure output of an execution record', async () => {
    await mount()
    expect(hasText('notify-send: command not found')).toBe(false)
    button('hooksViewOutput').props.onClick()
    await vi.waitFor(() => expect(hasText('notify-send: command not found')).toBe(true))
    expect(button('hooksHideOutput').props['aria-expanded']).toBe('true')
    button('hooksHideOutput').props.onClick()
    await vi.waitFor(() => expect(hasText('notify-send: command not found')).toBe(false))
  })

  it('shows a weak failure notice with retry when the executions endpoint fails on mount', async () => {
    storageValues.clear()
    storageValues.set('hooks-settings', { enabled: true, hooks: [storedHook] })
    fetchMock.mockImplementation(async () => json({ error: 'boom' }, 500))
    render()
    harness.effects.forEach((effect) => effect())
    await vi.waitFor(() => expect(hasText('Build notify')).toBe(true))
    await vi.waitFor(() => expect(hasText('hooksExecutionsLoadFailed')).toBe(true))
    fetchMock.mockImplementation(async () => json({ executions: [executionSuccess] }))
    button('retry').props.onClick()
    await vi.waitFor(() => expect(hasText('hooksStatusSuccess')).toBe(true))
  })

  it('shows the empty states when no hooks and no executions are stored', async () => {
    storageValues.clear()
    storageValues.set('hooks-settings', { enabled: true, hooks: [] })
    fetchMock.mockImplementation(async () => json({ executions: [] }))
    render()
    harness.effects.forEach((effect) => effect())
    await vi.waitFor(() => expect(hasText('hooksEmpty')).toBe(true))
    expect(hasText('hooksExecutionsEmpty')).toBe(true)
  })
})
