import { useCallback, useEffect, useMemo, useState } from 'react'

export type WorkspaceInspectorOpenStorage = Pick<Storage, 'getItem' | 'setItem'>

export const WORKSPACE_INSPECTOR_OPEN_STORAGE_PREFIX = 'quickforge:workspace-inspector-open:v1:'

function defaultStorage(): WorkspaceInspectorOpenStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function storagePart(value: string) {
  return encodeURIComponent(value)
}

export function workspaceInspectorOpenStorageKey(projectId: string, sessionId: string) {
  return `${WORKSPACE_INSPECTOR_OPEN_STORAGE_PREFIX}${storagePart(projectId)}:${storagePart(sessionId)}`
}

export function readWorkspaceInspectorOpen(
  projectId: string,
  sessionId: string,
  storage: WorkspaceInspectorOpenStorage | undefined = defaultStorage(),
) {
  if (!storage) return false
  try {
    return storage.getItem(workspaceInspectorOpenStorageKey(projectId, sessionId)) === 'true'
  } catch {
    return false
  }
}

export function writeWorkspaceInspectorOpen(
  projectId: string,
  sessionId: string,
  open: boolean,
  storage: WorkspaceInspectorOpenStorage | undefined = defaultStorage(),
) {
  if (!storage) return false
  try {
    storage.setItem(workspaceInspectorOpenStorageKey(projectId, sessionId), String(open))
    return true
  } catch {
    return false
  }
}

export function useWorkspaceInspectorOpenState(projectId: string, sessionId: string | undefined, runtimeScopeId: string) {
  const restoredOpen = useMemo(
    () => sessionId ? readWorkspaceInspectorOpen(projectId, sessionId) : false,
    [projectId, sessionId],
  )
  const scopeKey = `${projectId}:${runtimeScopeId}`
  const [runtimeOpenByScope, setRuntimeOpenByScope] = useState<Record<string, boolean>>({})
  const open = runtimeOpenByScope[scopeKey] ?? restoredOpen
  useEffect(() => {
    if (sessionId) writeWorkspaceInspectorOpen(projectId, sessionId, open)
  }, [open, projectId, sessionId])
  const setOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setRuntimeOpenByScope((current) => {
      const currentOpen = current[scopeKey] ?? restoredOpen
      const nextOpen = typeof next === 'function' ? next(currentOpen) : next
      if (sessionId) writeWorkspaceInspectorOpen(projectId, sessionId, nextOpen)
      return currentOpen === nextOpen && scopeKey in current ? current : { ...current, [scopeKey]: nextOpen }
    })
  }, [projectId, restoredOpen, scopeKey, sessionId])

  return [open, setOpen] as const
}
