import type { TerminalCapabilities, TerminalSession, TerminalShellConfig } from './terminal-types'

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
  return fetchJson<TerminalCapabilities>('/api/terminal/capabilities')
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

export function getTerminalShellConfig() {
  return fetchJson<TerminalShellConfig>('/api/system/terminal-shell')
}

export function saveTerminalShellConfig(input: Pick<TerminalShellConfig, 'defaultProfileId' | 'profiles'>) {
  return fetchJson<TerminalShellConfig>('/api/system/terminal-shell', {
    method: 'PUT',
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
