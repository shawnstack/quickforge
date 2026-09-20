import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { useChatActions } from '../../src/hooks/useChatActions'
import { DeferredSessionAgent } from '../../src/lib/deferred-session-agent'

/**
 * Regression tests for the project "new chat" blank-session reuse guard.
 *
 * The reusable check in startNewProjectChat must not only compare the UI
 * active project, it must also verify the current DeferredSessionAgent is
 * actually bound to the target project. Otherwise the blank deferred session
 * of a previously opened project is silently reused after adding/switching
 * projects without a reload, and clicking "new chat" on the project row does
 * nothing.
 */

// The hook only uses useCallback; outside a React render we need the raw
// callback implementations.
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
}))

// Keep heavyweight / DOM-touching imports out of the node test environment.
vi.mock('@/lib/pi-chat', () => ({ initializePiStorage: vi.fn() }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showAlert: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

const useChatActionsSource = readFileSync(new URL('../../src/hooks/useChatActions.ts', import.meta.url), 'utf8')

function project(id: string) {
  return { id, name: `Project ${id}`, path: `/workspace/${id}`, lastOpenedAt: '' }
}

function createProjectBlankAgent(projectId: string) {
  return new DeferredSessionAgent({
    scope: 'project',
    project: project(projectId),
    model: { provider: 'custom', id: 'test-model' } as Model<Api>,
    thinkingLevel: 'off',
    yoloMode: false,
    createAgent: vi.fn(),
  })
}

function useChatActionsHarness(options: {
  agent: DeferredSessionAgent
  activeProject: ReturnType<typeof project> | undefined
  chatScope: 'global' | 'project'
}) {
  const startDeferredSession = vi.fn(async () => {})
  const switchActiveProject = vi.fn(async (projectId: string) => project(projectId))
  const actions = useChatActions({
    storageRef: { current: null },
    activeModelRef: { current: { provider: 'custom', id: 'test-model' } },
    activeProjectRef: { current: options.activeProject },
    currentChatScopeRef: { current: options.chatScope },
    currentSessionIdRef: { current: undefined },
    taskMapRef: { current: new Map() },
    agentRef: { current: options.agent },
    startDeferredSession,
    createAgent: vi.fn(),
    syncSessionUI: vi.fn(),
    setCurrentAgentMessages: vi.fn(),
    setChatPanelRevision: vi.fn(),
    refreshSessions: vi.fn(),
    needsModelSetup: false,
    setNeedsModelSetup: vi.fn(),
    switchActiveProject,
    closeWorkspacePage: vi.fn(),
    setRestoredDraft: vi.fn(),
  } as unknown as Parameters<typeof useChatActions>[0])
  return { actions, startDeferredSession, switchActiveProject }
}

describe('project new chat reuse guard', () => {
  beforeEach(() => {
    // Minimal fake window for clearSessionQueryParam in the node environment.
    vi.stubGlobal('window', {
      location: { href: 'http://localhost/?session=abc' },
      history: { replaceState: vi.fn() },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('validates the deferred agent project binding inside the reusable check (source contract)', () => {
    const startNewProjectChatSource = useChatActionsSource.slice(
      useChatActionsSource.indexOf('const startNewProjectChat = useCallback'),
      useChatActionsSource.indexOf('const rollbackFromMessage = useCallback'),
    )
    const instanceofIndex = startNewProjectChatSource.indexOf('currentAgent instanceof DeferredSessionAgent')
    const projectBindingIndex = startNewProjectChatSource.indexOf('currentAgent.project?.id === nextProject.id')

    expect(startNewProjectChatSource).toContain('const reusableBlankSession = matchesCurrentProject')
    expect(projectBindingIndex, 'reusable check must verify the agent project binding').toBeGreaterThan(instanceofIndex)
    expect(projectBindingIndex).toBeLessThan(startNewProjectChatSource.indexOf('if (reusableBlankSession)'))
  })

  it('does not reuse a blank deferred session bound to a different project than the target', async () => {
    const projectC = project('project-c')
    const agent = createProjectBlankAgent('project-b')
    const { actions, startDeferredSession, switchActiveProject } = useChatActionsHarness({
      agent,
      activeProject: projectC,
      chatScope: 'project',
    })

    const result = await actions.startNewProjectChat(projectC)

    expect(result).toBe('created')
    expect(startDeferredSession).toHaveBeenCalledWith({ scope: 'project', project: projectC })
    expect(switchActiveProject).not.toHaveBeenCalled()
  })

  it('still reuses a blank deferred session bound to the same project', async () => {
    const projectC = project('project-c')
    const agent = createProjectBlankAgent('project-c')
    const { actions, startDeferredSession } = useChatActionsHarness({
      agent,
      activeProject: projectC,
      chatScope: 'project',
    })

    const result = await actions.startNewProjectChat(projectC)

    expect(result).toBe('reused')
    expect(startDeferredSession).not.toHaveBeenCalled()
  })
})
