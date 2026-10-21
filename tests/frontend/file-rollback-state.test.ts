import { describe, expect, it, vi } from 'vitest'
import { canConfirmTurnRollback, createTurnRollbackController, turnRollbackCounts, type TurnRollbackState } from '../../src/components/chat/file-rollback-state'
import type { ServerTurnRollbackPreview, ServerTurnRollbackResult } from '../../src/lib/server-agent'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('turn rollback controller', () => {
  const turnPreview: ServerTurnRollbackPreview = {
    revision: 'tr1',
    turnIds: ['turn-1', 'turn-1-retry'],
    files: [
      { path: '/workspace/a.ts', safe: true, reason: null, action: 'restore', created: false, beforeBytes: 10, afterBytes: 20 },
      { path: '/workspace/new.ts', safe: true, reason: null, action: 'delete', created: true },
    ],
  }
  const turnCompleted: ServerTurnRollbackResult = {
    status: 'completed',
    rolledBack: [
      { path: '/workspace/a.ts', action: 'restore' },
      { path: '/workspace/new.ts', action: 'delete' },
    ],
    conflicts: [],
  }

  function setupTurn() {
    const client = {
      getTurnRollbackPreview: vi.fn<(turnIds: string[], signal?: AbortSignal) => Promise<ServerTurnRollbackPreview>>().mockResolvedValue(turnPreview),
      rollbackTurn: vi.fn<(turnIds: string[], revision: string, signal?: AbortSignal) => Promise<ServerTurnRollbackResult>>().mockResolvedValue(turnCompleted),
    }
    const states: TurnRollbackState[] = []
    const success = vi.fn()
    const controller = createTurnRollbackController(client, ['turn-1', 'turn-1-retry'], (state) => states.push(state), success)
    return { client, states, success, controller }
  }

  it('previews the whole turnIds collection and confirms only a nonempty fully-safe preview', async () => {
    const { client, states, controller } = setupTurn()
    await controller.preview()
    expect(client.getTurnRollbackPreview).toHaveBeenCalledWith(['turn-1', 'turn-1-retry'], expect.any(AbortSignal))
    expect(states.at(-1)?.phase).toBe('ready')
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(true)

    const mixed: ServerTurnRollbackPreview = {
      ...turnPreview,
      files: [...turnPreview.files, { path: '/workspace/b.ts', safe: false, reason: 'external-change', action: 'restore' }],
    }
    client.getTurnRollbackPreview.mockResolvedValue(mixed)
    await controller.preview()
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(false)
    await controller.confirm()
    expect(client.rollbackTurn).not.toHaveBeenCalled()

    client.getTurnRollbackPreview.mockResolvedValue({ ...turnPreview, revision: '' })
    await controller.preview()
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(false)

    client.getTurnRollbackPreview.mockResolvedValue({ ...turnPreview, files: [] })
    await controller.preview()
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(false)
  })

  it('executes with the reviewed turnIds and revision and reports restore/delete counts', async () => {
    const { client, states, success, controller } = setupTurn()
    await controller.preview()
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenCalledWith(['turn-1', 'turn-1-retry'], 'tr1', expect.any(AbortSignal))
    expect(states.at(-1)).toMatchObject({ phase: 'completed', result: turnCompleted })
    expect(turnRollbackCounts(states.at(-1)!.result)).toEqual({ restored: 1, removed: 1 })
    expect(success).toHaveBeenCalledTimes(1)
    // 完成后不可再次执行。
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenCalledTimes(1)
  })

  it('counts a partial turn as undone and requires a fresh preview to execute again', async () => {
    const { client, states, success, controller } = setupTurn()
    const partial: ServerTurnRollbackResult = {
      status: 'partial',
      rolledBack: [{ path: '/workspace/a.ts', action: 'restore' }],
      conflicts: [{ path: '/workspace/new.ts', reason: 'modified-after-turn' }],
    }
    client.rollbackTurn.mockResolvedValueOnce(partial)
    await controller.preview()
    await controller.confirm()
    expect(states.at(-1)).toMatchObject({ phase: 'partial', result: partial })
    // partial 也算该轮已撤销（completed/partial 均回调 onCompleted）。
    expect(success).toHaveBeenCalledTimes(1)
    // 但旧 revision 已消费：重新检查拿到新预览前不可再次执行。
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenCalledTimes(1)
    client.getTurnRollbackPreview.mockResolvedValue({ ...turnPreview, revision: 'tr2' })
    await controller.preview()
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(true)
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenLastCalledWith(['turn-1', 'turn-1-retry'], 'tr2', expect.any(AbortSignal))
  })

  it('treats HTTP 409 as a stale revision and requires an explicit fresh check', async () => {
    const { client, states, success, controller } = setupTurn()
    await controller.preview()
    client.rollbackTurn.mockRejectedValueOnce(Object.assign(new Error('stale revision'), { status: 409 }))
    await controller.confirm()
    expect(states.at(-1)).toMatchObject({ phase: 'conflict', preview: turnPreview })
    expect(success).not.toHaveBeenCalled()
    // conflict 阶段禁止再次执行（旧列表仅供对照）。
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenCalledTimes(1)
    client.getTurnRollbackPreview.mockResolvedValue({ ...turnPreview, revision: 'tr2' })
    await controller.preview()
    await controller.confirm()
    expect(client.rollbackTurn).toHaveBeenLastCalledWith(['turn-1', 'turn-1-retry'], 'tr2', expect.any(AbortSignal))
  })

  it('treats network failures and other statuses as unconfirmed, never as success', async () => {
    const { client, states, success, controller } = setupTurn()
    await controller.preview()
    client.rollbackTurn.mockRejectedValueOnce(new Error('timeout'))
    await controller.confirm()
    expect(states.at(-1)?.phase).toBe('unconfirmed')
    expect(success).not.toHaveBeenCalled()
    expect(canConfirmTurnRollback(states.at(-1)!)).toBe(false)

    client.rollbackTurn.mockRejectedValueOnce(Object.assign(new Error('IO'), { status: 500 }))
    client.getTurnRollbackPreview.mockResolvedValue(turnPreview)
    await controller.preview()
    await controller.confirm()
    expect(states.at(-1)?.phase).toBe('unconfirmed')
    expect(success).not.toHaveBeenCalled()
  })

  it('blocks preview while executing, and disposal aborts the active request', async () => {
    const { client, states, success, controller } = setupTurn()
    const pending = deferred<ServerTurnRollbackResult>()
    await controller.preview()
    client.rollbackTurn.mockReturnValueOnce(pending.promise)
    const running = controller.confirm()
    await controller.preview()
    expect(client.getTurnRollbackPreview).toHaveBeenCalledTimes(1)
    expect(states.at(-1)?.phase).toBe('executing')
    const signal = client.rollbackTurn.mock.calls[0][2]!
    controller.dispose()
    expect(signal.aborted).toBe(true)
    pending.resolve(turnCompleted)
    await running
    expect(success).not.toHaveBeenCalled()
  })
})
