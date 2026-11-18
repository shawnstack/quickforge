import { afterEach, describe, expect, it, vi } from 'vitest'

import { answerAsk, approveToolCall, rejectToolCall } from '../../src/lib/server-agent/approval-actions'
import type { ServerAgentCore } from '../../src/lib/server-agent/core'

/**
 * 多窗口下的审批收敛。
 *
 * 两个窗口都能看到同一张审批卡，条目的生命周期只有一次：先点的 resolve 并
 * cleanup，后点的查不到。服务端为此返回 `APPROVAL_ALREADY_SETTLED` /
 * `ASK_ALREADY_SETTLED`。前端必须把它当幂等成功（清本地 pending、不抛错），
 * 而不是让用户在一个什么都没发生的窗口里看到英文红字。
 *
 * 判据：把实现换回「非 ok 就 throw」，下面三条 settled 用例必须变红。
 */

function makeCore(state: Record<string, unknown>): ServerAgentCore {
  return {
    baseUrl: '',
    sessionId: 'session-1',
    writeHeaders: () => ({ 'x-quickforge-client-id': 'client-a' }),
    state,
  } as unknown as ServerAgentCore
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('审批在另一个窗口已被处理', () => {
  it('approve 收到 APPROVAL_ALREADY_SETTLED 时清掉本地 pending 且不抛错', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, { error: 'No pending approval for this tool call', code: 'APPROVAL_ALREADY_SETTLED' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const core = makeCore({ pendingToolApproval: { toolCallId: 'call-1' } })

    await expect(approveToolCall(core, 'call-1')).resolves.toBeUndefined()
    expect(core.state.pendingToolApproval).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reject 收到 APPROVAL_ALREADY_SETTLED 时清掉本地 pending 且不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(404, { error: 'No pending approval for this tool call', code: 'APPROVAL_ALREADY_SETTLED' }),
      ),
    )
    const core = makeCore({ pendingToolApproval: { toolCallId: 'call-1' } })

    await expect(rejectToolCall(core, 'call-1')).resolves.toBeUndefined()
    expect(core.state.pendingToolApproval).toBeNull()
  })

  it('answerAsk 收到 ASK_ALREADY_SETTLED 时清掉本地 pending 且不抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: 'No pending ask for this session', code: 'ASK_ALREADY_SETTLED' })),
    )
    const core = makeCore({ pendingAsk: { askId: 'ask-1' } })

    await expect(answerAsk(core, 'ask-1', { skipped: true })).resolves.toBeUndefined()
    expect(core.state.pendingAsk).toBeNull()
  })
})

describe('真正的失败仍然抛错', () => {
  it('没有 code 的 404 照旧抛错（别把未知错误也吞掉）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(404, { error: 'Not found' })))
    const core = makeCore({ pendingToolApproval: { toolCallId: 'call-1' } })

    await expect(approveToolCall(core, 'call-1')).rejects.toThrow('Not found')
    // 抛错时不能顺手把本地 pending 清掉，否则用户以为审批已经结束
    expect(core.state.pendingToolApproval).toEqual({ toolCallId: 'call-1' })
  })

  it('5xx 照旧抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { error: 'boom' })))
    const core = makeCore({})

    await expect(rejectToolCall(core, 'call-1')).rejects.toThrow('boom')
  })
})
