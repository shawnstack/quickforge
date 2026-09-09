import type { ServerFileRollbackPreview, ServerFileRollbackResult, ServerTurnRollbackPreview, ServerTurnRollbackResult } from '@/lib/server-agent'

export type FileRollbackState = {
  phase: 'loading' | 'ready' | 'executing' | 'partial' | 'blocked' | 'failed' | 'unconfirmed' | 'preview-error' | 'completed'
  preview?: ServerFileRollbackPreview
  result?: ServerFileRollbackResult
  outcomeUnconfirmed?: boolean
}

export type FileRollbackClient = {
  getFileRollbackPreview(signal?: AbortSignal): Promise<ServerFileRollbackPreview>
  rollbackFiles(revision: string, signal?: AbortSignal): Promise<ServerFileRollbackResult>
  rollbackFile(path: string, revision: string, signal?: AbortSignal): Promise<ServerFileRollbackResult>
}

function hasTrustedPreview(state: FileRollbackState): boolean {
  return (state.phase === 'ready' || state.phase === 'blocked' || state.phase === 'partial')
    && Boolean(state.preview && !state.preview.reason)
}

export function canConfirmFileRollback(state: FileRollbackState): boolean {
  const preview = state.preview
  return hasTrustedPreview(state) && Boolean(preview
    && preview.revision && preview.canRollback && preview.files.length > 0
    && preview.files.every((file) => file.safe))
}

export function canConfirmSingleFileRollback(state: FileRollbackState, path: string): boolean {
  if (!hasTrustedPreview(state)) return false
  const files = state.preview!.files.filter((file) => file.path === path)
  return files.length === 1 && files[0].safe && Boolean(files[0].revision)
}

export function fileRollbackResultState(result: ServerFileRollbackResult): FileRollbackState {
  const phase = (result.status === 'completed' || result.status === 'partial') && result.errors.length === 0
    ? result.status : result.status === 'blocked' ? 'blocked' : 'failed'
  return { phase, preview: result.preview, result }
}

/** One dialog lifetime. Abort + generation checks also cover non-cooperative transports. */
export function createFileRollbackController(
  client: FileRollbackClient,
  onChange: (state: FileRollbackState) => void,
  onCompleted: () => void,
) {
  let state: FileRollbackState = { phase: 'loading' }
  let generation = 0
  let disposed = false
  let request: AbortController | undefined
  const publish = (next: FileRollbackState) => {
    state = next
    onChange(next)
  }
  const begin = () => {
    request?.abort()
    request = new AbortController()
    return { id: ++generation, signal: request.signal }
  }
  const current = (id: number) => !disposed && id === generation
  const execute = async (path?: string) => {
    if (disposed || !(path === undefined ? canConfirmFileRollback(state) : canConfirmSingleFileRollback(state, path))) return
    const revision = path === undefined ? state.preview!.revision : state.preview!.files.find((file) => file.path === path)!.revision!
    const { id, signal } = begin()
    publish({ phase: 'executing', preview: state.preview, result: state.result })
    try {
      const result = await (path === undefined ? client.rollbackFiles(revision, signal) : client.rollbackFile(path, revision, signal))
      if (!current(id)) return
      const next = fileRollbackResultState(result)
      publish(next)
      if (next.phase === 'completed') onCompleted()
    } catch {
      if (current(id)) publish({ ...state, phase: 'unconfirmed', outcomeUnconfirmed: true })
    }
  }
  return {
    async preview() {
      if (disposed || state.phase === 'executing') return
      const { id, signal } = begin()
      // Preserve execution feedback until the user has inspected a fresh preview.
      publish({ phase: 'loading', result: state.result, outcomeUnconfirmed: state.outcomeUnconfirmed })
      try {
        const preview = await client.getFileRollbackPreview(signal)
        if (current(id)) publish({ phase: 'ready', preview, result: state.result, outcomeUnconfirmed: state.outcomeUnconfirmed })
      } catch {
        if (current(id)) publish({ phase: 'preview-error', result: state.result, outcomeUnconfirmed: state.outcomeUnconfirmed })
      }
    },
    confirm: () => execute(),
    confirmFile: (path: string) => execute(path),
    dispose() {
      disposed = true
      generation += 1
      request?.abort()
    },
  }
}

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
