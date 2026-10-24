import { BookOpen, Bot, CalendarClock, MessageSquarePlus, PanelLeft, PanelLeftOpen, Search, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  iconButtonClass,
  iconSlotClass,
  inactiveRowClass,
  sidebarRowClass,
  sidebarSessionTitleClass,
} from './sidebar-classes'

/** 侧栏顶部：logo / 开合按钮 + 新对话、搜索、定时任务、技能、MCP、Agents 六个入口。 */
export function SidebarHeaderNav({
  sidebarOpen,
  onToggleSidebar,
  onStartNewDefaultChat,
  onOpenSearch,
  onOpenScheduledTasks,
  onOpenGlobalSkills,
  onOpenMcp,
  onOpenAgents,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onStartNewDefaultChat: () => void
  onOpenSearch: () => void
  onOpenScheduledTasks: () => void
  onOpenGlobalSkills: () => void
  onOpenMcp: () => void
  onOpenAgents: () => void
}) {
  const rowClass = sidebarRowClass(sidebarOpen)
  const sessionTitleClass = sidebarSessionTitleClass

  return (
    <div className="shrink-0 px-3 pt-3 pb-1">
      <div className={cn(rowClass, 'w-full')}>
        {sidebarOpen ? (
          <>
            <span className={iconSlotClass}>
              <img src="/favicon.svg" alt="" aria-hidden="true" className="size-5" />
            </span>
            <button
              type="button"
              className={cn(iconButtonClass, 'ml-auto inline-flex items-center justify-center')}
              onClick={onToggleSidebar}
              aria-label={t('toggleSidebar')}
              title={t('toggleSidebar')}
            >
              <PanelLeft className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className={cn(iconButtonClass, 'group/toggle relative inline-flex items-center justify-center')}
            onClick={onToggleSidebar}
            aria-label={t('toggleSidebar')}
            title={t('toggleSidebar')}
          >
            <img src="/favicon.svg" alt="" aria-hidden="true" className="size-5 transition-opacity duration-160 group-hover/toggle:opacity-0 group-focus-visible/toggle:opacity-0" />
            <PanelLeftOpen className="absolute size-4 opacity-0 transition-opacity duration-160 group-hover/toggle:opacity-100 group-focus-visible/toggle:opacity-100" />
          </button>
        )}
      </div>
      <button
        type="button"
        className={cn(rowClass, 'mt-4 w-full', inactiveRowClass)}
        onClick={onStartNewDefaultChat}
        aria-label={t('startNewChat')}
        title={t('startNewChat')}
      >
        <span className={iconSlotClass}>
          <MessageSquarePlus className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('startNewChat')}</span> : null}
      </button>
      <button
        type="button"
        className={cn(rowClass, 'w-full', inactiveRowClass)}
        onClick={onOpenSearch}
        aria-label={t('search')}
      >
        <span className={iconSlotClass}>
          <Search className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('search')}</span> : null}
      </button>
      <button
        type="button"
        className={cn(rowClass, 'w-full', inactiveRowClass)}
        onClick={onOpenScheduledTasks}
        aria-label={t('scheduledTasks')}
        title={t('scheduledTasks')}
      >
        <span className={iconSlotClass}>
          <CalendarClock className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('scheduledTasks')}</span> : null}
      </button>
      <button
        type="button"
        className={cn(rowClass, 'w-full', inactiveRowClass)}
        onClick={onOpenGlobalSkills}
        aria-label={t('manageGlobalSkills')}
        title={t('manageGlobalSkills')}
      >
        <span className={iconSlotClass}>
          <BookOpen className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('skills')}</span> : null}
      </button>
      <button
        type="button"
        className={cn(rowClass, 'w-full', inactiveRowClass)}
        onClick={onOpenMcp}
        aria-label={t('mcpServers')}
        title={t('mcpServers')}
      >
        <span className={iconSlotClass}>
          <Server className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('mcpServers')}</span> : null}
      </button>
      <button
        type="button"
        className={cn(rowClass, 'w-full', inactiveRowClass)}
        onClick={onOpenAgents}
        aria-label={t('agentsTab')}
        title={t('agentsTab')}
      >
        <span className={iconSlotClass}>
          <Bot className="size-4" />
        </span>
        {sidebarOpen ? <span className={sessionTitleClass}>{t('agentsTab')}</span> : null}
      </button>
    </div>
  )
}
