import { useCallback, useEffect, useRef } from 'react'
import type { ProjectInfo } from '@/lib/types'
import type { useUIState } from './useUIState'

type UIState = ReturnType<typeof useUIState>

/** 移动端侧栏抽屉：role=dialog + aria-modal，所以 Escape 必须关闭、打开时焦点移入、
 *  关闭时还原给打开者。这里的 `*FromSidebar` 包装先收抽屉再转发桌面同名动作，
 *  与桌面直连处理器分开保持引用稳定（memo 的桌面 ChatSidebar 不随无关状态重渲染）。 */
export function useMobileSidebar(options: {
  ui: UIState
  loadSessionWithTransition: (sessionId: string) => void
  startNewDefaultSession: () => void
  startNewExplicitGlobalSession: () => void
  startNewProjectChatWithInspectorReset: (project: ProjectInfo) => void | Promise<unknown>
  openGlobalSkills: () => void
  openMcp: () => void
  openAgents: () => void
  openScheduledTasks: () => void
  openProjectSkills: (project: ProjectInfo) => void
}) {
  const { ui, loadSessionWithTransition, startNewDefaultSession, startNewExplicitGlobalSession, startNewProjectChatWithInspectorReset, openGlobalSkills, openMcp, openAgents, openScheduledTasks, openProjectSkills } = options

  const closeMobileSidebar = useCallback(() => {
    ui.setMobileSidebarOpen(false)
  }, [ui])

  const mobileSidebarDrawerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ui.mobileSidebarOpen) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    mobileSidebarDrawerRef.current?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMobileSidebar()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
    }
  }, [ui.mobileSidebarOpen, closeMobileSidebar])

  const loadSessionFromSidebar = useCallback((sessionId: string) => {
    closeMobileSidebar()
    loadSessionWithTransition(sessionId)
  }, [closeMobileSidebar, loadSessionWithTransition])

  const startNewDefaultSessionFromSidebar = useCallback(() => {
    closeMobileSidebar()
    startNewDefaultSession()
  }, [closeMobileSidebar, startNewDefaultSession])

  const startNewExplicitGlobalSessionFromSidebar = useCallback(() => {
    closeMobileSidebar()
    startNewExplicitGlobalSession()
  }, [closeMobileSidebar, startNewExplicitGlobalSession])

  const startNewProjectChatFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    void startNewProjectChatWithInspectorReset(project)
  }, [closeMobileSidebar, startNewProjectChatWithInspectorReset])

  const openGlobalSkillsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openGlobalSkills()
  }, [closeMobileSidebar, openGlobalSkills])

  const openMcpFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openMcp()
  }, [closeMobileSidebar, openMcp])

  const openAgentsFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openAgents()
  }, [closeMobileSidebar, openAgents])

  const openScheduledTasksFromSidebar = useCallback(() => {
    closeMobileSidebar()
    openScheduledTasks()
  }, [closeMobileSidebar, openScheduledTasks])

  const openProjectSkillsFromSidebar = useCallback((project: ProjectInfo) => {
    closeMobileSidebar()
    openProjectSkills(project)
  }, [closeMobileSidebar, openProjectSkills])

  return {
    closeMobileSidebar,
    mobileSidebarDrawerRef,
    loadSessionFromSidebar,
    startNewDefaultSessionFromSidebar,
    startNewExplicitGlobalSessionFromSidebar,
    startNewProjectChatFromSidebar,
    openGlobalSkillsFromSidebar,
    openMcpFromSidebar,
    openAgentsFromSidebar,
    openScheduledTasksFromSidebar,
    openProjectSkillsFromSidebar,
  }
}
