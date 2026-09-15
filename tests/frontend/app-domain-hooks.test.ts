import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { originalDomain } from './helpers/app-domain-fixture'
import { scheduleAfterPaint } from '../../src/lib/schedule-after-paint'
import { isCurrentProjectRequest } from '../../src/lib/project-request-guard'
import { shouldRefreshTitleGitStatusOnToolEnd } from '../../src/lib/title-git-status-refresh'
import { HookLifecycle, deferred, flushPromises } from './helpers/hook-lifecycle'
import { useAppTerminal, useAppTerminalState } from '../../src/hooks/useAppTerminal'
import { useAppGit, useAppGitMenu, useAppGitState } from '../../src/hooks/useAppGit'
import { useAppLoadingState, useAppStartupMinimum, useAppLoadingEffects, useAppLoadingTransitions, useAppStartupExit } from '../../src/hooks/useAppLoadingTransitions'

const { showAlert, showConfirm, getGitStatus, checkoutGitBranch, logger, listeners, subscribeToAgentEvents } = vi.hoisted(() => {
  const listeners = new Set<(event: Record<string, unknown>) => void>()
  return {
    showAlert: vi.fn(), showConfirm: vi.fn(), getGitStatus: vi.fn(), checkoutGitBranch: vi.fn(),
    logger: { warn: vi.fn(), error: vi.fn() }, listeners,
    subscribeToAgentEvents: vi.fn((listener: (event: Record<string, unknown>) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
})
vi.mock('react', async () => (await import('./helpers/hook-lifecycle')).hookRuntime)
vi.mock('@/components/ui/confirm-dialog', () => ({ showAlert, showConfirm }))
vi.mock('@/components/workspace/workspace-api', () => ({ getGitStatus, checkoutGitBranch }))
vi.mock('@/lib/logger', () => ({ logger }))
vi.mock('@/lib/server-agent', () => ({ subscribeToAgentEvents }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

// Opt-in local audit replays the pre-move source. CI always tests actual hooks;
// it never requires the ignored baseline snapshot or a copy of the implementation.
const baseline = process.env.QF_APP_BASELINE_TEST === '1'
  ? readFileSync('.goal-runtime-refactor-baseline/App-before-split.tsx', 'utf8')
  : null
const before = baseline ? Object.fromEntries((['terminal', 'git', 'loading'] as const).map((domain) => [domain, originalDomain(baseline, domain, {
  showAlert, showConfirm, getGitStatus, checkoutGitBranch, logger, subscribeToAgentEvents,
  scheduleAfterPaint, isCurrentProjectRequest, shouldRefreshTitleGitStatusOnToolEnd,
  t: (key: string) => key,
})])) : null

// After extraction the renderer calls the real phase hooks (including lifecycle effects).
function useCurrentTerminalFixture(input: ReturnType<typeof props>) {
  const state = useAppTerminalState()
  return { ...state, ...useAppTerminal({ ...state, ...input }) }
}
function useCurrentGitFixture(input: ReturnType<typeof props>) {
  const state = useAppGitState()
  const actions = useAppGit({ ...state, ...input, projectId: input.agentManager.currentToolProject.id, currentSessionId: input.agentManager.currentSessionId })
  useAppGitMenu(state)
  return { ...state, ...actions }
}
function useCurrentLoadingFixture(input: ReturnType<typeof props>) {
  const state = useAppLoadingState()
  useAppStartupMinimum(state)
  useAppLoadingEffects({ ...state, loadingSessionId: input.agentManager.loadingSessionId })
  const actions = useAppLoadingTransitions({ ...state, ...input })
  const startupReady = input.ready && state.startupSplashDone && Boolean(input.agentManager.agent || input.needsModelSetup)
  useAppStartupExit({ ...state, startupReady })
  return { ...state, ...actions, startupReady }
}

const useTerminalFixture = (before?.terminal ?? useCurrentTerminalFixture) as typeof useCurrentTerminalFixture
const useGitFixture = (before?.git ?? useCurrentGitFixture) as typeof useCurrentGitFixture
const useLoadingFixture = (before?.loading ?? useCurrentLoadingFixture) as typeof useCurrentLoadingFixture

let lifecycle: HookLifecycle
let target: EventTarget
let frames: Map<number, FrameRequestCallback>
let frameId: number
function frame() {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(0))
}
function emit(command: unknown, extra: Record<string, unknown> = {}) {
  const event = new Event('quickforge:execute-markdown-command')
  Object.defineProperty(event, 'detail', { value: { command, ...extra } })
  target.dispatchEvent(event)
}
function props() {
  return {
    remoteClient: false, setArtifactPreviewOpen: vi.fn(),
    agentManager: { currentToolProject: { id: 'project-a' }, currentSessionId: 'session-a', loadingSessionId: undefined as string | undefined, agent: {} },
    currentToolProjectIdRef: { current: 'project-a' }, currentSessionIdRef: { current: 'session-a' },
    addToast: vi.fn(), ready: true, needsModelSetup: false,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  getGitStatus.mockReset().mockResolvedValue({ branch: 'main', files: [] })
  checkoutGitBranch.mockReset()
  showConfirm.mockReset()
  listeners.clear()
  lifecycle = new HookLifecycle()
  target = new EventTarget()
  frames = new Map()
  frameId = 0
  vi.stubGlobal('window', {
    setTimeout, clearTimeout,
    addEventListener: vi.fn(target.addEventListener.bind(target)),
    removeEventListener: vi.fn(target.removeEventListener.bind(target)),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
})
afterEach(() => {
  lifecycle.unmount()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('App terminal lifecycle', () => {
  it('rejects remote events before even reading command, and removes the listener', () => {
    const input = { ...props(), remoteClient: true }
    lifecycle.render(() => useTerminalFixture(input))
    const event = new Event('quickforge:execute-markdown-command')
    Object.defineProperty(event, 'detail', { get: () => { throw new Error('must not read remote detail') } })
    target.dispatchEvent(event)
    expect(showAlert).toHaveBeenCalledWith('远程客户端不能使用服务端终端')
    lifecycle.unmount()
    target.dispatchEvent(event)
    expect(showAlert).toHaveBeenCalledTimes(1)
  })

  it('ignores empty commands, keeps stable listener, and old acknowledgements cannot clear new commands', () => {
    const input = props()
    const render = () => lifecycle.render(() => useTerminalFixture(input))
    render()
    emit('  ')
    emit(3)
    expect(render().pendingTerminalCommand).toBeNull()
    emit('  echo one  ')
    const first = render()
    expect(first.pendingTerminalCommand).toEqual({ id: 1, command: 'echo one', execute: true })
    expect(first.terminalDockOpen).toBe(true)
    expect(input.setArtifactPreviewOpen).toHaveBeenCalledWith(false)
    emit('echo two')
    first.handlePendingTerminalCommandHandled(1)
    expect(render().pendingTerminalCommand.id).toBe(2)
    first.handlePendingTerminalCommandHandled(2)
    expect(render().pendingTerminalCommand).toBeNull()
    expect(window.addEventListener).toHaveBeenCalledTimes(1)
  })

  it.each([{ confirm: true }, { dangerous: true }])('awaits confirmation and honors cancellation %j', async (flags) => {
    const input = props()
    const render = () => lifecycle.render(() => useTerminalFixture(input))
    render()
    const confirmation = deferred<boolean>()
    showConfirm.mockReturnValueOnce(confirmation.promise)
    emit('rm file', flags)
    expect(render().pendingTerminalCommand).toBeNull()
    expect(showConfirm).toHaveBeenCalledWith(expect.objectContaining({ variant: 'dangerous' in flags ? 'destructive' : 'default' }))
    confirmation.resolve(false)
    await flushPromises()
    expect(render().pendingTerminalCommand).toBeNull()
    showConfirm.mockResolvedValueOnce(true)
    emit('echo yes', flags)
    await flushPromises()
    expect(render().pendingTerminalCommand.command).toBe('echo yes')
  })

  it('preserves already-confirming command behavior across remote rerender and reports confirmation errors', async () => {
    const input = props()
    const render = () => lifecycle.render(() => useTerminalFixture(input))
    render()
    const confirmation = deferred<boolean>()
    showConfirm.mockReturnValueOnce(confirmation.promise)
    emit('echo pending', { confirm: true })
    input.remoteClient = true
    render()
    confirmation.resolve(true)
    await flushPromises()
    expect(render().pendingTerminalCommand.command).toBe('echo pending')
    input.remoteClient = false
    render()
    showConfirm.mockRejectedValueOnce(new Error('dialog failed'))
    emit('bad', { dangerous: true })
    await flushPromises()
    expect(logger.error).toHaveBeenCalled()
    expect(showAlert).toHaveBeenCalledWith('dialog failed')
  })
})

describe('App Git lifecycle', () => {
  it('loads full status at 0ms, aborts superseded requests and ignores stale completion', async () => {
    const input = props()
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    getGitStatus.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const render = () => lifecycle.render(() => useGitFixture(input))
    let state = render()
    expect(getGitStatus).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(getGitStatus.mock.calls[0][2]).toEqual({ force: false })
    const refresh = state.refreshTitleGitStatus(true)
    expect(getGitStatus.mock.calls[0][1].aborted).toBe(true)
    expect(getGitStatus.mock.calls[1][2]).toEqual({ force: true })
    second.resolve({ branch: 'new', files: [] })
    await refresh
    first.resolve({ branch: 'old' })
    await flushPromises()
    state = render()
    expect(state.titleGitStatus.branch).toBe('new')
    render()
    expect(subscribeToAgentEvents).toHaveBeenCalledTimes(1)
  })

  it('ignores project-stale refresh and checkout and retains captured session for checkout toast', async () => {
    const input = props()
    const render = () => lifecycle.render(() => useGitFixture(input))
    const initial = deferred<unknown>()
    getGitStatus.mockReturnValueOnce(initial.promise)
    const old = render()
    vi.advanceTimersByTime(0)
    input.currentToolProjectIdRef.current = 'project-b'
    initial.resolve({ branch: 'stale' })
    await flushPromises()
    expect(render().titleGitStatus).toBeUndefined()
    const staleCheckout = deferred<unknown>()
    checkoutGitBranch.mockReturnValueOnce(staleCheckout.promise)
    const stale = old.handleCheckoutTitleBranch('old')
    staleCheckout.resolve({ branch: 'old' })
    await stale
    expect(input.addToast).not.toHaveBeenCalled()
    input.currentToolProjectIdRef.current = 'project-a'
    const checkout = deferred<unknown>()
    checkoutGitBranch.mockReturnValueOnce(checkout.promise)
    const pending = render().handleCheckoutTitleBranch('feature')
    input.agentManager = { ...input.agentManager, currentSessionId: 'session-b' }
    render()
    checkout.resolve({ branch: 'feature' })
    await pending
    expect(input.addToast).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a', message: 'feature' }))
  })

  it('debounces relevant tool events 400ms with force and cancels timer/subscription on cleanup', async () => {
    const input = props()
    lifecycle.render(() => useGitFixture(input))
    vi.advanceTimersByTime(0)
    await flushPromises()
    const emitTool = () => listeners.forEach((listener) => listener({ type: 'tool_execution_end', sessionId: 'session-a', toolName: 'write_file' }))
    emitTool()
    vi.advanceTimersByTime(399)
    expect(getGitStatus).toHaveBeenCalledTimes(1)
    emitTool()
    vi.advanceTimersByTime(399)
    expect(getGitStatus).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(getGitStatus.mock.calls[1][2]).toEqual({ force: true })
    emitTool()
    lifecycle.unmount()
    expect(listeners.size).toBe(0)
    vi.advanceTimersByTime(500)
    expect(getGitStatus).toHaveBeenCalledTimes(2)
  })

  it('closes branch menu on click/blur, unregisters on close and unmount', () => {
    const input = props()
    const render = () => lifecycle.render(() => useGitFixture(input))
    render().setBranchMenuOpen(true)
    render()
    target.dispatchEvent(new Event('click'))
    expect(render().branchMenuOpen).toBe(false)
    expect(window.removeEventListener).toHaveBeenCalledTimes(2)
    render().setBranchMenuOpen(true)
    render()
    target.dispatchEvent(new Event('blur'))
    expect(render().branchMenuOpen).toBe(false)
    render().setBranchMenuOpen(true)
    render()
    lifecycle.unmount()
    expect(window.removeEventListener).toHaveBeenCalledTimes(6)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears failed refresh but checkout reports and rethrows current errors', async () => {
    const input = props()
    const state = lifecycle.render(() => useGitFixture(input))
    const error = new Error('git failed')
    getGitStatus.mockRejectedValueOnce(error)
    await state.refreshTitleGitStatus()
    expect(logger.warn).toHaveBeenCalled()
    checkoutGitBranch.mockRejectedValueOnce(error)
    await expect(state.handleCheckoutTitleBranch('bad')).rejects.toBe(error)
    expect(showAlert).toHaveBeenCalledWith('git failed')
  })
})

describe('App loading transitions lifecycle', () => {
  it('keeps splash for 1350ms, then waits 280ms to exit, cleaning pending timers', () => {
    const input = props()
    const render = () => lifecycle.render(() => useLoadingFixture(input))
    expect(render().startupReady).toBe(false)
    vi.advanceTimersByTime(1349)
    expect(render().startupSplashDone).toBe(false)
    vi.advanceTimersByTime(1)
    expect(render().startupReady).toBe(true)
    vi.advanceTimersByTime(279)
    expect(render().startupSplashExited).toBe(false)
    vi.advanceTimersByTime(1)
    expect(render().startupSplashExited).toBe(true)
    lifecycle.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('loads after two RAFs, rejects old tokens and fades only current ready session after 280ms', async () => {
    const input = props()
    const render = () => lifecycle.render(() => useLoadingFixture(input))
    const oldLoad = deferred<boolean>()
    const load = vi.fn(() => oldLoad.promise)
    render().scheduleSessionLoad('old', load)
    expect(render().visibleLoadingSessionId).toBe('old')
    frame()
    expect(load).not.toHaveBeenCalled()
    frame()
    expect(load).toHaveBeenCalledTimes(1)
    const nextLoad = vi.fn(async () => true)
    render().scheduleSessionLoad('new', nextLoad)
    oldLoad.resolve(false)
    await flushPromises()
    expect(render().visibleLoadingSessionId).toBe('new')
    render().handleSessionInitialRenderReady('old')
    expect(render().renderedLoadingSessionId).toBeUndefined()
    frame(); frame()
    await flushPromises()
    render().handleSessionInitialRenderReady('new')
    render()
    vi.advanceTimersByTime(279)
    expect(render().visibleLoadingSessionId).toBe('new')
    vi.advanceTimersByTime(1)
    expect(render().visibleLoadingSessionId).toBeUndefined()
  })

  it('takes over external loading at 0ms, cancels queued load, and cleans RAF/timers on unmount', () => {
    const input = props()
    const render = () => lifecycle.render(() => useLoadingFixture(input))
    const load = vi.fn(async () => true)
    render().scheduleSessionLoad('queued', load)
    input.agentManager = { ...input.agentManager, loadingSessionId: 'external' }
    expect(render().visibleLoadingSessionId).toBe('queued')
    vi.advanceTimersByTime(0)
    expect(render().visibleLoadingSessionId).toBe('external')
    frame(); frame()
    expect(load).not.toHaveBeenCalled()
    render().scheduleSessionLoad('another', load)
    frame()
    lifecycle.unmount()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('immediately reloads current session and reports render errors without clearing a newer transition', () => {
    const input = props()
    const render = () => lifecycle.render(() => useLoadingFixture(input))
    const load = vi.fn(async () => true)
    render().scheduleSessionLoad('session-a', load)
    expect(load).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    render().beginSessionTransition('new')
    render().handleSessionInitialRenderError('old', new Error('render failed'))
    expect(render().visibleLoadingSessionId).toBe('new')
    expect(input.addToast).toHaveBeenCalledWith({ sessionId: 'old', title: 'conversationLoadFailed', status: 'error' })
    render().handleSessionInitialRenderError('new', new Error('render failed'))
    expect(render().visibleLoadingSessionId).toBeUndefined()
  })
})
