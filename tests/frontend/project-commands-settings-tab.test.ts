import { beforeEach, describe, expect, it, vi } from 'vitest'

const piWebUiMocks = vi.hoisted(() => ({
  SettingsTab: class {
    requestUpdate() {}
  },
}))

const promptDialogMocks = vi.hoisted(() => ({
  showPrompt: vi.fn(),
}))

vi.mock('@earendil-works/pi-web-ui', () => piWebUiMocks)
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/prompt-dialog', () => ({ showPrompt: promptDialogMocks.showPrompt }))
vi.mock('../../src/lib/info-tip', () => ({}))

type TestTab = {
  project?: { id: string }
  commandDir: string
  error: string
  message: string
  openCommandDir: () => Promise<void>
  createCommand: () => Promise<void>
}

let registeredTab: new () => TestTab

vi.stubGlobal('customElements', {
  get: () => undefined,
  define: (_name: string, constructor: new () => TestTab) => {
    registeredTab = constructor
  },
})
vi.stubGlobal('document', {
  createElement: () => new registeredTab(),
  createTreeWalker: () => ({}),
  createComment: () => ({}),
})

const { createProjectCommandsSettingsTab } = await import('../../src/lib/project-commands-settings-tab')

const fetchMock = vi.fn()

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status })
}

function createTab(commandDir = ''): TestTab {
  const tab = createProjectCommandsSettingsTab() as unknown as TestTab
  tab.project = { id: 'project-1' }
  tab.commandDir = commandDir
  tab.error = ''
  tab.message = ''
  return tab
}

function postedBody(url: string) {
  const call = fetchMock.mock.calls.find(([requestUrl]) => requestUrl === url)
  expect(call).toBeDefined()
  const init = call![1] as RequestInit
  expect(init.method).toBe('POST')
  return JSON.parse(String(init.body))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => jsonResponse({ ok: true, commands: [] }))
})

describe('project commands settings tab openCommandDir', () => {
  it('opens the first configured command directory', async () => {
    const tab = createTab('custom/commands\nother')

    await tab.openCommandDir()

    expect(postedBody('/api/project/open-path')).toEqual({ path: 'custom/commands', projectId: 'project-1' })
    expect(tab.error).toBe('')
  })

  it('skips blank lines and trims the resolved path', async () => {
    const tab = createTab('\r\n  custom/commands  \nother')

    await tab.openCommandDir()

    expect(postedBody('/api/project/open-path')).toEqual({ path: 'custom/commands', projectId: 'project-1' })
  })

  it('falls back to .ai/commands when commandDir is empty or blank', async () => {
    for (const commandDir of ['', '   \n\t\n']) {
      fetchMock.mockClear()
      const tab = createTab(commandDir)

      await tab.openCommandDir()

      expect(postedBody('/api/project/open-path')).toEqual({ path: '.ai/commands', projectId: 'project-1' })
    }
  })
})

describe('project commands settings tab createCommand', () => {
  it('does nothing when the prompt is cancelled', async () => {
    const tab = createTab('custom/commands')
    promptDialogMocks.showPrompt.mockResolvedValueOnce(null)

    await tab.createCommand()

    expect(promptDialogMocks.showPrompt).toHaveBeenCalledOnce()
    expect(promptDialogMocks.showPrompt).toHaveBeenCalledWith({
      title: 'newCommandPrompt',
      placeholder: 'newCommandNamePlaceholder',
      confirmLabel: 'createCommand',
      cancelLabel: 'cancel',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(tab.message).toBe('')
    expect(tab.error).toBe('')
  })

  it('posts the trimmed name with the project id and shows the created message', async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (url === '/api/project/command') return jsonResponse({ ok: true, name: 'my-command' })
      return jsonResponse({ commands: [] })
    })
    const tab = createTab('custom/commands')
    promptDialogMocks.showPrompt.mockResolvedValueOnce('my-command')

    await tab.createCommand()

    expect(postedBody('/api/project/command')).toEqual({ name: 'my-command', projectId: 'project-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/project/commands?projectId=project-1',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(tab.message).toBe('commandCreated')
    expect(tab.error).toBe('')
  })

  it('shows the already-exists error without reloading commands', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: false, reason: 'exists', name: 'my-command' }))
    const tab = createTab('custom/commands')
    promptDialogMocks.showPrompt.mockResolvedValueOnce('my-command')

    await tab.createCommand()

    expect(tab.error).toBe('commandAlreadyExists')
    expect(tab.message).toBe('')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the invalid-name error for other failures', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: false, reason: 'invalid' }))
    const tab = createTab('custom/commands')
    promptDialogMocks.showPrompt.mockResolvedValueOnce('My Command!')

    await tab.createCommand()

    expect(postedBody('/api/project/command')).toEqual({ name: 'My Command!', projectId: 'project-1' })
    expect(tab.error).toBe('invalidCommandName')
  })
})
