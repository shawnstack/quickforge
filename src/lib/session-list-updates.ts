import type { QuickForgeSessionMetadata, SidebarSessionSortMode } from './types'

export type SessionPage = {
  items: QuickForgeSessionMetadata[]
  total: number
  loading: boolean
}

function sessionSortTime(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function sortSessions(items: QuickForgeSessionMetadata[], sortMode: SidebarSessionSortMode) {
  const timeKey = sortMode === 'createdAt' ? 'createdAt' : 'lastModified'
  return [...items].sort((a, b) => {
    const pinnedDiff = sessionSortTime(b.pinnedAt) - sessionSortTime(a.pinnedAt)
    if (pinnedDiff !== 0) return pinnedDiff
    if (a.pinnedAt && !b.pinnedAt) return -1
    if (!a.pinnedAt && b.pinnedAt) return 1
    return sessionSortTime(b[timeKey]) - sessionSortTime(a[timeKey])
  })
}

export function uniqueSessions(items: QuickForgeSessionMetadata[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

export function upsertSessionPage(
  page: SessionPage,
  session: QuickForgeSessionMetadata,
  sortMode: SidebarSessionSortMode,
): SessionPage {
  const exists = page.items.some((item) => item.id === session.id)
  return {
    ...page,
    items: sortSessions(uniqueSessions([session, ...page.items.filter((item) => item.id !== session.id)]), sortMode),
    total: exists ? page.total : page.total + 1,
  }
}

export function patchSessionTitleInPage(page: SessionPage, sessionId: string, title: string): SessionPage {
  if (!page.items.some((session) => session.id === sessionId)) return page
  return {
    ...page,
    items: page.items.map((session) => session.id === sessionId ? { ...session, title } : session),
  }
}

export function removeSessionFromPage(page: SessionPage, sessionId: string): SessionPage {
  if (!page.items.some((session) => session.id === sessionId)) return page
  return {
    ...page,
    items: page.items.filter((session) => session.id !== sessionId),
    total: Math.max(0, page.total - 1),
  }
}
