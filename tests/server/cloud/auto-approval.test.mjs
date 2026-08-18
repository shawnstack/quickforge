import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudRuntime: vi.fn(),
  withAccessToken: vi.fn(),
  authorizeRemoteAgent: vi.fn(),
}))

vi.mock('../../../server/cloud/runtime.mjs', () => ({
  getCloudRuntime: mocks.getCloudRuntime,
}))

import {
  AGENT_AUTO_APPROVAL_TTL_MS,
  armAgentAutoApproval,
  beginAgentAutoApproval,
  clearAgentAutoApproval,
  getAgentAutoApprovalState,
  resetAgentAutoApprovalForTests,
  retryAgentAutoApproval,
} from '../../../server/cloud/auto-approval.mjs'

const NOW = 1_750_000_000_000

beforeEach(() => {
  resetAgentAutoApprovalForTests()
  vi.clearAllMocks()
})

afterEach(() => {
  resetAgentAutoApprovalForTests()
})

describe('agent auto-approval intent', () => {
  it('arms a short-lived one-time intent only when explicitly requested', () => {
    const state = armAgentAutoApproval({ now: NOW })
    expect(state).toEqual({ status: 'armed' })
    expect(getAgentAutoApprovalState({ now: NOW + AGENT_AUTO_APPROVAL_TTL_MS - 1 }).status).toBe('armed')
    expect(getAgentAutoApprovalState({ now: NOW + AGENT_AUTO_APPROVAL_TTL_MS }).status).toBe('expired')
    expect(getAgentAutoApprovalState({ now: NOW + AGENT_AUTO_APPROVAL_TTL_MS + 1 }).status).toBe('expired')
  })

  it('reports none after clear and never persists anything', () => {
    armAgentAutoApproval({ now: NOW })
    clearAgentAutoApproval()
    expect(getAgentAutoApprovalState({ now: NOW })).toEqual({ status: 'none' })
  })

  it('skips auto-approval without an armed intent', async () => {
    const authorize = vi.fn(async () => ({ ok: true }))
    expect(await beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })).toEqual({ status: 'none' })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('skips after expiry', async () => {
    armAgentAutoApproval({ now: NOW, ttlMs: 1_000 })
    const authorize = vi.fn(async () => ({ ok: true }))
    expect(await beginAgentAutoApproval('ABCD-EFGH', { now: NOW + 2_000, authorize })).toEqual({ status: 'expired' })
    expect(authorize).not.toHaveBeenCalled()
  })

  it('consumes the one-time intent with the first captured user code', async () => {
    armAgentAutoApproval({ now: NOW })
    const authorize = vi.fn(async (userCode) => ({ ok: true, userCode }))
    expect(await beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })).toEqual({ status: 'consumed' })
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(authorize).toHaveBeenCalledWith('ABCD-EFGH')
    // 一次性：意图消耗后，后续捕获的 user code 不再触发云端调用
    expect(await beginAgentAutoApproval('WXYZ-0000', { now: NOW, authorize })).toEqual({ status: 'consumed' })
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent begin calls into a single authorize request', async () => {
    armAgentAutoApproval({ now: NOW })
    let resolveAuthorize
    const authorize = vi.fn(() => new Promise((resolve) => {
      resolveAuthorize = () => resolve({ ok: true })
    }))
    const first = beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })
    const second = beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })
    resolveAuthorize()
    expect(await first).toEqual({ status: 'consumed' })
    expect(await second).toEqual({ status: 'consumed' })
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('does not let an old inflight approval mutate a cleared or newly armed intent', async () => {
    armAgentAutoApproval({ now: NOW })
    let resolveOld
    const oldAuthorize = vi.fn(() => new Promise((resolve) => {
      resolveOld = () => resolve({ ok: true })
    }))
    const oldAttempt = beginAgentAutoApproval('OLD-CODE', { now: NOW, authorize: oldAuthorize })

    clearAgentAutoApproval()
    armAgentAutoApproval({ now: NOW + 1 })
    expect(getAgentAutoApprovalState({ now: NOW + 1 })).toEqual({ status: 'armed' })

    resolveOld()
    expect(await oldAttempt).toEqual({ status: 'consumed' })
    expect(getAgentAutoApprovalState({ now: NOW + 1 })).toEqual({ status: 'armed' })

    const newAuthorize = vi.fn(async () => ({ ok: true }))
    expect(await beginAgentAutoApproval('NEW-CODE', { now: NOW + 1, authorize: newAuthorize })).toEqual({ status: 'consumed' })
    expect(newAuthorize).toHaveBeenCalledWith('NEW-CODE')
  })

  it('marks failed with a redacted error and allows exactly one explicit retry', async () => {
    armAgentAutoApproval({ now: NOW })
    const authorize = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Bearer tok_123 failed'), { code: 'cloud_unavailable' }))
      .mockResolvedValueOnce({ ok: true })
    const failed = await beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })
    expect(failed.status).toBe('failed')
    expect(failed.error).not.toContain('tok_123')
    expect(failed.error).toContain('[redacted]')
    expect(getAgentAutoApprovalState({ now: NOW })).toEqual({ status: 'failed', error: failed.error })

    // 失败后不显式重试的重复 begin 不会重复调用云端
    await beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })
    expect(authorize).toHaveBeenCalledTimes(1)

    expect(await retryAgentAutoApproval({ now: NOW, authorize })).toEqual({ status: 'consumed' })
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(getAgentAutoApprovalState({ now: NOW })).toEqual({ status: 'consumed' })
  })

  it('rejects retry unless the previous attempt failed', async () => {
    armAgentAutoApproval({ now: NOW })
    const authorize = vi.fn(async () => ({ ok: true }))
    await beginAgentAutoApproval('ABCD-EFGH', { now: NOW, authorize })
    expect(await retryAgentAutoApproval({ now: NOW, authorize })).toEqual({ status: 'consumed' })
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('uses the desktop identity through withAccessToken without exposing the token or user code', async () => {
    mocks.getCloudRuntime.mockResolvedValue({
      identity: { withAccessToken: mocks.withAccessToken },
      client: { authorizeRemoteAgent: mocks.authorizeRemoteAgent },
    })
    mocks.withAccessToken.mockImplementation(async (operation) => operation('desktop-secret-token'))
    mocks.authorizeRemoteAgent.mockResolvedValue({ ok: true })

    armAgentAutoApproval({ now: NOW })
    const result = await beginAgentAutoApproval('ABCD-EFGH', { now: NOW })
    expect(result).toEqual({ status: 'consumed' })
    expect(mocks.withAccessToken).toHaveBeenCalledTimes(1)
    expect(mocks.authorizeRemoteAgent).toHaveBeenCalledWith('desktop-secret-token', 'ABCD-EFGH', undefined)
    const publicState = JSON.stringify(getAgentAutoApprovalState({ now: NOW }))
    expect(publicState).not.toContain('desktop-secret-token')
    expect(publicState).not.toContain('ABCD-EFGH')
  })

  it('fails cleanly when the desktop identity is missing', async () => {
    mocks.getCloudRuntime.mockResolvedValue({})
    armAgentAutoApproval({ now: NOW })
    const result = await beginAgentAutoApproval('ABCD-EFGH', { now: NOW })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/not connected/i)
  })
})
