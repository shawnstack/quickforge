import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { turnRollbackKey } from '@/lib/tool-artifacts'
import type { ServerAgent } from '@/lib/server-agent'

export type FileRollbackTarget = {
  agent: ServerAgent
  sessionId: string
  projectId: string
  turnIds: string[]
}

/** 每轮产物卡「撤销本轮」：点击只收集目标（不直接弹窗），当前 agent / 会话 / 项目
 *  任一变化时静默关闭残留弹窗；completed/partial 终态把轮键记入 rolledBackTurns
 *  （completed/partial 均算该轮已撤销；重试追加新 turnId 后轮键变化，旧键残留无害）。 */
export function useTurnFileRollback(context: {
  agent: { sessionId: string } | null
  sessionId: string | undefined
  projectId: string | undefined
}) {
  const [rolledBackTurns, setRolledBackTurns] = useState<ReadonlySet<string>>(() => new Set())
  const [fileRollbackTarget, setFileRollbackTarget] = useState<FileRollbackTarget | null>(null)
  const fileRollbackTargetRef = useRef(fileRollbackTarget)
  const { agent: contextAgent, sessionId: contextSessionId, projectId: contextProjectId } = context
  const currentRollbackContextRef = useRef(context)

  const closeFileRollback = useCallback(() => {
    fileRollbackTargetRef.current = null
    setFileRollbackTarget(null)
  }, [])

  useLayoutEffect(() => {
    currentRollbackContextRef.current = { agent: contextAgent, sessionId: contextSessionId, projectId: contextProjectId }
    const target = fileRollbackTargetRef.current
    if (target && (target.agent !== contextAgent || target.sessionId !== contextSessionId || target.projectId !== contextProjectId)) {
      closeFileRollback()
    }
  }, [contextAgent, contextSessionId, contextProjectId, closeFileRollback])

  const rollbackTurnFromArtifactCard = useCallback((turnIds: string[]) => {
    const { agent, sessionId, projectId } = currentRollbackContextRef.current
    // 空集合不入口；已有弹窗打开时不重复开。
    if (!agent || !sessionId || !projectId || agent.sessionId !== sessionId || fileRollbackTargetRef.current || turnIds.length === 0) return
    const serverAgent = agent as ServerAgent
    if (typeof serverAgent.getTurnRollbackPreview !== 'function' || typeof serverAgent.rollbackTurn !== 'function') return
    const target = { agent: serverAgent, sessionId, projectId, turnIds }
    fileRollbackTargetRef.current = target
    setFileRollbackTarget(target)
  }, [])

  const completeFileRollback = useCallback(() => {
    const target = fileRollbackTargetRef.current
    const contextSnapshot = currentRollbackContextRef.current
    if (target && target.agent === contextSnapshot.agent && target.sessionId === contextSnapshot.sessionId && target.projectId === contextSnapshot.projectId) {
      // completed/partial 均算该轮已撤销（弹窗侧 onCompleted 两种终态都会回调）；
      // 轮键按弹窗打开时的 turnIds 计算——重试追加新 turnId 后轮键变化，旧键残留无害。
      setRolledBackTurns((previous) => new Set(previous).add(turnRollbackKey(target.turnIds)))
    }
  }, [])

  return {
    rolledBackTurns,
    fileRollbackTarget,
    closeFileRollback,
    rollbackTurnFromArtifactCard,
    completeFileRollback,
  }
}
