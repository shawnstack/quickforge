import {
  Archive,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  ChevronRight,
  Database,
  Globe2,
  Info,
  Palette,
  Puzzle,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Webhook,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cloneElement, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { createSettingsTabs, type SettingsInitialTab } from '@/lib/settings-tabs'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type SettingsWorkspacePageProps = {
  initialTab: SettingsInitialTab
  customProvider?: string
  onBack: () => void
}

type SettingsRegistry = ReturnType<typeof createSettingsTabs>
type SettingsNavItem = SettingsRegistry['items'][number]

const SETTINGS_TAB_ICONS = {
  defaults: SlidersHorizontal,
  appearance: Palette,
  memory: Brain,
  network: Globe2,
  customModels: Database,
  agents: Bot,
  skills: BookOpen,
  mcp: Server,
  plugins: Puzzle,
  hooks: Webhook,
  scheduledTasks: CalendarClock,
  dreaming: Sparkles,
  projectCommands: SquareTerminal,
  data: Archive,
  about: Info,
} satisfies Record<SettingsInitialTab, LucideIcon>

// 旧版设置页里 tab 元素实例常驻、切走仅 detach，页内中间态跨切换保留；
// 这些 tab 内部有旧版同样保留的中间态（表单草稿、筛选条件、错误/进度提示等），
// 首次激活后保持挂载、仅以 hidden（display:none）隐藏即可对齐该语义。
// 其余 tab 旧版同样是重新 attach 即覆盖全部状态，保持切换即卸载。
const STATE_PRESERVING_TAB_KEYS = new Set<SettingsInitialTab>([
  'customModels',
  'defaults',
  'data',
  'network',
  'about',
])

// 浏览器（尤其 Chromium）会把无 name 的文本框当作可自动填充字段，
// 偶发把历史网址/账号填进设置搜索框；这里用非语义 name + off 切断推断。
const SETTINGS_SEARCH_INPUT_PROPS = {
  type: 'text',
  name: 'qf-settings-search',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
} as const

export function SettingsWorkspacePage({ initialTab, customProvider, onBack }: SettingsWorkspacePageProps) {
  const settings = useMemo(() => createSettingsTabs(customProvider), [customProvider])
  const defaultTabIndex = Math.max(0, settings.indexOf(initialTab))
  const [selectedTabIndex, setSelectedTabIndex] = useState<number | undefined>()
  // 移动端钻取导航：null = 主菜单，非 null = 二级页（对应 tab index）
  const [mobileDetail, setMobileDetail] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const activeTabIndex = selectedTabIndex ?? defaultTabIndex
  const activeItem = settings.items[activeTabIndex] ?? settings.items[0]
  const activeDescription = activeItem?.getDescription?.()
  const ActiveIcon = activeItem ? SETTINGS_TAB_ICONS[activeItem.key] : undefined
  const aboutItem = settings.about
  const aboutIndex = aboutItem ? settings.items.indexOf(aboutItem) : -1

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const groupLabelFor = (groupKey: string | undefined) => settings.groups.find((group) => group.key === groupKey)?.getLabel() ?? ''
  const matchesSearch = (item: SettingsNavItem) => {
    if (!normalizedQuery) return true
    return [item.getTabName(), item.getDescription?.() ?? '', item.keywords, groupLabelFor(item.group)]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  }
  const visibleGroups = settings.groups
    .map((group) => ({ key: group.key, getLabel: group.getLabel, items: group.items.filter(matchesSearch) }))
    .filter((group) => group.items.length > 0)
  const aboutVisible = Boolean(aboutItem && matchesSearch(aboutItem))
  const hasNoResults = Boolean(normalizedQuery) && visibleGroups.length === 0 && !aboutVisible

  // 有页内中间态的 tab：首次激活后保持挂载，切走时仅以 hidden 隐藏而非卸载，
  // 对齐旧版 tab 元素常驻、切回仅刷新数据的语义；其它 tab 维持切换即卸载的现状。
  const [visitedStatePreservingTabs, setVisitedStatePreservingTabs] = useState<ReadonlySet<SettingsInitialTab>>(() => new Set())
  const activeKey = activeItem?.key
  const activeStatePreservingTabKey = activeKey && STATE_PRESERVING_TAB_KEYS.has(activeKey) ? activeKey : undefined
  // 渲染期记忆（React 认可的"无需 effect"模式）：激活过一次后保持挂载标记
  if (activeStatePreservingTabKey && !visitedStatePreservingTabs.has(activeStatePreservingTabKey)) {
    setVisitedStatePreservingTabs(new Set([...visitedStatePreservingTabs, activeStatePreservingTabKey]))
  }

  const contentRef = useRef<HTMLElement>(null)
  const [showToTop, setShowToTop] = useState(false)
  // 切换 tab / 进入二级页时内容区滚动复位
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeTabIndex, mobileDetail])

  const selectTab = (index: number) => {
    setSelectedTabIndex(index)
    setSearchQuery('')
  }

  // Cross-tab jump. Dreaming lives under "Automation" while memory lives under
  // "Basic"; without this the memory page can only *describe* Dreaming, never
  // take you there.
  useEffect(() => {
    // Guarded for non-DOM renders (unit tests render this page without a window).
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    const handler = (event: Event) => {
      const key = (event as CustomEvent<{ tab?: SettingsInitialTab }>).detail?.tab
      if (!key) return
      const index = settings.indexOf(key)
      if (index >= 0) selectTab(index)
    }
    window.addEventListener('quickforge:open-settings-tab', handler)
    return () => window.removeEventListener('quickforge:open-settings-tab', handler)
  }, [settings])
  const selectMobileTab = (index: number) => {
    setSelectedTabIndex(index)
    setSearchQuery('')
    setMobileDetail(index)
  }
  const clearSearch = () => setSearchQuery('')

  const renderDesktopNavItem = (item: SettingsNavItem, index: number) => {
    const active = index === activeTabIndex
    const Icon = SETTINGS_TAB_ICONS[item.key]
    return (
      <button
        key={item.key}
        type="button"
        className={cn(
          'group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm leading-5 transition-[background-color,color,box-shadow] duration-160 ease-out',
          active
            ? 'bg-[var(--quickforge-sidebar-active-bg)] font-medium shadow-[0_8px_22px_-20px_rgb(15_23_42_/_0.32)]'
            : 'hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:shadow-[0_8px_20px_-18px_rgb(15_23_42_/_0.35)]',
        )}
        onClick={() => selectTab(index)}
        aria-current={active ? 'page' : undefined}
      >
        <span className="inline-flex size-5 shrink-0 items-center justify-center transition-colors">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="truncate">{item.getTabName()}</span>
        {item.beta ? <span className="quickforge-settings-beta">{t('dreamingBeta')}</span> : null}
      </button>
    )
  }

  const renderMobileNavItem = (item: SettingsNavItem, index: number) => {
    const Icon = SETTINGS_TAB_ICONS[item.key]
    return (
      <button
        key={item.key}
        type="button"
        className="quickforge-settings-mobile-list-item"
        onClick={() => selectMobileTab(index)}
      >
        <span className="quickforge-settings-mobile-list-icon">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
        </span>
        <span className="quickforge-settings-mobile-list-label">{item.getTabName()}</span>
        {item.beta ? <span className="quickforge-settings-beta">{t('dreamingBeta')}</span> : null}
        <ChevronRight className="quickforge-settings-mobile-list-chevron size-4 shrink-0" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="flex h-screen min-h-0 supports-[height:100dvh]:h-dvh bg-[var(--quickforge-sidebar-bg)] text-foreground">
      <aside className="relative z-10 hidden w-80 shrink-0 overflow-hidden bg-[var(--quickforge-sidebar-bg)] md:flex md:min-h-0 md:flex-col">
        <div className="shrink-0 px-3 pb-2 pt-3">
          <button
            type="button"
            className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left transition-[background-color,color,box-shadow] duration-160 ease-out hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:shadow-[0_8px_20px_-18px_rgb(15_23_42_/_0.35)]"
            onClick={onBack}
            aria-label="返回工作区"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors">
              <ArrowLeft className="size-4" />
            </span>
            <span className="truncate text-sm leading-5">返回工作区</span>
          </button>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              {...SETTINGS_SEARCH_INPUT_PROPS}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') clearSearch()
              }}
              placeholder={t('searchSettings')}
              aria-label={t('searchSettings')}
              className="h-8 w-full rounded-lg border border-transparent bg-[var(--quickforge-sidebar-hover-bg)] pl-8 pr-7 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[color-mix(in_oklab,var(--border)_60%,transparent)]"
            />
            {searchQuery
              ? (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                  onClick={clearSearch}
                  aria-label={t('clearSearch')}
                >
                  <X className="size-3.5" />
                </button>
              )
              : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <nav className="space-y-1" aria-label={t('settings')}>
            {hasNoResults
              ? <div className="px-2 py-6 text-center text-xs text-muted-foreground">{t('noMatchingSettings')}</div>
              : null}
            {visibleGroups.map((group) => (
              <div key={group.key} className="pb-4 last:pb-0">
                <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{group.getLabel()}</div>
                <div className="space-y-1">
                  {group.items.map((item) => renderDesktopNavItem(item, settings.items.indexOf(item)))}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {aboutItem && aboutVisible
          ? (
            <div className="shrink-0 border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3 py-2">
              {renderDesktopNavItem(aboutItem, aboutIndex)}
            </div>
          )
          : null}
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl md:border-l md:border-t border-[color-mix(in_oklab,var(--border)_60%,transparent)]">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] px-3 pr-4 md:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={mobileDetail === null ? onBack : () => setMobileDetail(null)}
            aria-label={mobileDetail === null ? '返回工作区' : '返回设置'}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            {/* 移动端主菜单：设置标题 */}
            <div className={cn('flex min-w-0 items-center gap-2', mobileDetail === null ? 'md:hidden' : 'hidden')}>
              <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 truncate text-sm font-medium">{t('settings')}</div>
            </div>
            {/* 二级页 / 桌面端：当前 tab 标题 */}
            <div className={cn('flex min-w-0 items-center gap-2', mobileDetail === null && 'hidden md:flex')}>
              {ActiveIcon ? <ActiveIcon className="size-4 shrink-0" aria-hidden="true" /> : null}
              <div className="min-w-0 truncate text-sm font-medium">{activeItem?.getTabName()}</div>
              {activeItem?.beta ? <span className="quickforge-settings-beta">{t('dreamingBeta')}</span> : null}
              {activeDescription ? <InfoTip label={activeDescription} /> : null}
            </div>
          </div>
        </header>

        <div className={cn('flex min-h-0 flex-1 flex-col md:hidden', mobileDetail !== null && 'hidden')}>
          <div className="quickforge-settings-mobile-list">
            <div className="quickforge-settings-inline-field px-1 pb-2 pt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                {...SETTINGS_SEARCH_INPUT_PROPS}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') clearSearch()
                }}
                className="quickforge-settings-input pr-10"
                placeholder={t('searchSettings')}
                aria-label={t('searchSettings')}
              />
              {searchQuery
                ? (
                  <button
                    type="button"
                    className="quickforge-settings-inline-field-button"
                    onClick={clearSearch}
                    aria-label={t('clearSearch')}
                  >
                    <X className="size-4" />
                  </button>
                )
                : null}
            </div>
            <nav className="flex flex-col gap-4" aria-label={t('settings')}>
              {hasNoResults
                ? <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t('noMatchingSettings')}</div>
                : null}
              {visibleGroups.map((group) => (
                <div key={group.key}>
                  <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">{group.getLabel()}</div>
                  <div className="quickforge-settings-mobile-list-card">
                    {group.items.map((item) => renderMobileNavItem(item, settings.items.indexOf(item)))}
                  </div>
                </div>
              ))}
              {aboutItem && aboutVisible
                ? (
                  <div>
                    <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">{t('about')}</div>
                    <div className="quickforge-settings-mobile-list-card">
                      {renderMobileNavItem(aboutItem, aboutIndex)}
                    </div>
                  </div>
                )
                : null}
            </nav>
          </div>
        </div>

        <section
          ref={contentRef}
          onScroll={() => setShowToTop((contentRef.current?.scrollTop ?? 0) > 160)}
          className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7', mobileDetail === null && 'hidden md:block')}
        >
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
            {activeItem ? (
              <div className="quickforge-settings-tab-host min-h-0 flex-1">
                {settings.items.map((item) => {
                  const isActive = item.key === activeItem.key
                  if (STATE_PRESERVING_TAB_KEYS.has(item.key)) {
                    if (!isActive && !visitedStatePreservingTabs.has(item.key)) return null
                    // 常驻 tab 始终保持挂载：hidden 只是视觉隐藏，React state 不丢；
                    // active 用于让 tab 在非激活时停掉后台工作、重新激活时重载数据。
                    return (
                      <div key={item.key} hidden={!isActive}>
                        {cloneElement(item.content, { active: isActive })}
                      </div>
                    )
                  }
                  return isActive ? item.content : null
                })}
              </div>
            ) : null}
          </div>
        </section>
        <button
          type="button"
          onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="返回顶部"
          className={cn(
            'absolute bottom-5 right-4 z-20 flex size-9 items-center justify-center rounded-[10px] border-[0.5px] border-[color-mix(in_oklab,var(--border)_65%,transparent)] bg-[var(--background)] shadow-[0_10px_24px_-16px_rgb(15_23_42_/_0.55)] transition-opacity duration-160 md:hidden',
            showToTop ? 'opacity-100' : 'pointer-events-none opacity-0',
            mobileDetail === null && 'hidden',
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </main>
    </div>
  )
}
