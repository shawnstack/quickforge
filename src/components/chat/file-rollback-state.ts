import type { ServerTurnRollbackPreview, ServerTurnRollbackResult } from '@/lib/server-agent'

// ---------------------------------------------------------------------------
// Turn rollback（每轮产物卡「撤销本轮」）：整轮原子预检 + 整轮执行，无单文件入口。
// ---------------------------------------------------------------------------

export type TurnRollbackState = {
  phase: 'loading' | 'ready' | 'executing' | 'conflict' | 'partial' | 'failed' | 'unconfirmed' | 'preview-error' | 'completed'
  preview?: ServerTurnRollbackPreview
  result?: ServerTurnRollbackResult
}

export type TurnRollbackClient = {
  getTurnRollbackPreview(turnIds: string[], signal?: AbortSignal): Promise<ServerTurnRollbackPreview>
  rollbackTurn(turnIds: string[], revision: string, signal?: AbortSignal): Promise<ServerTurnRollbackResult>
}

/** 整轮执行口径：ready 阶段 + 非空 revision + 本轮全部文件安全（无单文件回退入口）。 */
export function canConfirmTurnRollback(state: TurnRollbackState): boolean {
  const preview = state.preview
  return state.phase === 'ready' && Boolean(preview
    && preview.revision && preview.files.length > 0
    && preview.files.every((file) => file.safe))
}

/** 文件级结果无总数字段：按 rolledBack 的 action 汇总恢复/删除计数。 */
export function turnRollbackCounts(result?: ServerTurnRollbackResult) {
  const rolledBack = result?.rolledBack ?? []
  return {
    restored: rolledBack.filter((file) => file.action === 'restore').length,
    removed: rolledBack.filter((file) => file.action === 'delete').length,
  }
}

/** One dialog lifetime. Abort + generation checks also cover non-cooperative transports. */
export function createTurnRollbackController(
  client: TurnRollbackClient,
  turnIds: string[],
  onChange: (state: TurnRollbackState) => void,
  onCompleted: () => void,
) {
  let state: TurnRollbackState = { phase: 'loading' }
  let generation = 0
  let disposed = false
  let request: AbortController | undefined
  const publish = (next: TurnRollbackState) => {
    state = next
    onChange(next)
  }
  const begin = () => {
    request?.abort()
    request = new AbortController()
    return { id: ++generation, signal: request.signal }
  }
  const current = (id: number) => !disposed && id === generation
  return {
    async preview() {
      if (disposed || state.phase === 'executing') return
      const { id, signal } = begin()
      // Preserve execution feedback until the user has inspected a fresh preview.
      publish({ phase: 'loading', result: state.result })
      try {
        const preview = await client.getTurnRollbackPreview(turnIds, signal)
        if (current(id)) publish({ phase: 'ready', preview, result: state.result })
      } catch {
        if (current(id)) publish({ phase: 'preview-error', result: state.result })
      }
    },
    async confirm() {
      if (disposed || !canConfirmTurnRollback(state)) return
      const revision = state.preview!.revision
      const { id, signal } = begin()
      publish({ phase: 'executing', preview: state.preview, result: state.result })
      try {
        const result = await client.rollbackTurn(turnIds, revision, signal)
        if (!current(id)) return
        // completed 与 partial 均算该轮已撤销；partial 的冲突文件留在反馈里，
        // 重新检查拿到新预览后才能再次执行。
        publish({ phase: result.status, preview: state.preview, result })
        onCompleted()
      } catch (error) {
        if (!current(id)) return
        if ((error as { status?: number }).status === 409) {
          // revision 过期：预览已失效，保留旧列表仅供对照，重新检查后才能再次执行。
          publish({ phase: 'conflict', preview: state.preview })
        } else {
          // 超时/中断无法确认服务端是否已写入：按未确认处理，禁止再执行。
          publish({ phase: 'unconfirmed', preview: state.preview, result: state.result })
        }
      }
    },
    dispose() {
      disposed = true
      generation += 1
      request?.abort()
    },
  }
}
