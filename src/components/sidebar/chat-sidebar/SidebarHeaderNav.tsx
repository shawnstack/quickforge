import { BookOpen, Bot, CalendarClock, MessageSquare, MessageSquarePlus, PanelLeft, PanelLeftOpen, Search, Server, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import {
  iconButtonClass,
  iconSlotClass,
  inactiveRowClass,
  modeSwitcherOptionActiveClass,
  modeSwitcherOptionClass,
  modeSwitcherOptionIdleClass,
  modeSwitcherTrackClass,
  sidebarRowClass,
  sidebarSessionTitleClass,
} from './sidebar-classes'

/** 侧栏顶部：logo / 开合按钮 + 「对话 / BOT」模式切换 + 新对话、搜索、定时任务、技能、MCP、Agents 入口。 */
export function SidebarHeaderNav({
  sidebarOpen,
  onToggleSidebar,
  onStartNewDefaultChat,
  onOpenSearch,
  onOpenScheduledTasks,
  onOpenGlobalSkills,
  onOpenMcp,
  onOpenAgents,
  botMode,
  onToggleBotMode,
  onStartNewBot,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  onStartNewDefaultChat: () => void
  onOpenSearch: () => void
  onOpenScheduledTasks: () => void
  onOpenGlobalSkills: () => void
  onOpenMcp: () => void
  onOpenAgents: () => void
  botMode: boolean
  onToggleBotMode: () => void
  onStartNewBot: () => void
}) {
  const rowClass = sidebarRowClass(sidebarOpen)
  const sessionTitleClass = sidebarSessionTitleClass
  // 「对话 / BOT」二选一：点当前项不该再触发一次切模式（会白白刷新一次会话）。
  const selectMode = (next: 'chat' | 'bot') => {
    const alreadyActive = next === 'bot' ? botMode : !botMode
    if (alreadyActive) return
    onToggleBotMode()
  }

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
          <div className="flex w-full flex-col items-center gap-1">
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
          </div>
        )}
      </div>
      {sidebarOpen ? (
        <div className={modeSwitcherTrackClass} role="group" aria-label={t('modeSwitcherLabel')}>
          <button
            type="button"
            className={cn(
              modeSwitcherOptionClass,
              botMode ? modeSwitcherOptionIdleClass : modeSwitcherOptionActiveClass,
            )}
            onClick={() => selectMode('chat')}
            aria-pressed={!botMode}
          >
            <MessageSquare className="size-3.5 shrink-0" />
            <span className="truncate">{t('chatModeLabel')}</span>
          </button>
          <button
            type="button"
            className={cn(
              modeSwitcherOptionClass,
              botMode ? modeSwitcherOptionActiveClass : modeSwitcherOptionIdleClass,
            )}
            onClick={() => selectMode('bot')}
            aria-pressed={botMode}
          >
            <Bot className="size-3.5 shrink-0" />
            <span className="truncate">{t('botModeLabel')}</span>
          </button>
        </div>
      ) : null}
      {botMode ? (
        <button
          type="button"
          className={cn(rowClass, 'w-full', sidebarOpen ? 'mt-1' : 'mt-4', inactiveRowClass)}
          onClick={onStartNewBot}
          aria-label={t('newBot')}
          title={t('newBot')}
        >
          <span className={iconSlotClass}>
            <Sparkles className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('newBot')}</span> : null}
        </button>
      ) : (
        <button
          type="button"
          className={cn(rowClass, 'w-full', sidebarOpen ? 'mt-1' : 'mt-4', inactiveRowClass)}
          onClick={onStartNewDefaultChat}
          aria-label={t('startNewChat')}
          title={t('startNewChat')}
        >
          <span className={iconSlotClass}>
            <MessageSquarePlus className="size-4" />
          </span>
          {sidebarOpen ? <span className={sessionTitleClass}>{t('startNewChat')}</span> : null}
        </button>
      )}
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
