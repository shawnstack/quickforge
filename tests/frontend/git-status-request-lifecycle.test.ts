import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGitStatus } from '../../src/components/workspace/workspace-api'

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

describe('git status callers release connections', () => {
  it('workspace-api bounds git status with a 20s timeout composition', () => {
    expect(apiSource).toContain('GIT_STATUS_TIMEOUT_MS = 20_000')
    expect(apiSource).toContain('composeGitStatusSignal')
  })

  it('App title refresh aborts the previous request and passes its own signal', () => {
    expect(appSource).toContain('titleGitAbortRef.current?.abort()\n    const controller = new AbortController()')
    expect(appSource).toContain('getGitStatus(projectId, controller.signal)')
    expect(appSource).toContain('if (controller.signal.aborted) return undefined')
  })

  it('App aborts the in-flight title request when the project scope changes', () => {
    expect(appSource).toContain('titleGitAbortRef.current?.abort()\n    titleGitAbortRef.current = null')
  })

  it('ChatPanelHost aborts its git status request on cleanup', () => {
    expect(panelHostSource).toContain('getGitStatus(gitProjectId, controller.signal)')
    expect(panelHostSource).toContain('disposed = true\n      controller.abort()')
  })
})
