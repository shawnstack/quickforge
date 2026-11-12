import type { RefObject } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { SourceFilter } from './skill-source'

export type StatusFilter = 'all' | 'enabled' | 'disabled'

export type SourceOption = { value: SourceFilter; label: string; count: number }
export type StatusOption = { value: StatusFilter; label: string }

type SkillsToolbarProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
  query: string
  onQueryChange: (query: string) => void
  sourceFilter: SourceFilter
  onSourceFilterChange: (filter: SourceFilter) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (filter: StatusFilter) => void
  sourceMenuOpen: boolean
  setSourceMenuOpen: (open: boolean) => void
  closePathsMenu: () => void
  sourceMenuRef: RefObject<HTMLDivElement | null>
  sourceOptions: SourceOption[]
  statusOptions: StatusOption[]
  loading: boolean
}

/** 工具栏：关键字搜索（Ctrl K 聚焦）、来源下拉与启用状态分段筛选。 */
export function SkillsToolbar({
  searchInputRef,
  query,
  onQueryChange,
  sourceFilter,
  onSourceFilterChange,
  statusFilter,
  onStatusFilterChange,
  sourceMenuOpen,
  setSourceMenuOpen,
  closePathsMenu,
  sourceMenuRef,
  sourceOptions,
  statusOptions,
  loading,
}: SkillsToolbarProps) {
  return (
    <div className="quickforge-skills-toolbar">
      <div className="quickforge-skills-search">
        <Search className="quickforge-skills-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="text"
          name="qf-skills-search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) onQueryChange('')
          }}
          placeholder={t('skillsSearchPlaceholder')}
          aria-label={t('skillsSearchPlaceholder')}
          disabled={loading}
        />
        {query
          ? (
            <button
              type="button"
              className="quickforge-skills-search-clear"
              aria-label={t('clearSearch')}
              onClick={() => {
                onQueryChange('')
                searchInputRef.current?.focus()
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )
          : <kbd className="quickforge-skills-search-kbd">Ctrl K</kbd>}
      </div>
      <div className="quickforge-skills-filters">
        <div className="quickforge-skills-dropdown" ref={sourceMenuRef}>
          <button
            type="button"
            className="quickforge-skills-filter-button"
            aria-haspopup="listbox"
            aria-expanded={sourceMenuOpen}
            onClick={() => {
              setSourceMenuOpen(!sourceMenuOpen)
              closePathsMenu()
            }}
            disabled={loading}
          >
            <span className="quickforge-skills-filter-label">{t('skillsFilterSource')}</span>
            <span>{sourceOptions.find((option) => option.value === sourceFilter)?.label}</span>
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
          {sourceMenuOpen
            ? (
              <div
                className="quickforge-skills-menu quickforge-menu-in"
                role="listbox"
                aria-label={t('skillsFilterSource')}
              >
                {sourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={sourceFilter === option.value}
                    className={cn('quickforge-skills-menu-item', sourceFilter === option.value && 'is-active')}
                    onClick={() => {
                      onSourceFilterChange(option.value)
                      setSourceMenuOpen(false)
                    }}
                  >
                    <span className="quickforge-skills-menu-check" aria-hidden="true">
                      {sourceFilter === option.value ? <Check className="size-3.5" /> : null}
                    </span>
                    <span>{option.label}</span>
                    <span className="quickforge-skills-menu-count">{option.count}</span>
                  </button>
                ))}
              </div>
            )
            : null}
        </div>
        <div className="quickforge-skills-segmented" role="group" aria-label={t('skillsFilterStatus')}>
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(statusFilter === option.value && 'is-active')}
              aria-pressed={statusFilter === option.value}
              onClick={() => onStatusFilterChange(option.value)}
              disabled={loading}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
