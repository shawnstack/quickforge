import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, FolderTree, Info, Loader2, X } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '@/lib/i18n'
import type { SkillContent } from '@/lib/skills-client'
import type { SkillSummary, SkillsScope } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SkillGlyph } from './SkillGlyph'
import { sourceGroupFor, sourceGroupLabel } from './skill-source'

type DetailTab = 'overview' | 'instructions' | 'metadata'

const DETAIL_TABS: DetailTab[] = ['overview', 'instructions', 'metadata']
const markdownRemarkPlugins = [remarkGfm]

const skillMarkdownComponents: Components = {
  a: ({ href, children }) => (
    <a className="quickforge-skills-md-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="quickforge-skills-md-pre">{children}</pre>,
  code: ({ className, children }) => (
    <code className={cn('quickforge-skills-md-code', className)}>{children}</code>
  ),
  table: ({ children }) => (
    <div className="quickforge-skills-md-table">
      <table>{children}</table>
    </div>
  ),
  input: ({ type, checked, disabled }) => type === 'checkbox'
    ? <input className="quickforge-skills-md-checkbox" type="checkbox" checked={checked} disabled={disabled ?? true} readOnly />
    : null,
}

function SkillMetaRow({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="quickforge-skills-meta-row">
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : undefined}>{value ?? '—'}</dd>
    </div>
  )
}

type SkillDetailDialogProps = {
  skill: SkillSummary
  scope: SkillsScope
  content: SkillContent | null
  contentLoading: boolean
  contentError: string
  enabled: boolean
  pending: boolean
  bulkSaving: boolean
  listLoading: boolean
  copiedTarget: string | null
  onToggle: (skillName: string) => void
  onReloadContent: (skillName: string) => void
  onCopyText: (text: string, target: string, successMessage: string) => void
  onClose: () => void
}

/** 技能详情弹窗：portal 渲染到 body，含启用开关与概览/指令/元数据三个标签页。 */
export function SkillDetailDialog({
  skill,
  scope,
  content,
  contentLoading,
  contentError,
  enabled,
  pending,
  bulkSaving,
  listLoading,
  copiedTarget,
  onToggle,
  onReloadContent,
  onCopyText,
  onClose,
}: SkillDetailDialogProps) {
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [prevSkillName, setPrevSkillName] = useState(skill.name)
  const detailDialogRef = useRef<HTMLDivElement>(null)

  if (prevSkillName !== skill.name) {
    // 切换到另一个技能时回到概览页（渲染期间重置，避免额外 effect 提交）
    setPrevSkillName(skill.name)
    setDetailTab('overview')
  }

  useEffect(() => {
    detailDialogRef.current?.focus({ preventScroll: true })
  }, [skill.name])

  if (typeof document === 'undefined') return null

  const selectedTriggers = skill.triggers ?? content?.triggers ?? []
  const selectedTags = skill.tags ?? content?.tags ?? []
  const detailTabLabels: Record<DetailTab, string> = {
    overview: t('skillsDetailOverview'),
    instructions: t('skillsDetailInstructions'),
    metadata: t('skillsDetailMetadata'),
  }
  const displayName = skill.displayName || skill.name

  const overview = (
    <>
      <div className="quickforge-skills-detail-section">
        <p className="quickforge-skills-lead">{skill.description || '—'}</p>
      </div>
      {selectedTriggers.length > 0
        ? (
          <div className="quickforge-skills-detail-section">
            <h4 className="quickforge-skills-section-label">{t('skillsTriggers')}</h4>
            <div className="quickforge-skills-chips">
              {selectedTriggers.map((trigger) => (
                <span key={trigger} className="quickforge-skills-chip">{trigger}</span>
              ))}
            </div>
          </div>
        )
        : null}
      {selectedTags.length > 0
        ? (
          <div className="quickforge-skills-detail-section">
            <h4 className="quickforge-skills-section-label">{t('skillsTags')}</h4>
            <div className="quickforge-skills-chips">
              {selectedTags.map((tag) => (
                <span key={tag} className="quickforge-skills-chip">{tag}</span>
              ))}
            </div>
          </div>
        )
        : null}
      <div className="quickforge-skills-detail-section">
        <h4 className="quickforge-skills-section-label">{t('skillsSource')}</h4>
        <div className="quickforge-skills-source-line">
          <FolderTree className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{sourceGroupLabel(sourceGroupFor(skill), scope)}</span>
          <code>{skill.source || '—'}</code>
        </div>
      </div>
      <p className="quickforge-skills-detail-note">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        {t('skillsPageDescription')}
      </p>
    </>
  )

  const instructions = (
    <>
      <div className="quickforge-skills-instruction-head">
        <span className="quickforge-skills-file-name">SKILL.md</span>
        {content?.totalLines
          ? <span className="quickforge-skills-line-badge">{t('skillsInstructionLines', { count: content.totalLines })}</span>
          : null}
        <button
          type="button"
          className="quickforge-settings-icon-action quickforge-skills-copy-action"
          aria-label={t('skillsCopyInstructions')}
          title={t('skillsCopyInstructions')}
          disabled={!content?.instructions || contentLoading}
          onClick={() => {
            if (content?.instructions) {
              onCopyText(content.instructions, 'instructions', t('skillsInstructionsCopied'))
            }
          }}
        >
          {copiedTarget === 'instructions'
            ? <Check className="size-4" aria-hidden="true" />
            : <Copy className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {contentLoading
        ? (
          <div className="quickforge-skills-loading">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('loading')}
          </div>
        )
        : contentError
          ? (
            <div className="quickforge-settings-alert quickforge-skills-content-error" role="alert">
              <span>{contentError}</span>
              <button
                type="button"
                className="quickforge-skills-text-button"
                onClick={() => onReloadContent(skill.name)}
              >
                {t('retry')}
              </button>
            </div>
          )
          : content?.instructions
            ? (
              <div className="quickforge-skills-md">
                <ReactMarkdown
                  remarkPlugins={markdownRemarkPlugins}
                  components={skillMarkdownComponents}
                  skipHtml
                >
                  {content.instructions}
                </ReactMarkdown>
              </div>
            )
            : <div className="quickforge-skills-inline-empty">{t('noSkillContent')}</div>}
    </>
  )

  const metadata = (
    <dl className="quickforge-skills-meta-list">
      <SkillMetaRow label={t('skillsMetadataName')} value={skill.name} mono />
      <SkillMetaRow label={t('skillsMetadataVersion')} value={skill.version} />
      <SkillMetaRow label={t('skillsMetadataLicense')} value={skill.license} />
      <SkillMetaRow label={t('skillsMetadataCompatibility')} value={skill.compatibility} />
      <SkillMetaRow label={t('skillsMetadataAllowedTools')} value={skill.allowedTools} mono />
      <SkillMetaRow label={t('skillsMetadataEntry')} value={skill.entry} mono />
      <SkillMetaRow label={t('skillsMetadataSourceId')} value={skill.source} mono />
      <SkillMetaRow label={t('skillsTags')} value={selectedTags.length ? selectedTags.join(', ') : null} />
      <SkillMetaRow label={t('skillsTriggers')} value={selectedTriggers.length ? selectedTriggers.join(', ') : null} />
      {content ? <SkillMetaRow label={t('skillsMetadataLines')} value={content.totalLines} /> : null}
    </dl>
  )

  return createPortal(
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={detailDialogRef}
        tabIndex={-1}
        className="quickforge-dialog-panel-in quickforge-skills-detail-dialog flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-quickforge"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quickforge-skill-detail-title"
      >
        <div className="quickforge-skills-detail-head">
          <span className="quickforge-skills-tile quickforge-skills-tile-lg" data-group={sourceGroupFor(skill)} aria-hidden="true">
            <SkillGlyph skill={skill} className="size-5" />
          </span>
          <div className="quickforge-skills-detail-id">
            <div className="quickforge-skills-detail-name" id="quickforge-skill-detail-title">
              {displayName}
            </div>
            <div className="quickforge-skills-detail-slug">{skill.name}</div>
          </div>
          <button
            type="button"
            className="quickforge-settings-icon-action"
            onClick={onClose}
            aria-label={t('skillsCloseDetail')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="quickforge-skills-detail-switch-row">
          <span className="quickforge-skills-switch-wrap">
            <label className="quickforge-settings-switch" aria-disabled={pending || bulkSaving ? 'true' : 'false'}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={pending || bulkSaving || listLoading}
                onChange={() => onToggle(skill.name)}
                aria-label={enabled
                  ? t('skillsDisableNamedSkill', { name: displayName })
                  : t('skillsEnableNamedSkill', { name: displayName })}
              />
              <span aria-hidden="true" />
            </label>
            {pending ? <Loader2 className="quickforge-skills-switch-spinner" aria-hidden="true" /> : null}
          </span>
          <span className="quickforge-skills-switch-text">{t('skillsEnabledForChats')}</span>
          <span className="quickforge-skills-switch-hint">
            {enabled ? t('enabled') : t('disabled')}
          </span>
        </div>
        <div className="quickforge-skills-tabs" role="tablist" aria-label={t('skillsDetailLabel')}>
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`quickforge-skill-tab-${tab}`}
              aria-selected={detailTab === tab}
              aria-controls={`quickforge-skill-panel-${tab}`}
              className="quickforge-skills-tab"
              onClick={() => setDetailTab(tab)}
            >
              {detailTabLabels[tab]}
            </button>
          ))}
        </div>
        <div
          className="quickforge-skills-detail-scroll"
          role="tabpanel"
          id={`quickforge-skill-panel-${detailTab}`}
          aria-labelledby={`quickforge-skill-tab-${detailTab}`}
        >
          {detailTab === 'overview' ? overview : detailTab === 'instructions' ? instructions : metadata}
        </div>
      </div>
    </div>,
    document.body,
  )
}
