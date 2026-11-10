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

const EXPERIENCES = [
  { name: '构建失败先清 dist.md', title: '构建失败先清 dist', description: '构建报错时', general: true, candidateSkill: true, chars: 90, updatedAt: Date.UTC(2024, 0, 1) },
  { name: '改配置前先备份.md', title: '改配置前先备份', description: '', general: false, candidateSkill: false, chars: 60, updatedAt: Date.UTC(2024, 0, 2) },
]

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
  counts: { experiences: EXPERIENCES.length, candidateSkills: 1, runs: 0 },
  experienceIndex: '- 构建失败先清 dist —— 构建报错时',
  manual: '',
}

function response(body: unknown) {
  return { ok: true, json: async () => body }
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/dreaming') return response(OVERVIEW)
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

// The harness does not render, so buttons show up as nodes whose props carry the
// handler; the visible text is what tells them apart.
const buttonNamed = (key: string) => render().find((node) => typeof node.props.onClick === 'function' && text(node) === key)

const openButtons = () => render().filter((node) => typeof node.props.onClick === 'function' && text(node) === 'dreamingExperienceOpen')

async function mount() {
  const fetchMock = stubFetch()
  render()
  harness.effects.forEach((effect) => effect())
  await vi.waitFor(() => expect(openButtons()).toHaveLength(EXPERIENCES.length))
  return fetchMock
}

function callOf(fetchMock: ReturnType<typeof stubFetch>, pathname: string) {
  return fetchMock.mock.calls.find(([input]) => input === pathname) as unknown as [string, RequestInit] | undefined
}

beforeEach(() => {
  harness.reset()
  vi.clearAllMocks()
})

afterEach(() => vi.unstubAllGlobals())

describe('Dreaming experience library open actions', () => {
  it('gives every experience row an open action, matching the working memory list', async () => {
    await mount()

    expect(openButtons()).toHaveLength(EXPERIENCES.length)
    expect(render().filter((node) => node.props.className === 'quickforge-settings-list-item-actions')).toHaveLength(EXPERIENCES.length)
  })

  it('opens one experience by name through the dreaming endpoint', async () => {
    const fetchMock = await mount()

    openButtons()[0]?.props.onClick()
    await vi.waitFor(() => expect(callOf(fetchMock, '/api/dreaming/experiences/open')).toBeDefined())

    const [, init] = callOf(fetchMock, '/api/dreaming/experiences/open') as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ name: '构建失败先清 dist.md' })
  })

  it('opens the whole library folder', async () => {
    const fetchMock = await mount()

    buttonNamed('dreamingExperienceOpenFolder')?.props.onClick()
    await vi.waitFor(() => expect(callOf(fetchMock, '/api/dreaming/experiences/open-folder')).toBeDefined())

    const [, init] = callOf(fetchMock, '/api/dreaming/experiences/open-folder') as [string, RequestInit]
    expect(init.method).toBe('POST')
  })

  it('badges only the project-specific experiences', async () => {
    await mount()

    // Two rows, one `general: false`: exactly one 「特殊」 badge, so a reader knows
    // which entry has to be adapted rather than followed as written.
    expect(render().filter((node) => text(node) === 'dreamingExperienceSpecific')).toHaveLength(1)
  })
})
