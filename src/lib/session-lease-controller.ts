import {
  LEASE_HEARTBEAT_MS,
  acquireLease,
  getClientId,
  leaseSnapshotFromWire,
  releaseLease,
  takeOverLease,
  type SessionLeaseSnapshot,
} from './session-lease-client'

const LEASE_DEGRADE_AFTER_FAILURES = 2

export type SessionLeaseControllerOptions = {
  baseUrl: string
  sessionId: string
  getSnapshot: () => SessionLeaseSnapshot | undefined
  applySnapshot: (next: SessionLeaseSnapshot) => void
  isDisposed: () => boolean
}

/**
 * Owns the session write-lease heartbeat, claim/retry/takeover state machine and
 * the client-id write header. `ServerAgent` keeps the public API and applies the
 * resulting snapshot to its reactive state; this collaborator only talks to the
 * lease endpoint and decides when a snapshot should be adopted.
 */
export class SessionLeaseController {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private enabled = false
  private failures = 0
  private disposed = false
  private readonly options: SessionLeaseControllerOptions

  constructor(options: SessionLeaseControllerOptions) {
    this.options = options
  }

  enable(): void {
    if (this.enabled || this.isDisposed()) return
    this.enabled = true
    void this.renew()
    this.heartbeatTimer = setInterval(() => {
      void this.renew()
    }, LEASE_HEARTBEAT_MS)
  }

  async takeOver(): Promise<boolean> {
    if (this.isDisposed()) return false
    const result = await takeOverLease(this.options.baseUrl, this.options.sessionId)
    this.failures = result.ok ? 0 : this.failures + 1
    this.options.applySnapshot(result.snapshot)
    return result.snapshot.isOwner
  }

  async retry(): Promise<boolean> {
    if (this.isDisposed() || !this.enabled) return false
    await this.renew()
    return this.canWrite()
  }

  canWrite(): boolean {
    const snapshot = this.options.getSnapshot()
    if (!snapshot) return true
    return snapshot.isOwner
  }

  writeHeaders(): Record<string, string> {
    return this.enabled ? { 'x-quickforge-client-id': getClientId() } : {}
  }

  applyWireLease(lease: { clientId?: string; expiresAt?: string } | null | undefined): void {
    this.options.applySnapshot(leaseSnapshotFromWire(lease))
  }

  dispose(): void {
    this.disposed = true
    this.stopHeartbeat()
    if (this.enabled) {
      // Hand the lease back so another window can take over immediately instead
      // of waiting out the TTL. Fire-and-forget: dispose must stay synchronous.
      void releaseLease(this.options.baseUrl, this.options.sessionId).catch(() => {})
      this.enabled = false
    }
  }

  private async renew(): Promise<void> {
    if (this.isDisposed()) return
    const result = await acquireLease(this.options.baseUrl, this.options.sessionId)
    if (this.isDisposed()) return
    this.applyResult(result.ok, result.snapshot)
  }

  /**
   * `unsupported` means the server has no lease endpoint: keep the legacy
   * single-client behavior and stop probing. Other failures are counted; only
   * consecutive failures degrade the page to read-only.
   */
  private applyResult(ok: boolean, snapshot: SessionLeaseSnapshot): void {
    if (ok) {
      this.failures = 0
      this.options.applySnapshot({ ...snapshot, failure: undefined, failureStatus: undefined })
      return
    }
    if (snapshot.failure === 'unsupported') {
      this.failures = 0
      this.stopHeartbeat()
      this.options.applySnapshot({ ...snapshot, degraded: false })
      return
    }
    if (snapshot.failure === undefined) {
      this.failures = 0
      this.options.applySnapshot(snapshot)
      return
    }
    this.failures += 1
    if (this.failures < LEASE_DEGRADE_AFTER_FAILURES) return
    this.options.applySnapshot(snapshot)
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private isDisposed(): boolean {
    return this.disposed || this.options.isDisposed()
  }
}
