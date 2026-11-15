import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

// Node-only harness: no renderer, hooks are mocked so the component can be
// re-evaluated to read its current state.
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  ...(await import('./settings-react-harness')).hooks,
  // 该组件用 useMemo 建 projectId → name 的表；假 hook 直接把工厂跑掉即可。
  useMemo: (factory: () => unknown) => factory(),
}))
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  getDateLocale: () => 'zh-CN',
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn(async () => false) }))

const sessionsGet = vi.fn(async (id: string) => ({ id, title: `会话 ${id}`, scope: 'global', messages: [] }))
const sessionsGetMetadata = vi.fn(async (id: string) => ({ id, title: `会话 ${id}`, scope: 'global', archivedAt: '2026-05-02T00:00:00.000Z' }))
const sessionsSave = vi.fn(async () => undefined)
vi.mock('@/storage', () => ({
  getAppStorage: () => ({
    sessions: {
      get: sessionsGet,
      getMetadata: sessionsGetMetadata,
      save: sessionsSave,
      delete: vi.fn(async () => undefined),
    },
  }),
}))

import { ArchivedConversationsSettingsTab } from '../../src/components/settings/tabs/ArchivedConversationsSettingsTab'

type FetchCall = { limit: number; offset: number; archived: string | null }

function sessionAt(index: number) {
  return {
    id: `s-${index}`,
    title: `会话 ${index}`,
    scope: 'global',
    lastModified: new Date(Date.UTC(2026, 4, 30) - index * 60_000).toISOString(),
    archivedAt: '2026-05-02T00:00:00.000Z',
  }
}

// 服务端契约：archived=only 时返回 limit 条 + 该过滤条件下的 total（本机实测 1790）。
function stubArchivedIndex(total: number) {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/project') return { ok: true, json: async () => ({ projects: [] }) }
    if (url.pathname === '/api/storage/sessions-metadata/index/lastModified') {
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      calls.push({ limit, offset, archived: url.searchParams.get('archived') })
      const count = Math.max(0, Math.min(limit, total - offset))
      return {
        ok: true,
        json: async () => ({ values: Array.from({ length: count }, (_, index) => sessionAt(offset + index)), total }),
      }
    }
    throw new Error(`unexpected fetch: ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

const SESSION_ROW_CLASS = 'border-t border-border px-4 py-3 first:border-t-0'

function currentTree(props: { active?: boolean } = { active: true }) {
  harness.begin()
  return nodes(ArchivedConversationsSettingsTab(props))
}

const sessionRows = (props: { active?: boolean } = { active: true }) =>
  currentTree(props).filter((node) => node.props.className === SESSION_ROW_CLASS)

const clickableWithText = (label: string) =>
  currentTree().find((node) => typeof node.props.onClick === 'function' && text(node) === label)

// Loading is a chain of microtask-only promises; one macrotask turn drains it.
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

async function mount(total: number) {
  const stub = stubArchivedIndex(total)
  const tree = currentTree()
  harness.effects.forEach((effect) => effect())
  await flush()
  return { ...stub, tree }
}

beforeEach(() => {
  harness.reset()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('Archived conversations settings tab paging', () => {
  it('loads every archived conversation instead of stopping at one hardcoded page', async () => {
    const { calls } = await mount(1790)

    // 缺陷本体：limit 写死 1000，790 条（约 44%）既看不到也搜不到。
    expect(calls.map((call) => call.offset)).toEqual([0, 500, 1000, 1500])
    expect(calls.every((call) => call.archived === 'only')).toBe(true)
    expect(sessionRows()).toHaveLength(1790)
  })

  it('says how many conversations are not listed when the safety cap is reached', async () => {
    await mount(12_000)

    expect(sessionRows()).toHaveLength(10_000)
    const notice = currentTree().find((node) => text(node).startsWith('archivedSessionsTruncated'))
    expect(text(notice)).toBe('archivedSessionsTruncated:{"loaded":10000,"total":12000}')
  })

  it('finds a conversation that lives past the first loaded page', async () => {
    await mount(1790)

    const input = currentTree().find((node) => node.props.type === 'search')
    input?.props.onChange({ currentTarget: { value: '会话 1500' } })

    const titles = sessionRows().map((node) => text(node))
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('会话 1500')
  })

  it('keeps restore working and drops the restored row from the list', async () => {
    await mount(1790)

    await clickableWithText('restoreSession')?.props.onClick()
    await flush()

    expect(sessionsSave).toHaveBeenCalledTimes(1)
    expect(sessionsSave.mock.calls[0][0]).toMatchObject({ archivedAt: null })
    expect(sessionRows()).toHaveLength(1789)
  })

  it('does not fetch while the tab is inactive', async () => {
    const { fetchMock } = stubArchivedIndex(1790)
    currentTree({ active: false })
    harness.effects.forEach((effect) => effect())
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionRows({ active: false })).toHaveLength(0)
  })
})
