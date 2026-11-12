import { Loader2 } from 'lucide-react'
import { t } from '@/lib/i18n'

type SkillsSummaryProps = {
  enabledCount: number
  total: number
  bulkSaving: boolean
  disabled: boolean
  disableAllDisabled: boolean
  filteredCount: number
  onEnableAll: () => void
  onDisableAll: () => void
}

/** 摘要行：已启用计数 + 对当前筛选结果的批量启用/停用。 */
export function SkillsSummary({
  enabledCount,
  total,
  bulkSaving,
  disabled,
  disableAllDisabled,
  filteredCount,
  onEnableAll,
  onDisableAll,
}: SkillsSummaryProps) {
  return (
    <div className="quickforge-skills-summary">
      <div className="quickforge-skills-summary-label">
        {t('skillsEnabledSummary', { enabled: enabledCount, total })}
      </div>
      <div className="quickforge-skills-summary-actions">
        {bulkSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
        <button
          type="button"
          className="quickforge-skills-text-button"
          onClick={onEnableAll}
          disabled={disabled}
          title={t('skillsEnableAllHint', { count: filteredCount })}
        >
          {t('skillsEnableAll')}
        </button>
        <span className="quickforge-skills-dot-separator" aria-hidden="true">·</span>
        <button
          type="button"
          className="quickforge-skills-text-button"
          onClick={onDisableAll}
          disabled={disableAllDisabled}
          title={t('skillsDisableAllHint', { count: filteredCount })}
        >
          {t('skillsDisableAll')}
        </button>
      </div>
    </div>
  )
}
