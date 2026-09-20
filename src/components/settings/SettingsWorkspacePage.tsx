import {
  Archive,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Bot,
  CalendarClock,
  ChevronRight,
  Database,
  DownloadCloud,
  Globe2,
  Info,
  Brain,
  Link2,
  Palette,
  Puzzle,
  Search,
  Server,
  Share2,
  SlidersHorizontal,
  SquareTerminal,
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

const SETTINGS_TAB_ICONS = {
  appearance: Palette,
  defaults: SlidersHorizontal,
  memory: Brain,
  customModels: Database,
  agents: Bot,
  skills: BookOpen,
  mcp: Server,
  plugins: Puzzle,
  scheduledTasks: CalendarClock,
  projectCommands: SquareTerminal,
  backup: DownloadCloud,
  archivedConversations: Archive,
  shareLinks: Link2,
  channels: Share2,
  lanAccess: Globe2,
  about: Info,
} satisfies Record<SettingsInitialTab, LucideIcon>

// 旧版设置页里 tab 元素实例常驻、切走仅 detach，页内中间态跨切换保留；
// 这些 tab 内部有旧版同样保留的中间态（表单草稿、筛选条件、错误/进度提示等），
// 首次激活后保持挂载、仅以 hidden（display:none）隐藏即可对齐该语义。
// 其余 tab 旧版同样是重新 attach 即覆盖全部状态，保持切换即卸载。
const STATE_PRESERVING_TAB_KEYS = new Set<SettingsInitialTab>([
  'customModels',
  'defaults',
  'backup',
  'archivedConversations',
  'lanAccess',
  'channels',
  'about',
])

export function SettingsWorkspacePage({ initialTab, customProvider, onBack }: SettingsWorkspacePageProps) {
  const settings = useMemo(() => createSettingsTabs(customProvider), [customProvider])
  const defaultTabIndex = Math.max(0, settings.indexOf(initialTab))
  const [selectedTabIndex, setSelectedTabIndex] = useState<number | undefined>()
  // 移动端钻取导航：null = 主菜单，非 null = 二级页（对应 tab index）
  const [mobileDetail, setMobileDetail] = useState<number | null>(null)
  const activeTabIndex = selectedTabIndex ?? defaultTabIndex
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('')
  const normalizedSettingsSearchQuery = settingsSearchQuery.trim().toLowerCase()
  const filteredSettingsItems = useMemo(() => {
    return settings.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!normalizedSettingsSearchQuery) return true
        const searchText = [item.key, item.getTabName(), item.getDescription?.() ?? ''].join(' ').toLowerCase()
        return searchText.includes(normalizedSettingsSearchQuery)
      })
  }, [settings.items, normalizedSettingsSearchQuery])

  // 搜索联动：命中后内容区自动切到第一个匹配项，清空搜索回到原 tab
  const visibleTabIndex = useMemo(() => {
    if (!normalizedSettingsSearchQuery) return activeTabIndex
    const first = filteredSettingsItems[0]
    if (!first) return activeTabIndex
    return filteredSettingsItems.some(({ index }) => index === activeTabIndex) ? activeTabIndex : first.index
  }, [activeTabIndex, filteredSettingsItems, normalizedSettingsSearchQuery])

  const activeItem = settings.items[visibleTabIndex] ?? settings.items[0]
  const activeDescription = activeItem?.getDescription?.()
  const ActiveIcon = activeItem ? SETTINGS_TAB_ICONS[activeItem.key] : undefined
  // 搜索无结果时旧版只是把 tab 元素从 host 摘除（detach），元素实例与页内中间态仍保留；
  // 因此内容区 host 始终渲染、仅以 hidden 隐藏，占位符独立渲染在其后。
  const hasSettingsResults = filteredSettingsItems.length > 0

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
  }, [visibleTabIndex, mobileDetail])

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
          <div className="quickforge-settings-inline-field mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden="true" />
            <input
              value={settingsSearchQuery}
              onChange={(event) => setSettingsSearchQuery(event.target.value)}
              placeholder={t('searchSettings')}
              aria-label={t('searchSettings')}
              className="quickforge-settings-input"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-4">
          <nav className="space-y-1" aria-label={t('settings')}>
            {filteredSettingsItems.map(({ item, index }) => {
              const active = index === visibleTabIndex
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
                  onClick={() => setSelectedTabIndex(index)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center transition-colors',
                      active ? '' : '',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="truncate">{item.getTabName()}</span>
                </button>
              )
            })}
            {filteredSettingsItems.length === 0 ? (
              <div className="px-2 py-3 text-sm">{t('noSettingsResults')}</div>
            ) : null}
          </nav>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 pr-4 md:px-5">
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
              {activeDescription ? <InfoTip label={activeDescription} /> : null}
            </div>
          </div>
        </header>

        <div className={cn('flex min-h-0 flex-1 flex-col md:hidden', mobileDetail !== null && 'hidden')}>
          <div className="shrink-0 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_30%,transparent)] px-3 py-2">
            <div className="quickforge-settings-inline-field">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" aria-hidden="true" />
              <input
                value={settingsSearchQuery}
                onChange={(event) => setSettingsSearchQuery(event.target.value)}
                placeholder={t('searchSettings')}
                aria-label={t('searchSettings')}
                className="quickforge-settings-input"
              />
            </div>
          </div>

          <nav className="quickforge-settings-mobile-list" aria-label={t('settings')}>
            <div className="quickforge-settings-mobile-list-card">
              {filteredSettingsItems.map(({ item, index }) => {
                const Icon = SETTINGS_TAB_ICONS[item.key]
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="quickforge-settings-mobile-list-item"
                    onClick={() => {
                      setSelectedTabIndex(index)
                      setMobileDetail(index)
                    }}
                  >
                    <span className="quickforge-settings-mobile-list-icon">
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                    </span>
                    <span className="quickforge-settings-mobile-list-label">{item.getTabName()}</span>
                    <ChevronRight className="quickforge-settings-mobile-list-chevron size-4 shrink-0" aria-hidden="true" />
                  </button>
                )
              })}
              {filteredSettingsItems.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm">{t('noSettingsResults')}</div>
              ) : null}
            </div>
          </nav>
        </div>

        <section
          ref={contentRef}
          onScroll={() => setShowToTop((contentRef.current?.scrollTop ?? 0) > 160)}
          className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7', mobileDetail === null && 'hidden md:block')}
        >
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
            {activeItem ? (
              <div className="quickforge-settings-tab-host min-h-0 flex-1" hidden={!hasSettingsResults}>
                {settings.items.map((item) => {
                  const isActive = hasSettingsResults && item.key === activeItem.key
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
            {hasSettingsResults ? null : (
              <div className="rounded-xl border border-dashed border-[color-mix(in_oklab,var(--border)_70%,transparent)] p-8 text-center text-sm">
                {t('noSettingsResults')}
              </div>
            )}
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
