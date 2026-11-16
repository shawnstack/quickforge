import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
const prompt = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/prompt-dialog', () => ({ showPrompt: prompt }))
import { ProjectCommandsSettingsTab } from '../../src/components/settings/tabs/ProjectCommandsSettingsTab'
const fetchMock = vi.fn()
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function render() { harness.begin(); return nodes(ProjectCommandsSettingsTab()) }
function button(label: string) { return render().find((node) => node.type === 'button' && text(node) === label)! }
function hasText(value: string) { return render().some((node) => text(node).includes(value)) }
async function mount(commandDir = '') {
  fetchMock.mockImplementation(async (url: string) => url === '/api/project'
    ? json({ project: { id: 'project-1', name: 'Project', commandDir } })
    : json({ commands: [{ name: 'test', description: 'Loaded command' }] }))
  render(); harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(button('createCommand')?.props.disabled).toBe(false))
  expect(hasText('Loaded command')).toBe(true)
  fetchMock.mockClear()
}
/** 挂载并自行收集 effect cleanup：harness.effects.forEach 会把 cleanup 丢掉，卸载语义必须自己还原。 */
async function mountWithCleanups(commandDir = '') {
  fetchMock.mockImplementation(async (url: string) => url === '/api/project'
    ? json({ project: { id: 'project-1', name: 'Project', commandDir } })
    : json({ commands: [{ name: 'test', description: 'Loaded command' }] }))
  render()
  const cleanups = harness.effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')
  await vi.waitFor(() => expect(button('createCommand')?.props.disabled).toBe(false))
  expect(hasText('Loaded command')).toBe(true)
  fetchMock.mockClear()
  return cleanups
}
function postedBody(url: string) {
  const call = fetchMock.mock.calls.find(([target]) => target === url)!
  expect(call[1].method).toBe('POST')
  return JSON.parse(call[1].body)
}
beforeEach(() => { harness.reset(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('window', globalThis) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('React project commands settings', () => {
  it.each([['custom/commands\nother', 'custom/commands'], ['\r\n  custom/commands  \nother', 'custom/commands'], ['', '.ai/commands'], ['  \n\t', '.ai/commands']])('opens resolved directory %j', async (dir, expected) => {
    await mount(dir)
    button('openCommandDir').props.onClick()
    await vi.waitFor(() => expect(postedBody('/api/project/open-path')).toEqual({ path: expected, projectId: 'project-1' }))
  })
  it('does not post when prompt is cancelled', async () => {
    await mount(); prompt.mockResolvedValue(null)
    button('createCommand').props.onClick()
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledWith({ title: 'newCommandPrompt', placeholder: 'newCommandNamePlaceholder', confirmLabel: 'createCommand', cancelLabel: 'cancel' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('creates a command and refreshes the list', async () => {
    await mount(); prompt.mockResolvedValue('my-command')
    fetchMock.mockImplementation(async (url: string) => json(url === '/api/project/command' ? { ok: true, name: 'my-command' } : { commands: [] }))
    button('createCommand').props.onClick()
    await vi.waitFor(() => expect(hasText('commandCreated')).toBe(true))
    expect(postedBody('/api/project/command')).toEqual({ name: 'my-command', projectId: 'project-1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/project/commands?projectId=project-1', expect.objectContaining({ cache: 'no-store' }))
  })
  it.each([['exists', 'commandAlreadyExists'], ['invalid', 'invalidCommandName']])('shows %s business failure without reloading', async (reason, message) => {
    await mount(); prompt.mockResolvedValue('my-command'); fetchMock.mockResolvedValue(json({ ok: false, reason }))
    button('createCommand').props.onClick()
    await vi.waitFor(() => expect(hasText(message)).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not lose a newer draft when an earlier debounced save completes', async () => {
    await mount('initial')
    vi.useFakeTimers()
    let completeFirst!: (response: Response) => void
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/command-dir')) return json({ commands: [] })
      const dir = JSON.parse(String(init?.body)).commandDir
      if (dir === 'first') return new Promise<Response>((resolve) => { completeFirst = resolve })
      return json({ project: { id: 'project-1', name: 'Project', commandDir: dir } })
    })
    const editor = () => render().find((node) => node.type === 'textarea')!
    editor().props.onChange({ currentTarget: { value: 'first' } })
    await vi.advanceTimersByTimeAsync(800)
    editor().props.onChange({ currentTarget: { value: 'second' } })
    completeFirst(json({ project: { id: 'project-1', name: 'Project', commandDir: 'first' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(editor().props.value).toBe('second')
    await vi.advanceTimersByTimeAsync(800)
    const saves = fetchMock.mock.calls.filter(([url]) => url.endsWith('/command-dir'))
    expect(saves.map(([, init]) => JSON.parse(init.body).commandDir)).toEqual(['first', 'second'])
    expect(editor().props.value).toBe('second')
  })
  it('keeps the trailing newline the user typed even though the server trims it back', async () => {
    await mount('initial')
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.endsWith('/command-dir')) return json({ commands: [] })
      const dir = JSON.parse(String(init?.body)).commandDir
      // 服务端 `commandDir.trim()` 后存库并原样回传
      return json({ project: { id: 'project-1', name: 'Project', commandDir: String(dir).trim() } })
    })
    const editor = () => render().find((node) => node.type === 'textarea')!
    editor().props.onChange({ currentTarget: { value: 'custom/commands\n' } })
    await vi.advanceTimersByTimeAsync(800)
    expect(editor().props.value).toBe('custom/commands\n')
    const saves = fetchMock.mock.calls.filter(([url]) => url.endsWith('/command-dir'))
    expect(saves).toHaveLength(1)
  })
  it('adopts a command directory that was changed elsewhere', async () => {
    await mount('initial')
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/command-dir')
      ? json({ project: { id: 'project-1', name: 'Project', commandDir: '/other/dir' } })
      : json({ commands: [] })))
    const editor = () => render().find((node) => node.type === 'textarea')!
    editor().props.onChange({ currentTarget: { value: 'mine' } })
    await vi.advanceTimersByTimeAsync(800)
    expect(editor().props.value).toBe('/other/dir')
  })
  it('surfaces an HTTP failure', async () => {
    await mount(); fetchMock.mockResolvedValue(json({ error: 'Cannot open directory' }, 500))
    button('openCommandDir').props.onClick()
    await vi.waitFor(() => expect(hasText('Cannot open directory')).toBe(true))
  })
  it('flushes the pending debounced save when the tab unmounts inside the debounce window', async () => {
    const unmount = await mountWithCleanups('initial')
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/command-dir')
      ? json({ project: { id: 'project-1', name: 'Project', commandDir: 'initial' } })
      : json({ commands: [] })))
    render().find((node) => node.type === 'textarea')!.props.onChange({ currentTarget: { value: 'typed-then-left' } })
    // 卸载（切 tab / 关设置页）：800ms 防抖还没到期，这是最后一次把改动写出去的机会
    unmount.forEach((cleanup) => cleanup())
    const puts = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/command-dir'))
      .map(([, init]) => JSON.parse(String(init.body)).commandDir)
    expect(puts).toEqual(['typed-then-left'])
  })
  it('flushes the previous project pending save when switching projects inside the debounce window', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/project') {
        return json({
          project: { id: 'project-1', name: 'Project One', commandDir: 'dir-a' },
          projects: [
            { id: 'project-1', name: 'Project One', commandDir: 'dir-a' },
            { id: 'project-2', name: 'Project Two', commandDir: 'dir-b' },
          ],
        })
      }
      return json({ commands: [] })
    })
    render()
    harness.effects.forEach((effect) => effect())
    await vi.waitFor(() => expect(render().some((node) => node.type === 'select')).toBe(true))
    fetchMock.mockClear()
    render().find((node) => node.type === 'textarea')!.props.onChange({ currentTarget: { value: 'edited-in-a' } })
    render().find((node) => node.type === 'select')!.props.onChange({ currentTarget: { value: 'project-2' } })
    const puts = fetchMock.mock.calls
      .filter(([url]) => url === '/api/project/project-1/command-dir')
      .map(([, init]) => JSON.parse(String(init.body)).commandDir)
    expect(puts).toEqual(['edited-in-a'])
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/project/project-2/command-dir')).toBe(false)
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
  })
})
