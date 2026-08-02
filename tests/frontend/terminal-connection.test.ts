import { describe, expect, it } from 'vitest'
import {
  MAX_AUTO_RECONNECT_ATTEMPTS,
  TERMINAL_CONNECT_TIMEOUT_MS,
  TERMINAL_RECONNECT_DELAYS_MS,
  isTerminalSessionUnavailable,
  terminalReconnectDelay,
} from '../../src/components/terminal/terminal-connection'

describe('terminal connection policy', () => {
  it('times out a connection attempt after 10 seconds', () => {
    expect(TERMINAL_CONNECT_TIMEOUT_MS).toBe(10_000)
  })

  it('retries three times with bounded exponential delays', () => {
    expect(MAX_AUTO_RECONNECT_ATTEMPTS).toBe(3)
    expect(TERMINAL_RECONNECT_DELAYS_MS).toEqual([1_000, 2_000, 4_000])
    expect(terminalReconnectDelay(0)).toBe(1_000)
    expect(terminalReconnectDelay(1)).toBe(2_000)
    expect(terminalReconnectDelay(2)).toBe(4_000)
    expect(terminalReconnectDelay(3)).toBeUndefined()
  })

  it('recognizes a missing server-side session as non-retryable', () => {
    expect(isTerminalSessionUnavailable({ code: 'SESSION_NOT_FOUND' })).toBe(true)
    expect(isTerminalSessionUnavailable({ retryable: false })).toBe(true)
    expect(isTerminalSessionUnavailable({ message: 'Terminal session not found' })).toBe(true)
    expect(isTerminalSessionUnavailable({ code: 'TERMINAL_CONNECTION_FAILED', retryable: true })).toBe(false)
  })
})
