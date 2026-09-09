import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGitStatus, stageGitFile } from '../../src/components/workspace/workspace-api'

const apiSource = readFileSync(new URL('../../src/components/workspace/workspace-api.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const panelHostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')

function stubPendingFetch() {
  const calls: { url: string; signal: AbortSignal | undefined }[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { signal?: AbortSignal }) => {
    calls.push({ url, signal: init?.signal })
    return new Promise<never>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
  }))
  return calls
}

/** 可控 fetch：只在显式 resolve 或请求 signal abort 时结算，用于观察共享请求的存活。 */
function stubControllableFetch() {
  const calls: { url: string; signal: AbortSignal | undefined }[] = []
  const deferred: { resolve?: (response: Response) => void } = {}
  vi.stubGlobal('fetch', vi.fn((url: string, init?: { signal?: AbortSignal }) => {
    calls.push({ url, signal: init?.signal })
    return new Promise<Response>((resolve, reject) => {
      deferred.resolve = resolve
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })
  }))
  return { calls, deferred }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('getGitStatus connection-pool guard', () => {
  it('aborts the request signal after the 20s timeout so the HTTP connection is released', async () => {
    vi.useFakeTimers()
    const calls = stubPendingFetch()
    const rejection = getGitStatus('project-a').catch((error: unknown) => error)

    expect(calls[0]?.url).toBe('/api/git/status?projectId=project-a')
    const signal = calls[0]?.signal
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(19_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)

    const error = await rejection
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('TimeoutError')
  })

  it('propagates an external caller abort immediately', async () => {
    vi.useFakeTimers()
    const calls = stubPendingFetch()
    const external = new AbortController()
    const rejection = getGitStatus('project-a', external.signal).catch((error: unknown) => error)

    const signal = calls[0]?.signal
    expect(signal?.aborted).toBe(false)
    external.abort()
    expect(signal?.aborted).toBe(true)

    const error = await rejection
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })

  it('hands fetch an already aborted signal when the caller aborted beforehand', () => {
    vi.useFakeTimers()
    const calls = stubPendingFetch()
    const external = new AbortController()
    external.abort()
    void getGitStatus('project-a', external.signal).catch(() => undefined)
    expect(calls[0]?.signal?.aborted).toBe(true)
  })

  it('clears the timeout once the request settles successfully', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ isGitRepository: false, files: [] }))))
    await getGitStatus('project-a')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('getGitStatus in-flight deduplication and cache', () => {
  it('shares one in-flight request between concurrent callers for the same project', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ isGitRepository: false, files: [] })))
    vi.stubGlobal('fetch', fetchMock)

    const [first, second] = await Promise.all([getGitStatus('project-b'), getGitStatus('project-b')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first).toEqual({ isGitRepository: false, files: [] })
    expect(second).toEqual(first)
  })

  it('keeps the shared request alive when only one caller aborts', async () => {
    const { calls, deferred } = stubControllableFetch()
    const firstController = new AbortController()
    const first = getGitStatus('project-c', firstController.signal).catch((error: unknown) => error)
    const second = getGitStatus('project-c')
    expect(calls).toHaveLength(1)

    firstController.abort()
    expect(calls[0]?.signal?.aborted).toBe(false)
    expect(await first).toBeInstanceOf(DOMException)

    deferred.resolve?.(new Response(JSON.stringify({ isGitRepository: true, files: [], branch: 'main' })))
    expect(await second).toEqual({ isGitRepository: true, files: [], branch: 'main' })
  })

  it('aborts the shared request only after the last waiter leaves', async () => {
    const { calls } = stubControllableFetch()
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = getGitStatus('project-d', firstController.signal).catch((error: unknown) => error)
    const second = getGitStatus('project-d', secondController.signal).catch((error: unknown) => error)

    firstController.abort()
    expect(calls[0]?.signal?.aborted).toBe(false)
    secondController.abort()
    expect(calls[0]?.signal?.aborted).toBe(true)

    expect(await first).toBeInstanceOf(DOMException)
    expect(await second).toBeInstanceOf(DOMException)
  })

  it('reuses a short-lived cached result and bypasses it for forced refreshes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ isGitRepository: false, files: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await getGitStatus('project-e')
    await getGitStatus('project-e')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await getGitStatus('project-e', undefined, { force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('requests light=1 and keeps light results out of the full cache', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ isGitRepository: true, branch: 'dev', counts: { total: 1 }, files: [] }))
    }))

    await getGitStatus('project-light', undefined, { light: true })
    await getGitStatus('project-light', undefined, { light: true })
    await getGitStatus('project-light')

    expect(urls).toEqual([
      '/api/git/status?projectId=project-light&light=1',
      '/api/git/status?projectId=project-light',
    ])
  })

  it('drops the cached result as soon as a git write operation starts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ isGitRepository: false, files: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await getGitStatus('project-f')
    await stageGitFile('project-f', 'src/file.ts')
    await getGitStatus('project-f')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('git status callers release connections', () => {
  it('workspace-api bounds git status with a 20s timeout composition', () => {
    expect(apiSource).toContain('GIT_STATUS_TIMEOUT_MS = 20_000')
    expect(apiSource).toContain('composeGitStatusSignal')
  })

  it('App title refresh aborts the previous request and passes its own signal', () => {
    expect(appSource).toContain('titleGitAbortRef.current?.abort()\n    const controller = new AbortController()')
    // 工具执行结束后的刷新绕过 1s 结果缓存（force）；titleGitStatus 同时供
    // GitToolsPinnedSummary / GitCommitPushDialog 消费，需要 files[].additions/deletions，故走 full。
    expect(appSource).toContain('getGitStatus(projectId, controller.signal, { force })')
    expect(appSource).toContain('if (controller.signal.aborted) return undefined')
  })

  it('App aborts the in-flight title request when the project scope changes', () => {
    expect(appSource).toContain('titleGitAbortRef.current?.abort()\n    titleGitAbortRef.current = null')
  })

  it('App reuses the cached project list when the tab becomes visible again', () => {
    expect(appSource).toContain('onProjectsChanged: () => { loadProject() }')
  })

  it('ChatPanelHost aborts its git status request on cleanup', () => {
    expect(panelHostSource).toContain('getGitStatus(gitProjectId, controller.signal, { light: true })')
    expect(panelHostSource).toContain('disposed = true\n      controller.abort()')
  })
})
