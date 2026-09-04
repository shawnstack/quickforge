import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InfoTip } from '@/components/ui/info-tip'
import { t } from '@/lib/i18n'
import type { ProjectInfo, SkillSummary, SkillsScope } from '@/lib/types'

type SkillsDialogProps = {
  open: boolean
  scope: SkillsScope
  project?: ProjectInfo
  onOpenChange: (open: boolean) => void
  onSaved: (payload: { scope: SkillsScope; project?: ProjectInfo; projects?: ProjectInfo[]; selectedSkills: string[] }) => void
}

type SkillsManagerPanelProps = {
  active?: boolean
  scope: SkillsScope
  project?: ProjectInfo
  embedded?: boolean
  onClose?: () => void
  onSaved: (payload: { scope: SkillsScope; project?: ProjectInfo; projects?: ProjectInfo[]; selectedSkills: string[] }) => void
}

type SkillsPayload = {
  skills: SkillSummary[]
  selectedSkills: string[]
  searchPaths?: string[]
}

type SavePayload = {
  selectedSkills: string[]
  projects?: ProjectInfo[]
}

type SkillContent = {
  name: string
  displayName?: string | null
  description?: string | null
  version?: string | null
  tags?: string[]
  triggers?: string[]
  compatibility?: string | null
  allowedTools?: string | null
  license?: string | null
  source?: string | null
  instructions: string
  totalLines: number
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export function SkillsManagerPanel({
  active = true,
  scope,
  project,
  embedded = false,
  onClose,
  onSaved,
}: SkillsManagerPanelProps) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [searchPaths, setSearchPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isProjectScope = scope === 'project'

  // --- Reading state (instructions modal) ---
  const [readingSkillName, setReadingSkillName] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null)
  const [readingLoading, setReadingLoading] = useState(false)
  const [readingError, setReadingError] = useState('')

  const resetReadingState = useCallback(() => {
    setReadingSkillName(null)
    setSkillContent(null)
    setReadingError('')
  }, [])

  const closePanel = useCallback(() => {
    resetReadingState()
    onClose?.()
  }, [onClose, resetReadingState])

  useEffect(() => {
    if (!active || (isProjectScope && !project)) return

    let disposed = false
    const loadSkills = async () => {
      setLoading(true)
      setError('')
      try {
        const url = isProjectScope
          ? `/api/skills?projectId=${encodeURIComponent(project!.id)}`
          : '/api/skills?scope=global'
        const response = await fetch(url)
        const payload = await readJsonResponse<SkillsPayload>(response)
        if (disposed) return
        setSkills(Array.isArray(payload.skills) ? payload.skills : [])
        setSelectedSkills(new Set(Array.isArray(payload.selectedSkills) ? payload.selectedSkills : []))
        setSearchPaths(Array.isArray(payload.searchPaths) ? payload.searchPaths : [])
      } catch (loadError) {
        if (!disposed) setError(loadError instanceof Error ? loadError.message : t('failedToLoadSkills'))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void loadSkills()
    return () => {
      disposed = true
    }
  }, [active, project, isProjectScope])

  useEffect(() => {
    if (!active || embedded) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (readingSkillName) resetReadingState()
        else if (!saving) closePanel()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [active, closePanel, embedded, saving, readingSkillName, resetReadingState])

  const filteredSkills = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return skills
    return skills.filter((skill) => {
      const haystack = [
        skill.name,
        skill.displayName,
        skill.description,
        skill.source,
        skill.compatibility,
        skill.allowedTools,
        ...(skill.tags ?? []),
        ...(skill.triggers ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(text)
    })
  }, [query, skills])

  const readSkillContent = async (skillName: string) => {
    setReadingSkillName(skillName)
    setSkillContent(null)
    setReadingError('')
    setReadingLoading(true)
    try {
      const params = new URLSearchParams({ name: skillName })
      if (isProjectScope && project) {
        params.set('scope', 'project')
        params.set('projectId', project.id)
      } else {
        params.set('scope', 'global')
      }
      const response = await fetch(`/api/skills/content?${params}`)
      const payload = await readJsonResponse<SkillContent>(response)
      setSkillContent(payload)
    } catch (err) {
      setReadingError(err instanceof Error ? err.message : t('failedToReadSkill'))
    } finally {
      setReadingLoading(false)
    }
  }

  if (!active || (isProjectScope && !project)) return null

  const toggleSkill = (skillName: string) => {
    if (saving) return
    const next = new Set(selectedSkills)
    if (next.has(skillName)) next.delete(skillName)
    else next.add(skillName)
    setSelectedSkills(next)
    void persistSkills(next)
  }

  const persistSkills = async (next: Set<string>) => {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(isProjectScope ? '/api/skills/project' : '/api/skills/global', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(isProjectScope
          ? { projectId: project!.id, selectedSkills: [...next] }
          : { selectedSkills: [...next] }),
      })
      const payload = await readJsonResponse<SavePayload>(response)
      const updatedProject = isProjectScope
        ? payload.projects?.find((item) => item.id === project!.id) ?? { ...project!, skills: payload.selectedSkills }
        : undefined
      onSaved({
        scope,
        project: updatedProject,
        projects: payload.projects,
        selectedSkills: payload.selectedSkills,
      })
    } catch (saveError) {
      setSelectedSkills(selectedSkills)
      setError(saveError instanceof Error ? saveError.message : t('failedToSaveSkills'))
    } finally {
      setSaving(false)
    }
  }

  const title = isProjectScope ? t('projectSkills') : t('globalSkills')
  const description = isProjectScope
    ? t('projectSkillsDescription', { project: project!.name })
    : t('globalSkillsDescription')

  const searchAndList = (
    <>
      <div className="quickforge-settings-divider p-3">
        <div className="quickforge-settings-inline-field">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchSkills')}
            className="quickforge-settings-input"
            disabled={loading || saving}
          />
        </div>
      </div>

      {error ? <div className="quickforge-settings-alert quickforge-settings-warning-attached">{error}</div> : null}

      <div className="quickforge-settings-toolbar">
        <span className="quickforge-settings-row-title">{t('availableSkills')}</span>
        <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('selectedSkillsCount', { count: selectedSkills.size })}</span>
      </div>

      <div className={embedded ? '' : 'max-h-[46vh] overflow-y-auto'}>
        {loading ? (
          <div className="quickforge-settings-empty-row inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="quickforge-settings-empty-row">{t('noMatchingSkills')}</div>
        ) : (
          filteredSkills.map((skill) => {
            const checked = selectedSkills.has(skill.name)
            return (
              <div key={skill.name} className={cn('quickforge-settings-list-item', checked && 'bg-muted/12')}>
                <div className="quickforge-settings-list-item-main">
                  <div className="quickforge-settings-row-title">{skill.displayName || skill.name}</div>
                  {skill.description ? (
                    <div className="quickforge-settings-row-description">{skill.description}</div>
                  ) : null}
                  <div className="quickforge-settings-meta">
                    {skill.source ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skill.source}</span> : null}
                    {skill.compatibility ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skill.compatibility}</span> : null}
                    {skill.allowedTools ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skill.allowedTools}</span> : null}
                    {skill.tags?.slice(0, 5).map((tag) => (
                      <span key={tag} className="quickforge-settings-badge quickforge-settings-badge-muted">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="quickforge-settings-list-item-actions" onClick={(event) => event.stopPropagation()}>
                  <label className="quickforge-settings-switch" aria-disabled={saving ? 'true' : 'false'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={() => toggleSkill(skill.name)}
                      aria-label={checked ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                    />
                    <span aria-hidden="true" />
                  </label>
                  <button
                    type="button"
                    className="quickforge-settings-icon-action"
                    onClick={() => void readSkillContent(skill.name)}
                    disabled={saving || readingLoading}
                    title={t('readSkill')}
                    aria-label={`${t('readSkill')}: ${skill.displayName || skill.name}`}
                  >
                    <BookOpen className="size-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )

  const skillDetail = (
    <>
      <div className="quickforge-settings-toolbar">
        <button
          type="button"
          className="quickforge-settings-button quickforge-settings-button-secondary"
          onClick={resetReadingState}
          disabled={readingLoading}
        >
          <ArrowLeft className="mr-2 size-4" />
          {t('backToSkillList')}
        </button>
        <div className="quickforge-settings-row-main min-w-0">
          <div className="quickforge-settings-row-title truncate">
            {skillContent?.displayName || skillContent?.name || readingSkillName}
          </div>
        </div>
      </div>

      <div className="p-4">
        {readingLoading ? (
          <div className="quickforge-settings-empty-row inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('loading')}
          </div>
        ) : readingError ? (
          <div className="quickforge-settings-alert quickforge-settings-warning-attached">{readingError}</div>
        ) : skillContent ? (
          <>
            {skillContent.description ? (
              <div className="quickforge-settings-row-description mb-3">{skillContent.description}</div>
            ) : null}
            <div className="quickforge-settings-meta mb-3">
              {skillContent.version ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">v{skillContent.version}</span> : null}
              {skillContent.source ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skillContent.source}</span> : null}
              {skillContent.compatibility ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skillContent.compatibility}</span> : null}
              {skillContent.allowedTools ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skillContent.allowedTools}</span> : null}
              {skillContent.license ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{skillContent.license}</span> : null}
              {skillContent.tags?.map((tag) => (
                <span key={tag} className="quickforge-settings-badge quickforge-settings-badge-muted">{tag}</span>
              ))}
            </div>
            {skillContent.triggers?.length ? (
              <div className="quickforge-settings-row-description mb-3">Triggers: {skillContent.triggers.join(', ')}</div>
            ) : null}
            {skillContent.instructions ? (
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 px-4 py-3 font-mono text-sm leading-6 text-foreground/80">
                {skillContent.instructions}
              </pre>
            ) : (
              <div className="quickforge-settings-empty-row">{t('noSkillContent')}</div>
            )}
          </>
        ) : null}
      </div>
    </>
  )

  if (embedded) {
    return (
      <div className="quickforge-settings-stack">
        <section className="quickforge-settings-section" aria-label={title}>
          {readingSkillName ? skillDetail : (
            <>
              {searchPaths.length ? (
                <div className="px-5 pt-4">
                  <span className="quickforge-settings-row-description inline-flex items-center">
                    {t('skillSearchPaths')}
                    <InfoTip label={searchPaths.join('\n')} />
                  </span>
                </div>
              ) : null}
              {searchAndList}
            </>
          )}
        </section>
      </div>
    )
  }

  return (
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) closePanel()
      }}
    >
      <div className="quickforge-dialog-panel-in flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-quickforge">
        <div className="quickforge-settings-toolbar">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {title}
              <InfoTip label={description} />
            </div>
            <div className="quickforge-settings-row-description">{description}</div>
            {searchPaths.length ? (
              <div className="quickforge-settings-row-description inline-flex items-center">
                {t('skillSearchPaths')}
                <InfoTip label={searchPaths.join('\n')} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="quickforge-settings-icon-action"
            onClick={closePanel}
            disabled={saving}
            aria-label={t('close')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {readingSkillName ? skillDetail : searchAndList}
        </div>
      </div>
    </div>
  )
}

export function SkillsDialog({ open, scope, project, onOpenChange, onSaved }: SkillsDialogProps) {
  return (
    <SkillsManagerPanel
      active={open}
      scope={scope}
      project={project}
      onClose={() => onOpenChange(false)}
      onSaved={onSaved}
    />
  )
}
