import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  ...(await import('./settings-react-harness')).hooks,
  // The harness only fakes stateful hooks; these two are pure pass-throughs here.
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}))
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  getDateLocale: () => 'zh-CN',
}))
vi.mock('@/components/ui/button', () => ({ Button: (props: Record<string, unknown>) => ({ type: 'Button', props }) }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('../../src/components/settings/tabs/shared', () => ({ SettingsSwitch: () => null, SettingsSelect: () => null }))

import { DreamingSettingsTab } from '../../src/components/dreaming/DreamingSettingsTab'

const PAGE_SIZE = 20

// The first MATCHING titles share "exp" so a search narrows the list to 25
// rows (two pages); the rest exist only to push past one page.
const TOTAL = 45
const MATCHING = 25

const EXPERIENCES = Array.from({ length: TOTAL }, (_, index) => index < MATCHING
  ? { name: `exp-${index + 1}.md`, title: `exp-${index + 1}`, description: '经验', general: true, candidateSkill: false, chars: 50, updatedAt: Date.UTC(2024, 0, 1, 0, index) }
  : { name: `other-${index + 1}.md`, title: `other-${index + 1}`, description: '', general: true, candidateSkill: false, chars: 50, updatedAt: Date.UTC(2024, 0, 1, 0, index) })

const OVERVIEW = {
  settings: {
    enabled: true,
    executeTime: '03:00',
    modelRef: null,
    allowSensitive: false,
    contentLanguage: 'auto',
    nextRunAt: Date.UTC(2024, 0, 3),
    lastRunAt: null,
  },
  model: { effective: 'openai/gpt-4o', source: 'catalog', available: [] },
  running: false,
  lastRun: null,
  counts: { experiences: TOTAL, candidateSkills: 0, runs: 0 },
  experienceIndex: '',
  manual: '',
}

function response(body: unknown) {
  return { ok: true, json: async () => body }
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/dreaming') return response(OVERVIEW)
    // An empty runs page keeps the runs pager out of the way: both lists reuse
    // the same dreamingPrev/dreamingNext button labels.
    if (url.pathname === '/api/dreaming/runs') return response({ runs: [], page: 1, pageSize: 20, total: 0 })
    if (url.pathname === '/api/dreaming/experiences') return response({ experiences: EXPERIENCES, index: '', archived: 0 })
    return response({ ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function render() {
  harness.begin()
  return nodes(DreamingSettingsTab())
}

const buttonNamed = (key: string) => render().find((node) => typeof node.props.onClick === 'function' && text(node) === key)

// Row titles are the only nodes carrying an HTML `title` (the file name).
const rowTitles = () => render()
  .filter((node) => typeof node.props.title === 'string' && (node.props.title as string).endsWith('.md'))
  .map((node) => node.props.title as string)

const pageLabel = () => render().find((node) => text(node).startsWith('dreamingPage:'))

// JSX keeps `aria-label` hyphenated in props, unlike the camelCase attributes.
const searchInput = () => render().find((node) => node.props['aria-label'] === 'dreamingExperienceSearchPlaceholder')

const clickNext = () => { buttonNamed('dreamingNext')?.props.onClick() }

async function mount() {
  const fetchMock = stubFetch()
  render()
  harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(rowTitles()).toHaveLength(PAGE_SIZE))
  return fetchMock
}

beforeEach(() => {
  harness.reset()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('Dreaming experience library pager', () => {
  it('pages the list twenty rows at a time, keeping the short tail page', async () => {
    await mount()

    // First page: full page, label, prev disabled.
    expect(rowTitles()).toEqual(EXPERIENCES.slice(0, PAGE_SIZE).map((entry) => entry.name))
    expect(text(pageLabel())).toBe('dreamingPage:{"page":1,"total":3}')
    expect(buttonNamed('dreamingPrev')?.props.disabled).toBe(true)
    expect(buttonNamed('dreamingNext')?.props.disabled).toBe(false)

    // Second page starts at row 21 — slicing the list, not re-listing page one.
    clickNext()
    expect(rowTitles()[0]).toBe('exp-21.md')
    expect(rowTitles()).toHaveLength(PAGE_SIZE)

    // Third page holds the remaining five rows; nothing from the tail is lost.
    clickNext()
    expect(rowTitles()).toEqual(EXPERIENCES.slice(40).map((entry) => entry.name))
    expect(buttonNamed('dreamingNext')?.props.disabled).toBe(true)
  })

  it('hides the pager when everything fits on one page', async () => {
    await mount()

    // 45 rows span three pages here, so instead shrink the list by searching
    // down to a single row: one page means no pager at all.
    searchInput()?.props.onChange({ currentTarget: { value: 'exp-13' } })
    expect(rowTitles()).toEqual(['exp-13.md'])
    expect(buttonNamed('dreamingNext')).toBeUndefined()
  })

  it('starts a new search from its first page', async () => {
    await mount()

    // Park the reader on page three, then narrow the list to two pages.
    clickNext()
    clickNext()
    expect(text(pageLabel())).toBe('dreamingPage:{"page":3,"total":3}')

    searchInput()?.props.onChange({ currentTarget: { value: 'exp' } })

    // The search result opens on page one of its own pagination, not clamped
    // onto the tail of the old one.
    expect(text(pageLabel())).toBe('dreamingPage:{"page":1,"total":2}')
    expect(rowTitles()).toEqual(EXPERIENCES.slice(0, PAGE_SIZE).map((entry) => entry.name))
  })
})
