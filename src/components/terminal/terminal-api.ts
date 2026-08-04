import type { TerminalCapabilities, TerminalSession } from './terminal-types'

export type PendingTerminalCommand = {
  id: number
  command: string
  execute?: boolean
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`)
  }
  return payload as T
}

export function getTerminalCapabilities() {
  // 服务端为该 GET 接口返回短 TTL 缓存头（private, max-age=300）。
  return fetchJson<TerminalCapabilities>('/api/terminal/capabilities', { cache: 'default' })
}

export function listTerminalSessions(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return fetchJson<{ sessions: TerminalSession[] }>(`/api/terminal/sessions${query}`)
}

export function createTerminalSession(input: { projectId?: string; name?: string; cols?: number; rows?: number; shellProfileId?: string; shellProfileName?: string }) {
  return fetchJson<TerminalSession>('/api/terminal/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function deleteTerminalSession(sessionId: string) {
  return fetchJson<{ ok: true }>(`/api/terminal/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export function sendTerminalInput(sessionId: string, data: string) {
  return fetchJson<{ ok: true }>(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}
