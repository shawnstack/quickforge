import type { RefObject } from 'react'
import { Check, ChevronDown, Copy, Loader2, RefreshCw } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { SkillsScope } from '@/lib/types'
import { sourcePathLabel } from './skill-source'

type SkillsPageHeadProps = {
  scope: SkillsScope
  searchPaths: string[]
  pathsOpen: boolean
  setPathsOpen: (open: boolean) => void
  closeSourceMenu: () => void
  pathsPopoverRef: RefObject<HTMLDivElement | null>
  copiedTarget: string | null
  onCopyText: (text: string, target: string, successMessage: string) => void
  onRescan: () => void
  busy: boolean
  loading: boolean
  refreshing: boolean
}

/** 页头：搜索路径只读弹层（含逐条复制）与重新扫描按钮。 */
export function SkillsPageHead({
  scope,
  searchPaths,
  pathsOpen,
  setPathsOpen,
  closeSourceMenu,
  pathsPopoverRef,
  copiedTarget,
  onCopyText,
  onRescan,
  busy,
  loading,
  refreshing,
}: SkillsPageHeadProps) {
  return (
    <div className="quickforge-skills-page-head">
      <p className="quickforge-skills-page-description">{t('skillsPageDescription')}</p>
      <div className="quickforge-skills-page-actions">
        {searchPaths.length > 0
          ? (
            <div className="quickforge-skills-dropdown" ref={pathsPopoverRef}>
              <button
                type="button"
                className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact quickforge-skills-action-button"
                aria-haspopup="dialog"
                aria-expanded={pathsOpen}
                onClick={() => {
                  setPathsOpen(!pathsOpen)
                  closeSourceMenu()
                }}
              >
                {t('skillSearchPaths')}
                <span className="quickforge-skills-count-chip">{searchPaths.length}</span>
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </button>
              {pathsOpen
                ? (
                  <div
                    className="quickforge-skills-popover quickforge-menu-in"
                    role="dialog"
                    aria-label={t('skillSearchPathsTitle')}
                  >
                    <div className="quickforge-skills-popover-head">{t('skillSearchPathsTitle')}</div>
                    <p className="quickforge-skills-popover-desc">{t('skillsSearchPathsDescription')}</p>
                    <div className="quickforge-skills-path-list">
                      {searchPaths.map((searchPath, index) => (
                        <div className="quickforge-skills-path-row" key={searchPath}>
                          <span className="quickforge-skills-path-meta">{sourcePathLabel(searchPath, index, scope)}</span>
                          <code title={searchPath}>{searchPath}</code>
                          <button
                            type="button"
                            className="quickforge-settings-icon-action"
                            aria-label={`${t('skillsCopyPath')}: ${searchPath}`}
                            onClick={() => onCopyText(searchPath, `path:${index}`, t('skillsPathCopied'))}
                          >
                            {copiedTarget === `path:${index}`
                              ? <Check className="size-3.5" aria-hidden="true" />
                              : <Copy className="size-3.5" aria-hidden="true" />}
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="quickforge-skills-popover-foot">{t('skillsSearchPathsHint')}</p>
                  </div>
                )
                : null}
            </div>
          )
          : null}
        <button
          type="button"
          className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact quickforge-skills-action-button"
          onClick={onRescan}
          disabled={loading || refreshing || busy}
        >
          {refreshing
            ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            : <RefreshCw className="size-3.5" aria-hidden="true" />}
          {refreshing ? t('skillsRescanning') : t('skillsRescan')}
        </button>
      </div>
    </div>
  )
}
