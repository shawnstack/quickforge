import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSkillContent, fetchSkills, saveSkillsSelection } from '../../src/lib/skills-client'

/**
 * skills 域的请求构造层。这里唯一的风险是**地址和请求体拼错**——拼错了
 * 表现是「保存没生效」或「读到了全局的范围」，而界面上看不出差别。
 * 所以断言全部落在 URL 与 body 上，不做等价类猜测。
 */
function mockFetchOnce(payload: unknown, init: { ok?: boolean; status?: number; jsonFails?: boolean } = {}) {
  const response = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: init.jsonFails ? vi.fn().mockRejectedValue(new Error('not json')) : vi.fn().mockResolvedValue(payload),
  }
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the global scope by scope parameter', async () => {
    const payload = { skills: [], selectedSkills: [] }
    const fetchMock = mockFetchOnce(payload)

    await expect(fetchSkills({ scope: 'global' })).resolves.toBe(payload)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/skills?scope=global')
    expect(fetchMock.mock.calls[0][1]).toBeUndefined()
  })

  it('encodes the project id for the project scope', async () => {
    const fetchMock = mockFetchOnce({ skills: [], selectedSkills: [] })

    await fetchSkills({ scope: 'project', projectId: 'p/1 2' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/skills?projectId=p%2F1%202')
  })

  it('sends an empty project id rather than inventing one', async () => {
    const fetchMock = mockFetchOnce({ skills: [], selectedSkills: [] })

    await fetchSkills({ scope: 'project' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/skills?projectId=')
  })
})

describe('fetchSkillContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for a global skill by name', async () => {
    const fetchMock = mockFetchOnce({ instructions: '' })

    await fetchSkillContent({ name: 'skill-creator', scope: 'global' })

    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.pathname).toBe('/api/skills/content')
    expect(url.searchParams.get('name')).toBe('skill-creator')
    expect(url.searchParams.get('scope')).toBe('global')
    expect(url.searchParams.has('projectId')).toBe(false)
  })

  it('adds the project id for a project-scoped skill', async () => {
    const fetchMock = mockFetchOnce({ instructions: '' })

    await fetchSkillContent({ name: 'a b', scope: 'project', projectId: 'proj-1' })

    const url = new URL(fetchMock.mock.calls[0][0], 'http://x')
    expect(url.searchParams.get('name')).toBe('a b')
    expect(url.searchParams.get('scope')).toBe('project')
    expect(url.searchParams.get('projectId')).toBe('proj-1')
  })
})

describe('saveSkillsSelection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PUTs the project scope with both the project id and the selection', async () => {
    const fetchMock = mockFetchOnce({ selectedSkills: ['a'] })

    await saveSkillsSelection({ scope: 'project', projectId: 'proj-1', selectedSkills: ['a', 'b'] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/skills/project')
    expect(init?.method).toBe('PUT')
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ projectId: 'proj-1', selectedSkills: ['a', 'b'] })
  })

  it('PUTs the global scope without a project id', async () => {
    const fetchMock = mockFetchOnce({ selectedSkills: [] })

    await saveSkillsSelection({ scope: 'global', selectedSkills: [] })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/skills/global')
    expect(JSON.parse(String(init?.body))).toEqual({ selectedSkills: [] })
  })
})

describe('error surfacing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the server error message', async () => {
    mockFetchOnce({ error: '技能目录不可写' }, { ok: false, status: 500 })

    await expect(fetchSkills({ scope: 'global' })).rejects.toThrow('技能目录不可写')
  })

  it('falls back to the HTTP status when the body is not JSON', async () => {
    mockFetchOnce(null, { ok: false, status: 502, jsonFails: true })

    await expect(fetchSkills({ scope: 'global' })).rejects.toThrow('HTTP 502')
  })

  it('falls back to the HTTP status when the body carries no error field', async () => {
    mockFetchOnce({}, { ok: false, status: 404 })

    await expect(fetchSkills({ scope: 'global' })).rejects.toThrow('HTTP 404')
  })
})
