import { describe, expect, it, vi } from 'vitest'
import { canConfirmFileRollback, canConfirmSingleFileRollback, createFileRollbackController, fileRollbackResultState, type FileRollbackState } from '../../src/components/chat/file-rollback-state'
import type { ServerFileRollbackPreview, ServerFileRollbackResult } from '../../src/lib/server-agent'

const preview: ServerFileRollbackPreview = {
  revision: 'r1', canRollback: true,
  files: [{ path: '/workspace/a.ts', relativePath: 'a.ts', revision: 'file-r1', safe: true, reason: '', action: 'restore' }],
}
const completed: ServerFileRollbackResult = { status: 'completed', restored: 1, removedCreated: 0, errors: [], preview }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup() {
  const client = {
    getFileRollbackPreview: vi.fn<(signal?: AbortSignal) => Promise<ServerFileRollbackPreview>>().mockResolvedValue(preview),
    rollbackFiles: vi.fn<(revision: string, signal?: AbortSignal) => Promise<ServerFileRollbackResult>>().mockResolvedValue(completed),
    rollbackFile: vi.fn<(path: string, revision: string, signal?: AbortSignal) => Promise<ServerFileRollbackResult>>().mockResolvedValue(completed),
  }
  const states: FileRollbackState[] = []
  const success = vi.fn()
  const controller = createFileRollbackController(client, (state) => states.push(state), success)
  return { client, states, success, controller }
}

describe('file rollback safety controller', () => {
  it('allows a reviewed safe file in a mixed batch without weakening batch safety', async () => {
    const { client, controller } = setup()
    const mixed = { ...preview, canRollback: false, files: [...preview.files, { ...preview.files[0], path: '/workspace/b.ts', safe: false }] }
    client.getFileRollbackPreview.mockResolvedValue(mixed)
    await controller.preview()
    expect(canConfirmFileRollback({ phase: 'ready', preview: mixed })).toBe(false)
    await controller.confirm()
    await controller.confirmFile('/workspace/b.ts')
    await controller.confirmFile('/not-in-preview')
    expect(client.rollbackFiles).not.toHaveBeenCalled()
    expect(client.rollbackFile).not.toHaveBeenCalled()
    await controller.confirmFile('/workspace/a.ts')
    expect(client.rollbackFile).toHaveBeenCalledWith('/workspace/a.ts', 'file-r1', expect.any(AbortSignal))
  })

  it.each(['session_busy', 'backup_unavailable', 'incomplete_write', 'unavailable', 'batch_changed', 'unknown'])('blocks both actions for global %s even when entries are safe', async (reason) => {
    const { client, controller } = setup()
    const blocked = { ...preview, reason }
    client.getFileRollbackPreview.mockResolvedValue(blocked)
    await controller.preview()
    expect(canConfirmFileRollback({ phase: 'ready', preview: blocked })).toBe(false)
    expect(canConfirmSingleFileRollback({ phase: 'ready', preview: blocked }, '/workspace/a.ts')).toBe(false)
    await controller.confirmFile('/workspace/a.ts')
    await controller.confirm()
    expect(client.rollbackFile).not.toHaveBeenCalled()
    expect(client.rollbackFiles).not.toHaveBeenCalled()
  })

  it('requires a unique safe file and its own nonempty revision, including on legacy servers', () => {
    for (const files of [
      [{ ...preview.files[0], revision: undefined }], [{ ...preview.files[0], revision: '' }],
      [{ ...preview.files[0], safe: false }], [preview.files[0], preview.files[0]],
    ]) expect(canConfirmSingleFileRollback({ phase: 'ready', preview: { ...preview, files } }, '/workspace/a.ts')).toBe(false)
    for (const phase of ['loading', 'executing', 'failed', 'unconfirmed', 'preview-error', 'completed'] as const) {
      expect(canConfirmSingleFileRollback({ phase, preview }, '/workspace/a.ts')).toBe(false)
    }
  })

  it('keeps partial success in the dialog, uses the remaining revision and completes only at the end', async () => {
    const { client, states, success, controller } = setup()
    const remaining = { ...preview, revision: 'r2', files: [{ ...preview.files[0], path: '/workspace/b.ts', revision: 'b-r2' }] }
    client.rollbackFile.mockResolvedValueOnce({ ...completed, status: 'partial', preview: remaining })
    await controller.preview()
    await controller.confirmFile('/workspace/a.ts')
    expect(states.at(-1)).toMatchObject({ phase: 'partial', preview: remaining, result: { restored: 1 } })
    expect(success).not.toHaveBeenCalled()
    expect(canConfirmFileRollback(states.at(-1)!)).toBe(true)
    await controller.confirmFile('/workspace/a.ts')
    expect(client.rollbackFile).toHaveBeenCalledTimes(1)
    await controller.confirmFile('/workspace/b.ts')
    expect(client.rollbackFile).toHaveBeenLastCalledWith('/workspace/b.ts', 'b-r2', expect.any(AbortSignal))
    expect(states.at(-1)?.phase).toBe('completed')
    expect(success).toHaveBeenCalledTimes(1)
  })

  it.each(['single', 'batch'] as const)('makes %s execution exclusive with double clicks and the other action', async (operation) => {
    const { client, controller } = setup()
    const pending = deferred<ServerFileRollbackResult>()
    const method = operation === 'single' ? client.rollbackFile : client.rollbackFiles
    method.mockReturnValueOnce(pending.promise)
    await controller.preview()
    const run = operation === 'single' ? controller.confirmFile('/workspace/a.ts') : controller.confirm()
    await controller.confirmFile('/workspace/a.ts')
    await controller.confirm()
    await controller.preview()
    expect(client.rollbackFile.mock.calls.length + client.rollbackFiles.mock.calls.length).toBe(1)
    expect(client.getFileRollbackPreview).toHaveBeenCalledTimes(1)
    pending.resolve(completed)
    await run
  })

  it.each(['failed', 'unconfirmed'] as const)('requires a fresh check after single-file %s and never automatically continues', async (outcome) => {
    const { client, states, success, controller } = setup()
    if (outcome === 'failed') client.rollbackFile.mockResolvedValueOnce({ ...completed, status: 'failed' })
    else client.rollbackFile.mockRejectedValueOnce(new Error('timeout'))
    await controller.preview()
    await controller.confirmFile('/workspace/a.ts')
    await controller.confirmFile('/workspace/a.ts')
    await controller.confirm()
    expect(states.at(-1)?.phase).toBe(outcome)
    expect(client.rollbackFile).toHaveBeenCalledTimes(1)
    expect(client.rollbackFiles).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    await controller.preview()
    expect(canConfirmSingleFileRollback(states.at(-1)!, '/workspace/a.ts')).toBe(true)
    expect(client.rollbackFile).toHaveBeenCalledTimes(1)
  })

  it('aborts a single request on close and ignores a late completion', async () => {
    const { client, states, success, controller } = setup()
    const pending = deferred<ServerFileRollbackResult>()
    client.rollbackFile.mockReturnValueOnce(pending.promise)
    await controller.preview()
    const run = controller.confirmFile('/workspace/a.ts')
    const count = states.length
    controller.dispose()
    expect(client.rollbackFile.mock.calls[0][2]?.aborted).toBe(true)
    pending.resolve(completed)
    await run
    await controller.confirmFile('/workspace/a.ts')
    expect(states).toHaveLength(count)
    expect(success).not.toHaveBeenCalled()
    expect(client.rollbackFile).toHaveBeenCalledTimes(1)
  })

  it('requires a nonempty fully safe preview and a confirmable phase', () => {
    expect(canConfirmFileRollback({ phase: 'ready', preview })).toBe(true)
    for (const phase of ['loading', 'executing', 'failed', 'preview-error', 'unconfirmed', 'completed'] as const) {
      expect(canConfirmFileRollback({ phase, preview })).toBe(false)
    }
    for (const invalid of [
      { ...preview, canRollback: false }, { ...preview, revision: '' }, { ...preview, files: [] },
      { ...preview, files: [...preview.files, { ...preview.files[0], safe: false }] },
    ]) expect(canConfirmFileRollback({ phase: 'ready', preview: invalid })).toBe(false)
  })

  it('only completed with no errors means full success', () => {
    expect(fileRollbackResultState(completed).phase).toBe('completed')
    expect(fileRollbackResultState({ ...completed, status: 'partial' }).phase).toBe('partial')
    expect(fileRollbackResultState({ ...completed, status: 'partial', errors: [{ path: 'a.ts', message: 'error' }] }).phase).toBe('failed')
    expect(fileRollbackResultState({ ...completed, errors: [{ path: 'a.ts', message: 'error' }] }).phase).toBe('failed')
    expect(fileRollbackResultState({ ...completed, status: 'failed' }).phase).toBe('failed')
    expect(fileRollbackResultState({ ...completed, status: 'blocked' }).phase).toBe('blocked')
  })

  it('uses the reviewed revision and blocks double execution and preview while running', async () => {
    const { client, states, success, controller } = setup()
    const pending = deferred<ServerFileRollbackResult>()
    client.rollbackFiles.mockReturnValueOnce(pending.promise)
    await controller.preview()
    const run = controller.confirm()
    await controller.confirm()
    await controller.preview()
    expect(client.rollbackFiles).toHaveBeenCalledTimes(1)
    expect(client.rollbackFiles).toHaveBeenCalledWith('r1', expect.any(AbortSignal))
    expect(client.getFileRollbackPreview).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.phase).toBe('executing')
    pending.resolve(completed)
    await run
    expect(success).toHaveBeenCalledTimes(1)
  })

  it('keeps a blocked updated preview and requires another explicit confirmation', async () => {
    const { client, states, success, controller } = setup()
    const updated = { ...preview, revision: 'r2' }
    client.rollbackFiles.mockResolvedValueOnce({ ...completed, status: 'blocked', restored: 0, preview: updated })
    await controller.preview()
    await controller.confirm()
    expect(states.at(-1)).toMatchObject({ phase: 'blocked', preview: updated })
    expect(success).not.toHaveBeenCalled()
    expect(client.rollbackFiles).toHaveBeenCalledTimes(1)
    await controller.confirm()
    expect(client.rollbackFiles).toHaveBeenLastCalledWith('r2', expect.any(AbortSignal))
  })

  it('retains partial counts, disables failed execution, and needs a fresh preview', async () => {
    const { client, states, success, controller } = setup()
    client.rollbackFiles.mockResolvedValueOnce({ ...completed, status: 'failed', restored: 3, removedCreated: 2, errors: [{ path: 'b', message: 'IO' }] })
    await controller.preview()
    await controller.confirm()
    await controller.confirm()
    expect(states.at(-1)).toMatchObject({ phase: 'failed', result: { restored: 3, removedCreated: 2 } })
    expect(client.rollbackFiles).toHaveBeenCalledTimes(1)
    expect(success).not.toHaveBeenCalled()
    await controller.preview()
    expect(states.at(-1)).toMatchObject({ phase: 'ready', result: { restored: 3, removedCreated: 2 } })
  })

  it('treats network/timeout failures as unconfirmed, never as zero writes or success', async () => {
    const { client, states, success, controller } = setup()
    client.rollbackFiles.mockRejectedValueOnce(new Error('timeout'))
    await controller.preview()
    await controller.confirm()
    expect(states.at(-1)?.phase).toBe('unconfirmed')
    expect(states.at(-1)?.result).toBeUndefined()
    expect(success).not.toHaveBeenCalled()
    expect(canConfirmFileRollback(states.at(-1)!)).toBe(false)
  })

  it('does not publish success for a completed response containing errors', async () => {
    const { client, states, success, controller } = setup()
    client.rollbackFiles.mockResolvedValueOnce({ ...completed, errors: [{ path: 'a', message: 'IO' }] })
    await controller.preview()
    await controller.confirm()
    expect(states.at(-1)?.phase).toBe('failed')
    expect(success).not.toHaveBeenCalled()
  })

  it('keeps uncertain outcome feedback after rechecking instead of inferring what was written', async () => {
    const { client, states, controller } = setup()
    client.rollbackFiles.mockRejectedValueOnce(new Error('disconnected'))
    await controller.preview()
    await controller.confirm()
    await controller.preview()
    expect(states.at(-1)).toMatchObject({ phase: 'ready', outcomeUnconfirmed: true })
    expect(states.at(-1)?.result).toBeUndefined()
  })

  it('exposes preview failure then allows a successful retry', async () => {
    const { client, states, controller } = setup()
    client.getFileRollbackPreview.mockRejectedValueOnce(new Error('offline'))
    await controller.preview()
    expect(states.at(-1)?.phase).toBe('preview-error')
    await controller.preview()
    expect(states.at(-1)?.phase).toBe('ready')
  })

  it('ignores old preview responses even if the transport ignores abort', async () => {
    const { client, states, controller } = setup()
    const old = deferred<ServerFileRollbackPreview>()
    client.getFileRollbackPreview.mockReturnValueOnce(old.promise)
    const first = controller.preview()
    const signal = client.getFileRollbackPreview.mock.calls[0][0]!
    await controller.preview()
    expect(signal.aborted).toBe(true)
    old.resolve({ ...preview, revision: 'obsolete' })
    await first
    expect(states.at(-1)?.preview?.revision).toBe('r1')
  })

  it.each(['preview', 'execution'] as const)('disposal on close/session change prevents stale %s publication', async (operation) => {
    const { client, states, success, controller } = setup()
    const pending = deferred<ServerFileRollbackResult & ServerFileRollbackPreview>()
    let running: Promise<void>
    let signal: AbortSignal
    if (operation === 'preview') {
      client.getFileRollbackPreview.mockReturnValueOnce(pending.promise)
      running = controller.preview()
      signal = client.getFileRollbackPreview.mock.calls[0][0]!
    } else {
      await controller.preview()
      client.rollbackFiles.mockReturnValueOnce(pending.promise)
      running = controller.confirm()
      signal = client.rollbackFiles.mock.calls[0][1]!
    }
    const length = states.length
    controller.dispose()
    expect(signal.aborted).toBe(true)
    pending.resolve({ ...preview, ...completed })
    await running
    expect(states).toHaveLength(length)
    expect(success).not.toHaveBeenCalled()
  })
})
