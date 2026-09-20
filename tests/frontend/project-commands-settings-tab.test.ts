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
  it('surfaces an HTTP failure', async () => {
    await mount(); fetchMock.mockResolvedValue(json({ error: 'Cannot open directory' }, 500))
    button('openCommandDir').props.onClick()
    await vi.waitFor(() => expect(hasText('Cannot open directory')).toBe(true))
  })
})
