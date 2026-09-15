import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HookLifecycle, deferred, flushPromises } from './helpers/hook-lifecycle'
import { originalInspectorDomain } from './helpers/inspector-domain-fixture'
import { createWorkspaceInspectorProjectGuard } from '../../src/components/workspace/workspace-inspector-tabs'
import { shouldLoadWorkspaceGit } from '../../src/components/workspace/workspace-inspector-on-demand-state'
import type { GitChangedFile, GitFileDiffResponse } from '../../src/components/workspace/workspace-types'
const api = vi.hoisted(() => ({ getGitStatus: vi.fn(), getGitFileDiff: vi.fn(), stageGitFile: vi.fn(), stageAllGitChanges: vi.fn(), unstageGitFile: vi.fn(), unstageAllGitChanges: vi.fn(), restoreGitFile: vi.fn(), restoreAllGitChanges: vi.fn() }))
const dialog = vi.hoisted(() => ({ showAlert: vi.fn(), showConfirm: vi.fn() }))
vi.mock('react', async () => (await import('./helpers/hook-lifecycle')).hookRuntime)
vi.mock('@/components/ui/confirm-dialog', () => dialog)
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/components/workspace/workspace-api', () => api)
import { useInspectorGitState, useInspectorGit, useInspectorReviewSelection, useInspectorGitDemand } from '../../src/components/workspace/useInspectorGit'
function useCurrentGit(props: ReturnType<typeof inputs>) {
  const state = useInspectorGitState()
  const actions = useInspectorGit({ ...state, ...props, projectId: props.project.id })
  useInspectorReviewSelection({ ...state, reviewFiles: actions.reviewFiles })
  useInspectorGitDemand({ ...state, projectId: props.project.id, activePanelTab: { id: 'tab', kind: props.activePanelTab.kind as 'files' | 'review' }, loadGitStatus: actions.loadGitStatus })
  return { ...state, ...actions }
}
const useGit = (process.env.QF_INSPECTOR_BASELINE_TEST === '1'
  ? originalInspectorDomain(readFileSync('.goal-runtime-refactor-baseline/Inspector-before-split.tsx', 'utf8'),
    [[694, 698], [700, 705], [728, 728], [764, 764], [770, 770], [798, 798], [825, 838], [843, 843], [847, 921], [949, 956], [1174, 1194], [1277, 1280], [1653, 1691]], [[321, 323]],
    { ...api, ...dialog, shouldLoadWorkspaceGit, t: (key: string) => key })
  : useCurrentGit) as (props: ReturnType<typeof inputs>) => GitResult
type GitResult = {
  changes: GitChangedFile[]; reviewFiles: GitChangedFile[]; gitLoadStatus: string; gitError?: string; pendingGitAction?: { action: string }
  expandedDiff?: GitFileDiffResponse; expandedDiffPath?: string; expandedDiffLoading: boolean; expandedDiffNoChanges: boolean
  loadGitStatus: (force?: boolean) => Promise<void>; toggleReviewDiff: (path: string) => Promise<void>; setReviewFilter: (value: 'all' | 'last' | 'staged') => void
  handleStageFile: (file: GitChangedFile) => Promise<void>; handleRestoreAll: () => Promise<void>
}
function inputs() { const guard = createWorkspaceInspectorProjectGuard(); guard.token('p'); return { project: { id: 'p' }, projectGuardRef: { current: guard }, activePanelTab: { kind: 'files' }, lastRunPaths: new Set(['a']) } }
const file = (path: string): GitChangedFile => ({ path, status: 'modified', staged: false, unstaged: true })
const status = (path: string) => ({ files: [file(path)], branch: 'main', isGitRepository: true })
let lifecycle: HookLifecycle
beforeEach(() => { lifecycle = new HookLifecycle(); Object.values(api).forEach(mock => mock.mockReset()); Object.values(dialog).forEach(mock => mock.mockReset()); api.getGitStatus.mockResolvedValue(status('a')) })
afterEach(() => lifecycle.unmount())

it('loads only upon review activation and does not reload loaded status or overlap nonforce requests', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useGit(props))
  render(); expect(api.getGitStatus).not.toHaveBeenCalled()
  const request = deferred<unknown>(); api.getGitStatus.mockReturnValueOnce(request.promise)
  props.activePanelTab.kind = 'review'; render(); expect(api.getGitStatus).toHaveBeenCalledOnce()
  await render().loadGitStatus(); expect(api.getGitStatus).toHaveBeenCalledOnce()
  request.resolve(status('a')); await flushPromises(); expect(render().gitLoadStatus).toBe('loaded')
  render(); expect(api.getGitStatus).toHaveBeenCalledOnce()
  expect(api.getGitStatus.mock.calls[0][2]).toEqual({ force: false })
})
it('force aborts an in-flight request and ignores old success and stale project failure', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useGit(props))
  const old = deferred<unknown>(); const fresh = deferred<unknown>(); api.getGitStatus.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const first = render().loadGitStatus(); const second = render().loadGitStatus(true)
  expect(api.getGitStatus.mock.calls[0][1].aborted).toBe(true)
  expect(api.getGitStatus.mock.calls[1][2]).toEqual({ force: true })
  fresh.resolve(status('new')); await second; old.resolve(status('old')); await first
  expect(render().changes[0].path).toBe('new')
  const stale = deferred<unknown>(); api.getGitStatus.mockReturnValueOnce(stale.promise)
  const pending = render().loadGitStatus(true); props.projectGuardRef.current.invalidate(); stale.reject(new Error('old project'))
  await pending; expect(render().gitError).toBeUndefined()
})
it('retains error for explicit retry rather than auto-looping, then recovers', async () => {
  const props = inputs(); props.activePanelTab.kind = 'review'; api.getGitStatus.mockRejectedValueOnce(new Error('offline'))
  const render = () => lifecycle.render(() => useGit(props)); render(); await flushPromises()
  expect(render().gitLoadStatus).toBe('error'); render(); expect(api.getGitStatus).toHaveBeenCalledOnce()
  await render().loadGitStatus(true); expect(render().gitLoadStatus).toBe('loaded'); expect(render().gitError).toBeUndefined()
})
it('guards inline diff against old completion, collapses selected diff, and treats no-changes as an empty state', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useGit(props))
  api.getGitStatus.mockResolvedValue({ ...status('a'), files: [file('a'), file('b')] }); await render().loadGitStatus()
  const old = deferred<unknown>(); const current = deferred<unknown>(); api.getGitFileDiff.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  const one = render().toggleReviewDiff('a'); const two = render().toggleReviewDiff('b')
  current.reject(new Error('File has no working tree changes')); await two; old.resolve({ path: 'a' }); await one
  expect(render().expandedDiffPath).toBe('b'); expect(render().expandedDiffNoChanges).toBe(true); expect(render().expandedDiff).toBeUndefined()
  await render().toggleReviewDiff('b'); expect(render().expandedDiffPath).toBeUndefined(); expect(render().expandedDiffLoading).toBe(false)
})
it('filters review changes, exposes pending actions, applies status and honors destructive confirmation cancellation', async () => {
  const props = inputs(); const render = () => lifecycle.render(() => useGit(props))
  const operation = deferred<unknown>(); api.stageGitFile.mockReturnValueOnce(operation.promise)
  const pending = render().handleStageFile(file('a')); expect(render().pendingGitAction?.action).toBe('stage')
  operation.resolve({ ...status('a'), files: [{ ...file('a'), staged: true, unstaged: false }, file('b')] }); await pending
  expect(render().pendingGitAction).toBeUndefined(); expect(render().reviewFiles.map(f => f.path)).toEqual(['b'])
  render().setReviewFilter('staged'); expect(render().reviewFiles.map(f => f.path)).toEqual(['a'])
  render().setReviewFilter('last'); expect(render().reviewFiles.map(f => f.path)).toEqual(['a'])
  dialog.showConfirm.mockResolvedValueOnce(false); await render().handleRestoreAll(); expect(api.restoreAllGitChanges).not.toHaveBeenCalled()
  dialog.showConfirm.mockResolvedValueOnce(true); api.restoreAllGitChanges.mockRejectedValueOnce(new Error('restore failed')); await render().handleRestoreAll()
  expect(dialog.showAlert).toHaveBeenCalledWith('restore failed'); expect(render().pendingGitAction).toBeUndefined()
})
