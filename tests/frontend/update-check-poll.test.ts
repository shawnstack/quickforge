import { describe, expect, it, vi } from 'vitest'
import { requestUpdateCheck, type UpdateCheckPayload } from '../../src/lib/update-check-poll'

const noSleep = () => Promise.resolve()

function jsonResponse(payload: UpdateCheckPayload, ok = true) {
  return { ok, json: async () => payload } as Response
}

const OK_PAYLOAD: UpdateCheckPayload = {
  status: 'ok',
  channel: 'npm-runtime',
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  updateAvailable: true,
}

describe('requestUpdateCheck', () => {
  it('returns the ok payload immediately without polling', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(OK_PAYLOAD))

    const outcome = await requestUpdateCheck({ fetchImpl, sleep: noSleep })

    expect(outcome).toEqual({ kind: 'ok', payload: OK_PAYLOAD })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('polls while the server reports checking and stops at a terminal state', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'checking' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'checking' }))
      .mockResolvedValueOnce(jsonResponse(OK_PAYLOAD))

    const outcome = await requestUpdateCheck({ fetchImpl, sleep: noSleep })

    expect(outcome.kind).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('forwards force only on the first request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'checking' }))
      .mockResolvedValueOnce(jsonResponse(OK_PAYLOAD))

    await requestUpdateCheck({ force: true, fetchImpl, sleep: noSleep })

    expect(fetchImpl.mock.calls[0][0]).toContain('force=1')
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/system/update/check')
  })

  it('returns an error outcome with the server checkError message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'error', checkError: 'request timeout' }))

    const outcome = await requestUpdateCheck({ fetchImpl, sleep: noSleep })

    expect(outcome).toEqual({ kind: 'error', message: 'request timeout' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('treats http failures and network errors as silent error outcomes', async () => {
    const httpError = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, false))
    await expect(requestUpdateCheck({ fetchImpl: httpError, sleep: noSleep })).resolves.toEqual({ kind: 'error' })

    const networkError = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(requestUpdateCheck({ fetchImpl: networkError, sleep: noSleep })).resolves.toEqual({ kind: 'error' })
  })

  it('gives up after the attempt budget while still checking', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'checking' }))

    const outcome = await requestUpdateCheck({ attempts: 3, fetchImpl, sleep: noSleep })

    expect(outcome).toEqual({ kind: 'error' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('accepts legacy payloads without a status field', async () => {
    const legacy = { currentVersion: '1.0.0', latestVersion: '1.1.0', updateAvailable: true }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(legacy as UpdateCheckPayload))

    const outcome = await requestUpdateCheck({ fetchImpl, sleep: noSleep })

    expect(outcome.kind).toBe('ok')
  })
})
