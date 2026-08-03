import {
  Archive,
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarClock,
  Database,
  DownloadCloud,
  Globe2,
  Info,
  Brain,
  Palette,
  Puzzle,
  Search,
  Server,
  Share2,
  SlidersHorizontal,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SettingsTab } from '@earendil-works/pi-web-ui'
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
  channels: Share2,
  lanAccess: Globe2,
  about: Info,
} satisfies Record<SettingsInitialTab, LucideIcon>

function SettingsTabHost({ tab }: { tab: SettingsTab }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    host.replaceChildren(tab)
    return () => {
      if (tab.parentNode === host) host.removeChild(tab)
    }
  }, [tab])

  return <div ref={hostRef} className="quickforge-settings-tab-host min-h-0 flex-1" />
}

export function SettingsWorkspacePage({ initialTab, customProvider, onBack }: SettingsWorkspacePageProps) {
  const settings = useMemo(() => createSettingsTabs(customProvider), [customProvider])
  const defaultTabIndex = Math.max(0, settings.indexOf(initialTab))
  const [selectedTabIndex, setSelectedTabIndex] = useState<number | undefined>()
  const activeTabIndex = selectedTabIndex ?? defaultTabIndex
  const activeItem = settings.items[activeTabIndex] ?? settings.items[0]
  const activeDescription = activeItem?.getDescription?.()
  const ActiveIcon = activeItem ? SETTINGS_TAB_ICONS[activeItem.key] : undefined
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('')
  const normalizedSettingsSearchQuery = settingsSearchQuery.trim().toLowerCase()
  const filteredSettingsItems = useMemo(() => {
    return settings.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!normalizedSettingsSearchQuery) return true
        const searchText = [item.key, item.tab.getTabName(), item.getDescription?.() ?? ''].join(' ').toLowerCase()
        return searchText.includes(normalizedSettingsSearchQuery)
      })
  }, [settings.items, normalizedSettingsSearchQuery])

  return (
    <div className="flex h-screen min-h-0 supports-[height:100dvh]:h-dvh bg-[var(--quickforge-sidebar-bg)] text-foreground">
      <aside className="relative z-10 hidden w-80 shrink-0 overflow-hidden bg-[var(--quickforge-sidebar-bg)] md:flex md:min-h-0 md:flex-col">
        <div className="shrink-0 px-3 pb-2 pt-3">
          <button
            type="button"
            className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-muted-foreground/72 transition-[background-color,color,box-shadow] duration-160 ease-out hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:text-foreground/86 hover:shadow-[0_8px_20px_-18px_rgb(15_23_42_/_0.35)]"
            onClick={onBack}
            aria-label="返回工作区"
          >
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/55 transition-colors group-hover:text-foreground/70">
              <ArrowLeft className="size-4" />
            </span>
            <span className="truncate text-sm leading-5">返回工作区</span>
          </button>
          <div className="quickforge-settings-inline-field mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
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
              const active = index === activeTabIndex
              const Icon = SETTINGS_TAB_ICONS[item.key]
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    'group relative flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2 py-1.5 text-left text-sm leading-5 transition-[background-color,color,box-shadow] duration-160 ease-out',
                    active
                      ? 'bg-[var(--quickforge-sidebar-active-bg)] font-medium text-foreground/92 shadow-[0_8px_22px_-20px_rgb(15_23_42_/_0.32)]'
                      : 'text-muted-foreground/76 hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:text-foreground/90 hover:shadow-[0_8px_20px_-18px_rgb(15_23_42_/_0.35)]',
                  )}
                  onClick={() => setSelectedTabIndex(index)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center transition-colors',
                      active ? 'text-foreground/72' : 'text-muted-foreground/52 group-hover:text-foreground/68',
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="truncate">{item.tab.getTabName()}</span>
                </button>
              )
            })}
            {filteredSettingsItems.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground/70">{t('noSettingsResults')}</div>
            ) : null}
          </nav>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[var(--quickforge-main-bg)] md:overflow-hidden md:rounded-tl-2xl">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_34%,transparent)] px-3 pr-4 md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="返回工作区">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {ActiveIcon ? <ActiveIcon className="size-4 shrink-0 text-muted-foreground/65" aria-hidden="true" /> : null}
              <div className="min-w-0 truncate text-sm font-medium text-foreground/90">{activeItem?.tab.getTabName()}</div>
              {activeDescription ? <InfoTip label={activeDescription} /> : null}
            </div>
          </div>
        </header>

        <div className="shrink-0 border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_30%,transparent)] px-3 py-2 md:hidden">
          <div className="quickforge-settings-inline-field">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" aria-hidden="true" />
            <input
              value={settingsSearchQuery}
              onChange={(event) => setSettingsSearchQuery(event.target.value)}
              placeholder={t('searchSettings')}
              aria-label={t('searchSettings')}
              className="quickforge-settings-input"
            />
          </div>
        </div>

        <div className="quickforge-settings-mobile-tabs flex shrink-0 gap-1 overflow-x-auto border-b-[0.5px] border-[color-mix(in_oklab,var(--border)_30%,transparent)] px-3 py-2 md:hidden">
          {filteredSettingsItems.map(({ item, index }) => {
            const active = index === activeTabIndex
            const Icon = SETTINGS_TAB_ICONS[item.key]
            return (
              <button
                key={item.key}
                type="button"
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/55 hover:text-foreground',
                )}
                onClick={() => setSelectedTabIndex(index)}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{item.tab.getTabName()}</span>
              </button>
            )
          })}
          {filteredSettingsItems.length === 0 ? (
            <div className="shrink-0 px-1 py-1.5 text-sm text-muted-foreground/70">{t('noSettingsResults')}</div>
          ) : null}
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col">
            {activeItem ? <SettingsTabHost tab={activeItem.tab} /> : null}
          </div>
        </section>
      </main>
    </div>
  )
}
