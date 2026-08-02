export const TERMINAL_CONNECT_TIMEOUT_MS = 10_000
export const TERMINAL_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000] as const
export const MAX_AUTO_RECONNECT_ATTEMPTS = TERMINAL_RECONNECT_DELAYS_MS.length

export type TerminalConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'exited'

export type TerminalConnectionState = {
  status: TerminalConnectionStatus
  reconnectAttempt?: number
}

export function terminalReconnectDelay(retriesUsed: number) {
  return TERMINAL_RECONNECT_DELAYS_MS[retriesUsed]
}
