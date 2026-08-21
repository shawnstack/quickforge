import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react', () => ({
  useCallback<T>(callback: T) {
    return callback
  },
}))
vi.mock('@/lib/pi-chat', () => ({ initializePiStorage: vi.fn() }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/prompt-dialog', () => ({ showPrompt: vi.fn() }))
vi.mock('@/lib/agent-task-retention', () => ({ disposeAgentTask: vi.fn() }))

import { useSessionActions } from '../../src/hooks/useSessionActions'

function useActionsHarness(metadata: Record<string, unknown>) {
  const set = vi.fn(async () => undefined)
  const refreshSessions = vi.fn(async () => undefined)
  const storage = {
    backend: { set },
    sessions: {
      getMetadata: vi.fn(async () => metadata),
    },
  }
  const actions = useSessionActions({
    storageRef: { current: storage } as never,
    taskMapRef: { current: new Map() } as never,
    currentSessionIdRef: { current: null } as never,
    loadAgentSession: vi.fn() as never,
    setCurrentTitleRef: vi.fn(),
    refreshSessions,
    removeSession: vi.fn(),
    notifySessionsChanged: vi.fn(),
    updateSessionTitle: vi.fn(),
    closeWorkspacePage: vi.fn(),
    startNewGlobalChat: vi.fn(async () => undefined),
  })
  return { actions, set, refreshSessions }
}

function extractTranspiledFunction(source: string, name: string): string {
  const output = ts.transpileModule(source, {
    fileName: 'archived-conversations-settings-tab.ts',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
    },
  }).outputText
  const sourceFile = ts.createSourceFile('archived-conversations-settings-tab.js', output, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS)
  const fn = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!fn) throw new Error(`Transpiled ${name} not found`)
  return output.slice(fn.getStart(sourceFile), fn.end)
}

describe('session state clear actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serializes pinnedAt:null when unpinning instead of omitting the field', async () => {
    const { actions, set, refreshSessions } = useActionsHarness({
      id: 'session-1',
      title: 'Pinned',
      pinnedAt: '2026-08-20T00:00:00.000Z',
    })

    await actions.togglePinSession('session-1')

    expect(set).toHaveBeenCalledWith('sessions-metadata', 'session-1', expect.objectContaining({ pinnedAt: null }))
    const payload = set.mock.calls[0][2]
    expect(JSON.parse(JSON.stringify(payload))).toMatchObject({ pinnedAt: null })
    expect(refreshSessions).toHaveBeenCalledWith({ broadcast: true })
  })

  it('serializes archivedAt:null for both session and metadata restore payloads', () => {
    const source = readFileSync('src/lib/archived-conversations-settings-tab.ts', 'utf8')
    const functionSource = extractTranspiledFunction(source, 'withClearedArchivedAt')
    const withClearedArchivedAt = Function(`"use strict"; ${functionSource}; return withClearedArchivedAt`)() as (
      value: Record<string, unknown>,
    ) => Record<string, unknown>

    const sessionPayload = withClearedArchivedAt({ id: 'session-1', archivedAt: '2026-08-20T00:00:00.000Z' })
    const metadataPayload = withClearedArchivedAt({ id: 'session-1', archivedAt: '2026-08-20T00:00:00.000Z', messageCount: 1 })

    expect(JSON.parse(JSON.stringify(sessionPayload))).toMatchObject({ archivedAt: null })
    expect(JSON.parse(JSON.stringify(metadataPayload))).toMatchObject({ archivedAt: null })
    expect(source).toContain('storage.sessions.save(withClearedArchivedAt(session), withClearedArchivedAt(metadata))')
    expect(source).not.toContain('delete next.archivedAt')
  })
})
