import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')
const agentManagerSource = readFileSync(new URL('../../src/hooks/useAgentManager.ts', import.meta.url), 'utf8')

function callbackSource(name: string) {
  const source = appSource.match(new RegExp(`const ${name} = useCallback\\(\\(\\) => \\{([\\s\\S]*?)
  \\}, \\[`))?.[1]
  expect(source, `${name} callback`).toBeDefined()
  return source ?? ''
}

describe('sidebar new chat routing', () => {
  it('keeps the top new-chat entry on the active-project-aware default handler', () => {
    const defaultHandler = callbackSource('startNewDefaultSession')
    const topEntry = sidebarSource.slice(
      sidebarSource.indexOf("aria-label={t('startNewChat')}") - 240,
      sidebarSource.indexOf("aria-label={t('startNewChat')}") + 120,
    )

    expect(defaultHandler).toContain('setEmptyStateProjectDismissed(false)')
    expect(defaultHandler).toContain('if (activeProject)')
    expect(defaultHandler).toContain('startNewProjectChatWithInspectorReset(activeProject)')
    expect(defaultHandler).toContain('startNewGlobalSession()')
    expect(topEntry).toContain('onClick={onStartNewDefaultChat}')
    expect(appSource).toContain('onStartNewDefaultChat={startNewDefaultSession}')
    expect(appSource).toContain('onStartNewDefaultChat={startNewDefaultSessionFromSidebar}')
  })

  it('routes the Tasks title action through the explicit global handler on desktop and mobile', () => {
    const tasksToggleIndex = sidebarSource.indexOf('onClick={toggleConversationsCollapsed}')
    const tasksHeader = sidebarSource.slice(
      tasksToggleIndex,
      sidebarSource.indexOf("aria-label={t('newChat')}", tasksToggleIndex) + 80,
    )

    expect(tasksHeader).toContain('onClick={onStartNewGlobalChat}')
    expect(appSource).toContain('onStartNewGlobalChat={startNewExplicitGlobalSession}')
    expect(appSource).toContain('onStartNewGlobalChat={startNewExplicitGlobalSessionFromSidebar}')

    const mobileHandler = callbackSource('startNewExplicitGlobalSessionFromSidebar')
    expect(mobileHandler.indexOf('closeMobileSidebar()')).toBeLessThan(mobileHandler.indexOf('startNewExplicitGlobalSession()'))
  })

  it('prevents active-project auto-selection before starting an explicit global session', () => {
    const explicitGlobalHandler = callbackSource('startNewExplicitGlobalSession')

    expect(explicitGlobalHandler.indexOf('setEmptyStateProjectDismissed(true)')).toBeLessThan(
      explicitGlobalHandler.indexOf('startNewGlobalSession()'),
    )
    expect(appSource).toContain("if (!showNewChatEmptyState || emptyStateProjectDismissed || !activeProject || agentManager.chatScope !== 'global') return")
    expect(appSource).toContain('if (!showNewChatEmptyState && wasNewChatEmptyStateRef.current)')
    expect(agentManagerSource).toContain("const project = scope === 'project' ? options.project : (options.project ?? defaultWorkspaceRef.current)")
  })

  it('keeps project-row new chat bound to the clicked project item', () => {
    expect(sidebarSource).toContain('onClick={() => onStartNewProjectChat(item)}')
    expect(appSource).toContain('onStartNewProjectChat={startNewProjectChatWithInspectorReset}')
    expect(appSource).toContain('onStartNewProjectChat={startNewProjectChatFromSidebar}')
  })

  it('does not derive the Tasks icon target from the active or current task project', () => {
    const explicitGlobalHandler = callbackSource('startNewExplicitGlobalSession')
    const tasksHeader = sidebarSource.slice(
      sidebarSource.indexOf('onClick={toggleConversationsCollapsed}'),
      sidebarSource.indexOf("aria-label={t('newChat')}") + 80,
    )

    expect(explicitGlobalHandler).not.toContain('activeProject')
    expect(explicitGlobalHandler).not.toContain('currentToolProject')
    expect(explicitGlobalHandler).not.toContain('chatScope')
    expect(tasksHeader).not.toContain('activeProject')
    expect(tasksHeader).not.toContain('currentToolProject')
    expect(appSource).not.toContain('currentTaskProjectForNewChat')
    expect(appSource).not.toContain("@/lib/new-chat-project-target")
  })
})
