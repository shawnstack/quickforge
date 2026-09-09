import type { ServerFileRollbackPreview, ServerFileRollbackResult } from '@/lib/server-agent'

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
