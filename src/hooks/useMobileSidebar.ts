import { useCallback, useEffect, useRef } from 'react'
import type { ProjectInfo } from '@/lib/types'
import { useUIStore } from '@/stores/ui-store'

/** 移动端侧栏抽屉：role=dialog + aria-modal，所以 Escape 必须关闭、打开时焦点移入、
 *  关闭时还原给打开者。这里的 `*FromSidebar` 包装先收抽屉再转发桌面同名动作，
 *  与桌面直连处理器分开保持引用稳定（memo 的桌面 ChatSidebar 不随无关状态重渲染）。
 *  抽屉开合状态直连 ui-store（原 ui 参数已去除）。 */
export function useMobileSidebar(options: {
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
  const { loadSessionWithTransition, startNewDefaultSession, startNewExplicitGlobalSession, startNewProjectChatWithInspectorReset, openGlobalSkills, openMcp, openAgents, openScheduledTasks, openProjectSkills } = options

  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen)

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false)
  }, [setMobileSidebarOpen])

  const mobileSidebarDrawerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!mobileSidebarOpen) return
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
  }, [mobileSidebarOpen, closeMobileSidebar])

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
