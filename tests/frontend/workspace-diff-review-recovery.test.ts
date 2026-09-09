import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGitFileDiff } from '../../src/components/workspace/workspace-api'

// 复现路径：产物卡「审查」打开的 file-diff 请求若永不 settle（连接池排队/服务端极慢），
// reader tab 会永远停在「打开中」且再次点击只会激活死 tab；同时该无超时请求一直占用
// 同源连接池的一个槽位，拖住其他请求。这里锁定 10s 超时与终态 tab 的重拉恢复。
const apiSource = readFileSync(new URL('../../src/components/workspace/workspace-api.ts', import.meta.url), 'utf8')
const inspectorSource = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')

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

describe('getGitFileDiff connection-pool guard', () => {
  it('aborts the request signal after the 10s timeout so the HTTP connection is released', async () => {
    vi.useFakeTimers()
    const calls = stubPendingFetch()
    const rejection = getGitFileDiff('project-a', 'src/deleted.ts').catch((error: unknown) => error)

    expect(calls[0]?.url).toBe('/api/git/file-diff?projectId=project-a&path=src%2Fdeleted.ts')
    const signal = calls[0]?.signal
    expect(signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(9_999)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signal?.aborted).toBe(true)

    const error = await rejection
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('TimeoutError')
  })

  it('clears the timeout once the request settles successfully', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ path: 'src/a.ts', status: 'modified', oldContent: '', newContent: 'x' }))))
    await getGitFileDiff('project-b', 'src/a.ts')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('workspace-api bounds file diff with a 10s timeout', () => {
    expect(apiSource).toContain('GIT_FILE_DIFF_TIMEOUT_MS = 10_000')
  })
})

describe('openDiffTab recovers terminal-state reader tabs', () => {
  it('re-fetches terminal-state reader tabs instead of only re-activating them', () => {
    expect(inspectorSource).toContain('const existingReader = targetTab.readerTabs?.find((tab) => tab.id === id)')
    // 终态（diff/error/noChanges）→ 重置为 loading 重新拉取，再次点「审查」可恢复。
    expect(inspectorSource).toContain('? { ...item, diff: undefined, loading: true, error: undefined, noChanges: undefined } : item')
    expect(inspectorSource).toMatch(/noChanges: undefined \} : item\) \}\)\)\n\s{6}await loadDiffIntoReaderTab\(targetTab\.id, id, path, projectToken\)/)
  })

  it('only activates the reader tab while its request is already in flight', () => {
    expect(inspectorSource).toMatch(/if \(existingReader\.loading\) \{\n\s{8}updatePanelTab\(targetTab\.id, \(tab\) => \(\{ \.\.\.tab, activeReaderTabId: id \}\)\)\n\s{8}return\n\s{6}\}/)
  })

  it('routes both the new-tab path and the retry path through the shared loader', () => {
    expect(inspectorSource).toContain('async function loadDiffIntoReaderTab(panelTabId: string, readerId: string, path: string, projectToken: WorkspaceInspectorProjectToken)')
    expect(inspectorSource).toMatch(/const newTab: ReaderTab = \{ id, mode: 'diff', path, loading: true \}[\s\S]*?await loadDiffIntoReaderTab\(targetTab\.id, id, path, projectToken\)/)
  })
})
