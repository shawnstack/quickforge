import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), ...(await import('./settings-react-harness')).hooks }))
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  getDateLocale: () => 'zh-CN',
}))
vi.mock('@/components/ui/button', () => ({ Button: (props: Record<string, unknown>) => ({ type: 'Button', props }) }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('../../src/components/settings/tabs/shared', () => ({ SettingsSwitch: () => null }))

import { WorkingMemorySettingsTab } from '../../src/components/settings/tabs/WorkingMemorySettingsTab'

const PAGE_SIZE = 20

function response(body: unknown) {
  return { ok: true, json: async () => body }
}

function noteAt(index: number) {
  return { name: `note-${index}.md`, title: `note-${index}`, updatedAt: Date.UTC(2024, 0, index) }
}

function stubFetch(total: number) {
  const fetchMock = vi.fn(async (input: string) => {
    if (input === '/api/working-memory') {
      return response({ enabled: true, path: '~/.quickforge/working-memory' })
    }
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/working-memory/notes') {
      const page = Number(url.searchParams.get('page'))
      const start = (page - 1) * PAGE_SIZE
      const count = Math.max(0, Math.min(PAGE_SIZE, total - start))
      return response({
        notes: Array.from({ length: count }, (_, offset) => noteAt(start + offset + 1)),
        page,
        pageSize: PAGE_SIZE,
        total,
      })
    }
    return response({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function render() {
  harness.begin()
  return nodes(WorkingMemorySettingsTab())
}

const noteTitles = () => render()
  .filter((node) => node.props.className === 'quickforge-working-memory-note-title')
  .map((node) => text(node))

// The harness does not render, so a <Button> shows up as an element whose props
// carry the click handler; the visible text is what tells the buttons apart.
const buttonNamed = (key: string) => render().find((node) => typeof node.props.onClick === 'function' && text(node) === key)

async function mount(total: number) {
  const fetchMock = stubFetch(total)
  render()
  harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(noteTitles().length).toBeGreaterThan(0))
  return fetchMock
}

beforeEach(() => {
  harness.reset()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('Working memory settings note list', () => {
  it('lists the first page with a title and an open action per note', async () => {
    await mount(3)

    expect(noteTitles()).toEqual(['note-1', 'note-2', 'note-3'])
    expect(render().filter((node) => typeof node.props.onClick === 'function' && text(node) === 'workingMemoryNotesOpen')).toHaveLength(3)
    // A single page needs no pager.
    expect(buttonNamed('workingMemoryNotesNext')).toBeUndefined()
  })

  it('asks the server for the next page and shows its notes', async () => {
    const fetchMock = await mount(45)
    expect(render().some((node) => text(node) === 'workingMemoryNotesPage:{"page":1,"total":3}')).toBe(true)

    buttonNamed('workingMemoryNotesNext')?.props.onClick()
    await vi.waitFor(() => expect(noteTitles()[0]).toBe('note-21'))

    expect(fetchMock).toHaveBeenCalledWith('/api/working-memory/notes?page=2&pageSize=20', expect.anything())
    expect(noteTitles()).toHaveLength(20)
  })

  it('opens a note by name through the working memory endpoint', async () => {
    const fetchMock = await mount(1)

    const open = buttonNamed('workingMemoryNotesOpen')
    open?.props.onClick()
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => input === '/api/working-memory/notes/open')).toBe(true)
    })

    const [, init] = fetchMock.mock.calls.find(([input]) => input === '/api/working-memory/notes/open') as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: 'note-1.md' })
  })

  it('opens the notes folder itself from the folder row', async () => {
    const fetchMock = await mount(1)

    buttonNamed('workingMemoryFolderOpen')?.props.onClick()
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => input === '/api/working-memory/open-folder')).toBe(true)
    })

    const [, init] = fetchMock.mock.calls.find(([input]) => input === '/api/working-memory/open-folder') as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('no longer renders the "how notes are written" explainer', async () => {
    await mount(1)
    const rendered = render().map((node) => text(node)).join('\n')
    expect(rendered).not.toContain('workingMemoryNotesStyle')
    expect(rendered).not.toContain('workingMemoryExample')
  })
})
