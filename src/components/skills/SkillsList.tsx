import type { RefObject } from 'react'
import { BookOpen, ChevronRight, Loader2, Search } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SkillSummary, SkillsScope } from '@/lib/types'
import { SkillGlyph } from './SkillGlyph'
import { sourceGroupHint, sourceGroupLabel, type SourceGroup } from './skill-source'

export type GroupedSkills = Array<{ group: SourceGroup; skills: SkillSummary[] }>

type SkillsListProps = {
  listRef: RefObject<HTMLDivElement | null>
  loading: boolean
  hasFilters: boolean
  filteredCount: number
  groupedSkills: GroupedSkills
  selectedSkills: Set<string>
  pendingNames: Set<string>
  selectedSkillName: string | null
  bulkSaving: boolean
  scope: SkillsScope
  onOpenSkill: (skill: SkillSummary) => void
  onToggleSkill: (skillName: string) => void
  onClearFilters: () => void
  onRescan: () => void
  refreshing: boolean
}

/** 技能列表：加载态、空态（无技能/无匹配）与按来源分组的技能行。 */
export function SkillsList({
  listRef,
  loading,
  hasFilters,
  filteredCount,
  groupedSkills,
  selectedSkills,
  pendingNames,
  selectedSkillName,
  bulkSaving,
  scope,
  onOpenSkill,
  onToggleSkill,
  onClearFilters,
  onRescan,
  refreshing,
}: SkillsListProps) {
  if (loading) {
    return (
      <div className="quickforge-skills-list" ref={listRef} role="list" aria-label={t('availableSkills')}>
        <div className="quickforge-skills-loading">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {t('loading')}
        </div>
      </div>
    )
  }

  if (filteredCount === 0) {
    return (
      <div className="quickforge-skills-list" ref={listRef} role="list" aria-label={t('availableSkills')}>
        <div className="quickforge-skills-empty">
          <span className="quickforge-skills-empty-orb" aria-hidden="true">
            {hasFilters ? <Search className="size-4" /> : <BookOpen className="size-4" />}
          </span>
          <p className="quickforge-skills-empty-title">
            {hasFilters ? t('skillsNoMatchesTitle') : t('skillsEmptyTitle')}
          </p>
          <p className="quickforge-skills-empty-desc">
            {hasFilters ? t('skillsNoMatchesDescription') : t('skillsEmptyDescription')}
          </p>
          {hasFilters
            ? (
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                onClick={onClearFilters}
              >
                {t('skillsClearFilters')}
              </button>
            )
            : (
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                onClick={onRescan}
                disabled={refreshing}
              >
                {t('skillsRescan')}
              </button>
            )}
        </div>
      </div>
    )
  }

  return (
    <div className="quickforge-skills-list" ref={listRef} role="list" aria-label={t('availableSkills')}>
      {groupedSkills.map(({ group, skills: groupSkills }) => (
        <div key={group} className="quickforge-skills-group">
          <div className="quickforge-skills-group-head" data-group={group}>
            <span className="quickforge-skills-source-dot" data-group={group} aria-hidden="true" />
            <span className="quickforge-skills-group-name">{sourceGroupLabel(group, scope)}</span>
            <span className="quickforge-skills-group-count">{groupSkills.length}</span>
            <span className="quickforge-skills-group-hint">{sourceGroupHint(group, scope)}</span>
          </div>
          {groupSkills.map((skill) => {
            const enabled = selectedSkills.has(skill.name)
            const isSelected = skill.name === selectedSkillName
            const isPending = pendingNames.has(skill.name)
            const displayName = skill.displayName || skill.name
            return (
              <div
                key={skill.name}
                className="quickforge-skills-row"
                data-group={group}
                data-selected={isSelected ? 'true' : undefined}
                data-saving={isPending ? 'true' : undefined}
                aria-busy={isPending || undefined}
                role="listitem"
              >
                <button
                  type="button"
                  className="quickforge-skills-row-main"
                  onClick={() => onOpenSkill(skill)}
                  aria-label={t('skillsViewSkill', { name: displayName })}
                >
                  <span className="quickforge-skills-tile" data-group={group} aria-hidden="true">
                    <SkillGlyph skill={skill} className="size-4" />
                  </span>
                  <span className="quickforge-skills-row-copy">
                    <span className="quickforge-skills-name">{displayName}</span>
                    {skill.description ? <span className="quickforge-skills-desc">{skill.description}</span> : null}
                    {(skill.tags?.length || skill.version)
                      ? (
                        <span className="quickforge-skills-row-meta">
                          {skill.tags?.slice(0, 2).map((tag) => (
                            <span key={tag} className="quickforge-skills-tag">{tag}</span>
                          ))}
                          {skill.version ? <span className="quickforge-skills-version">v{skill.version}</span> : null}
                        </span>
                      )
                      : null}
                  </span>
                </button>
                <div className="quickforge-skills-row-end">
                  <span className="quickforge-skills-switch-wrap">
                    <label className="quickforge-settings-switch" aria-disabled={isPending || bulkSaving ? 'true' : 'false'}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={isPending || bulkSaving || loading}
                        onChange={() => onToggleSkill(skill.name)}
                        aria-label={enabled
                          ? t('skillsDisableNamedSkill', { name: displayName })
                          : t('skillsEnableNamedSkill', { name: displayName })}
                      />
                      <span aria-hidden="true" />
                    </label>
                    {isPending ? <Loader2 className="quickforge-skills-switch-spinner" aria-hidden="true" /> : null}
                  </span>
                  <ChevronRight className="quickforge-skills-chevron" aria-hidden="true" />
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
