import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Database,
  FileText,
  FlaskConical,
  FolderTree,
  GitBranch,
  Globe2,
  Info,
  Loader2,
  Palette,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { InfoTip } from '@/components/ui/info-tip'
import { t } from '@/lib/i18n'
import type { ProjectInfo, SkillSummary, SkillsScope } from '@/lib/types'
import { cn } from '@/lib/utils'

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

type SourceGroup = 'builtin' | 'personal' | 'plugin'
type SourceFilter = 'all' | SourceGroup
type StatusFilter = 'all' | 'enabled' | 'disabled'
type DetailTab = 'overview' | 'instructions' | 'metadata'

type SelectionIntent = {
  bulk?: boolean
  message?: string
  undo?: Set<string>
}

type ToastState = {
  message: string
  undo?: Set<string>
}

const SOURCE_GROUPS: SourceGroup[] = ['builtin', 'personal', 'plugin']
const DETAIL_TABS: DetailTab[] = ['overview', 'instructions', 'metadata']
const markdownRemarkPlugins = [remarkGfm]

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

function sourceGroupFor(skill: SkillSummary): SourceGroup {
  const source = String(skill.source || '')
  if (source === 'builtin') return 'builtin'
  if (source.startsWith('plugin:')) return 'plugin'
  return 'personal'
}

function sourceGroupLabel(group: SourceGroup, scope: SkillsScope) {
  if (group === 'builtin') return t('skillsSourceBuiltin')
  if (group === 'plugin') return t('skillsSourcePlugin')
  return scope === 'project' ? t('skillsSourceProject') : t('skillsSourcePersonal')
}

function sourceGroupHint(group: SourceGroup, scope: SkillsScope) {
  if (group === 'builtin') return t('skillsSourceBuiltinHint')
  if (group === 'plugin') return t('skillsSourcePluginHint')
  return scope === 'project' ? t('skillsSourceProjectHint') : t('skillsSourcePersonalHint')
}

function sourcePathLabel(path: string, index: number, scope: SkillsScope) {
  if (path.includes('<enabled-plugin>')) return t('skillsSourcePlugin')
  if (path.includes('<project>')) return t('skillsSourceProject')
  const brand = path.includes('.quickforge')
    ? 'QuickForge'
    : path.includes('.claude')
      ? 'Claude'
      : path.includes('.opencode')
        ? 'OpenCode'
        : path.includes('.agents')
          ? 'Agents'
          : undefined
  if (!brand) return index === 0 ? t('skillsSourceBuiltin') : t('skillsPathNumber', { index: index + 1 })
  return scope === 'project' ? `${t('skillsSourceProject')} · ${brand}` : brand
}

function skillIcon(skill: SkillSummary): LucideIcon {
  const haystack = `${skill.name} ${skill.displayName ?? ''} ${(skill.tags ?? []).join(' ')}`.toLowerCase()
  if (/skill|creator|prompt/.test(haystack)) return Sparkles
  if (/release|changelog|notes?/.test(haystack)) return Tag
  if (/git|commit|branch/.test(haystack)) return GitBranch
  if (/browser|playwright|web/.test(haystack)) return Globe2
  if (/pdf|document|markdown|file/.test(haystack)) return FileText
  if (/api|server|route|endpoint/.test(haystack)) return Server
  if (/data|csv|sql|log|cleanup/.test(haystack)) return Database
  if (/design|ui|palette|style/.test(haystack)) return Palette
  if (/test|review|qa/.test(haystack)) return FlaskConical
  if (/code/.test(haystack)) return Code2
  return BookOpen
}

function SkillGlyph({ skill, className }: { skill: SkillSummary; className?: string }) {
  return createElement(skillIcon(skill), { className, 'aria-hidden': true })
}

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

export function SkillsManagerPanel({
  active = true,
  scope,
  project,
  embedded = false,
  onClose,
  onSaved,
}: SkillsManagerPanelProps) {
  const isProjectScope = scope === 'project'
  const projectId = project?.id

  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchPaths, setSearchPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [pendingNames, setPendingNames] = useState<Set<string>>(() => new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [pathsOpen, setPathsOpen] = useState(false)

  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState('')
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const detailDialogRef = useRef<HTMLDivElement>(null)
  const sourceMenuRef = useRef<HTMLDivElement>(null)
  const pathsPopoverRef = useRef<HTMLDivElement>(null)
  const loadRequestRef = useRef(0)
  const contentRequestRef = useRef(0)
  const selectedSkillsRef = useRef<Set<string>>(new Set())
  const selectedSkillNameRef = useRef<string | null>(null)
  const confirmedSkillsRef = useRef<Set<string>>(new Set())
  const pendingNamesRef = useRef<Set<string>>(new Set())
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveGenerationRef = useRef(0)
  const saveSequenceRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  const busy = pendingNames.size > 0 || bulkSaving
  const hasFilters = query.trim().length > 0 || sourceFilter !== 'all' || statusFilter !== 'all'

  const setSelection = useCallback((next: Set<string>) => {
    selectedSkillsRef.current = next
    setSelectedSkills(next)
  }, [])

  const updatePending = useCallback((add: string[], remove: string[] = []) => {
    const next = new Set(pendingNamesRef.current)
    for (const name of add) next.add(name)
    for (const name of remove) next.delete(name)
    pendingNamesRef.current = next
    setPendingNames(new Set(next))
  }, [])

  const hideToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setToast(null)
  }, [])

  const showToast = useCallback((message: string, undo?: Set<string>) => {
    hideToast()
    setToast({ message, undo })
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, undo ? 5000 : 2400)
  }, [hideToast])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
  }, [])

  const loadSkills = useCallback(async (options?: { refresh?: boolean }) => {
    if (isProjectScope && !projectId) return false
    const requestId = ++loadRequestRef.current
    if (options?.refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const url = isProjectScope
        ? `/api/skills?projectId=${encodeURIComponent(projectId!)}`
        : '/api/skills?scope=global'
      const response = await fetch(url)
      const payload = await readJsonResponse<SkillsPayload>(response)
      if (requestId !== loadRequestRef.current) return false
      const nextSkills = Array.isArray(payload.skills) ? payload.skills : []
      const nextSelected = new Set(Array.isArray(payload.selectedSkills) ? payload.selectedSkills : [])
      setSkills(nextSkills)
      setSelection(nextSelected)
      confirmedSkillsRef.current = new Set(nextSelected)
      setSearchPaths(Array.isArray(payload.searchPaths) ? payload.searchPaths : [])
      const currentSelected = selectedSkillNameRef.current
      if (currentSelected && !nextSkills.some((skill) => skill.name === currentSelected)) {
        selectedSkillNameRef.current = null
        setSelectedSkillName(null)
        setSkillContent(null)
        setContentError('')
      }
      return true
    } catch (loadError) {
      if (requestId === loadRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : t('failedToLoadSkills'))
      }
      return false
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [isProjectScope, projectId, setSelection])

  useEffect(() => {
    if (!active || (isProjectScope && !projectId)) return
    const timer = window.setTimeout(() => {
      void loadSkills()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      loadRequestRef.current += 1
    }
  }, [active, isProjectScope, loadSkills, projectId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query, sourceFilter, statusFilter])

  const closeDetail = useCallback(() => {
    contentRequestRef.current += 1
    selectedSkillNameRef.current = null
    setSelectedSkillName(null)
    setSkillContent(null)
    setContentError('')
    setContentLoading(false)
    setDetailTab('overview')
  }, [])

  const loadSkillContent = useCallback(async (skillName: string) => {
    if (isProjectScope && !projectId) return
    const requestId = ++contentRequestRef.current
    setContentLoading(true)
    setContentError('')
    try {
      const params = new URLSearchParams({ name: skillName })
      if (isProjectScope) {
        params.set('scope', 'project')
        params.set('projectId', projectId!)
      } else {
        params.set('scope', 'global')
      }
      const response = await fetch(`/api/skills/content?${params}`)
      const payload = await readJsonResponse<SkillContent>(response)
      if (requestId !== contentRequestRef.current) return
      setSkillContent(payload)
    } catch (readError) {
      if (requestId === contentRequestRef.current) {
        setContentError(readError instanceof Error ? readError.message : t('failedToReadSkill'))
      }
    } finally {
      if (requestId === contentRequestRef.current) setContentLoading(false)
    }
  }, [isProjectScope, projectId])

  const openSkill = useCallback((skill: SkillSummary) => {
    if (selectedSkillNameRef.current !== skill.name) {
      contentRequestRef.current += 1
      selectedSkillNameRef.current = skill.name
      setSelectedSkillName(skill.name)
      setDetailTab('overview')
      setSkillContent(null)
      setContentError('')
      setContentLoading(false)
      void loadSkillContent(skill.name)
    }
  }, [loadSkillContent])

  const closePanel = useCallback(() => {
    hideToast()
    setSourceMenuOpen(false)
    setPathsOpen(false)
    closeDetail()
    onClose?.()
  }, [closeDetail, hideToast, onClose])

  const removePending = useCallback((names: string[]) => {
    updatePending([], names)
  }, [updatePending])

  const queueSave = useCallback((next: Set<string>, names: string[], intent: SelectionIntent = {}) => {
    const generation = saveGenerationRef.current
    const sequence = ++saveSequenceRef.current
    hideToast()
    setError('')
    updatePending(names)
    if (intent.bulk) setBulkSaving(true)
    setSelection(new Set(next))

    const task = async () => {
      if (generation !== saveGenerationRef.current) return
      try {
        const response = await fetch(isProjectScope ? '/api/skills/project' : '/api/skills/global', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(isProjectScope
            ? { projectId, selectedSkills: [...next] }
            : { selectedSkills: [...next] }),
        })
        const payload = await readJsonResponse<SavePayload>(response)
        if (generation !== saveGenerationRef.current) return
        const serverSelection = new Set(payload.selectedSkills)
        confirmedSkillsRef.current = serverSelection
        if (sequence === saveSequenceRef.current) setSelection(new Set(serverSelection))
        const updatedProject = isProjectScope && project
          ? payload.projects?.find((item) => item.id === project.id) ?? { ...project, skills: payload.selectedSkills }
          : undefined
        onSaved({
          scope,
          project: updatedProject,
          projects: payload.projects,
          selectedSkills: payload.selectedSkills,
        })
        if (intent.message) showToast(intent.message, intent.undo)
      } catch (saveError) {
        if (generation !== saveGenerationRef.current) return
        saveGenerationRef.current += 1
        saveSequenceRef.current += 1
        pendingNamesRef.current = new Set()
        setPendingNames(new Set())
        setBulkSaving(false)
        setSelection(new Set(confirmedSkillsRef.current))
        setError(saveError instanceof Error ? saveError.message : t('failedToSaveSkills'))
      } finally {
        if (generation === saveGenerationRef.current) {
          removePending(names)
          if (intent.bulk) setBulkSaving(false)
        }
      }
    }

    saveQueueRef.current = saveQueueRef.current.then(task, task)
  }, [hideToast, isProjectScope, onSaved, project, projectId, removePending, scope, setSelection, showToast, updatePending])

  const toggleSkill = useCallback((skillName: string) => {
    if (pendingNamesRef.current.has(skillName) || bulkSaving || loading) return
    const next = new Set(selectedSkillsRef.current)
    if (next.has(skillName)) next.delete(skillName)
    else next.add(skillName)
    queueSave(next, [skillName])
  }, [bulkSaving, loading, queueSave])

  const copyText = useCallback(async (text: string, target: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTarget(target)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedTarget(null)
        copiedTimerRef.current = null
      }, 1600)
      showToast(successMessage)
    } catch {
      showToast(t('skillsCopyFailed'))
    }
  }, [showToast])

  const handleRescan = useCallback(async () => {
    const succeeded = await loadSkills({ refresh: true })
    if (!succeeded) return
    showToast(t('skillsRescanDone'))
    if (selectedSkillNameRef.current) void loadSkillContent(selectedSkillNameRef.current)
  }, [loadSkillContent, loadSkills, showToast])

  useEffect(() => {
    if (!active) return
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      if (sourceMenuOpen) {
        setSourceMenuOpen(false)
        return
      }
      if (pathsOpen) {
        setPathsOpen(false)
        return
      }
      if (selectedSkillNameRef.current) {
        closeDetail()
        return
      }
      if (!embedded && !busy) closePanel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [active, busy, closeDetail, closePanel, embedded, pathsOpen, sourceMenuOpen])

  useEffect(() => {
    if (!sourceMenuOpen && !pathsOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (sourceMenuOpen && target && !sourceMenuRef.current?.contains(target)) setSourceMenuOpen(false)
      if (pathsOpen && target && !pathsPopoverRef.current?.contains(target)) setPathsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [pathsOpen, sourceMenuOpen])

  const filteredSkills = useMemo(() => {
    const text = query.trim().toLowerCase()
    return skills.filter((skill) => {
      if (sourceFilter !== 'all' && sourceGroupFor(skill) !== sourceFilter) return false
      const enabled = selectedSkills.has(skill.name)
      if (statusFilter === 'enabled' && !enabled) return false
      if (statusFilter === 'disabled' && enabled) return false
      if (!text) return true
      const haystack = [
        skill.name,
        skill.displayName,
        skill.description,
        ...(skill.tags ?? []),
        ...(skill.triggers ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(text)
    })
  }, [query, selectedSkills, skills, sourceFilter, statusFilter])

  const groupedSkills = useMemo(() => SOURCE_GROUPS
    .map((group) => ({ group, skills: filteredSkills.filter((skill) => sourceGroupFor(skill) === group) }))
    .filter((entry) => entry.skills.length > 0), [filteredSkills])

  const sourceCounts = useMemo(() => {
    const counts: Record<SourceGroup, number> = { builtin: 0, personal: 0, plugin: 0 }
    for (const skill of skills) counts[sourceGroupFor(skill)] += 1
    return counts
  }, [skills])

  const enabledCount = useMemo(
    () => skills.reduce((total, skill) => total + (selectedSkills.has(skill.name) ? 1 : 0), 0),
    [selectedSkills, skills],
  )

  const filteredAllEnabled = filteredSkills.length > 0 && filteredSkills.every((skill) => selectedSkills.has(skill.name))
  const filteredAllDisabled = filteredSkills.length > 0 && filteredSkills.every((skill) => !selectedSkills.has(skill.name))
  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.name === selectedSkillName),
    [selectedSkillName, skills],
  )

  const clearFilters = () => {
    setQuery('')
    setSourceFilter('all')
    setStatusFilter('all')
  }

  const applyToFiltered = (enabled: boolean) => {
    if (filteredSkills.length === 0 || loading || busy) return
    const next = new Set(selectedSkillsRef.current)
    const changed: string[] = []
    for (const skill of filteredSkills) {
      if (next.has(skill.name) === enabled) continue
      changed.push(skill.name)
      if (enabled) next.add(skill.name)
      else next.delete(skill.name)
    }
    if (changed.length === 0) return
    queueSave(next, changed, {
      bulk: true,
      message: t(enabled ? 'skillsBulkEnabled' : 'skillsBulkDisabled', { count: changed.length }),
      undo: new Set(selectedSkillsRef.current),
    })
  }

  const handleUndo = () => {
    const undo = toast?.undo
    if (!undo) return
    queueSave(new Set(undo), [], { bulk: true, message: t('skillsUndone') })
  }

  useEffect(() => {
    if (!selectedSkillName) return
    detailDialogRef.current?.focus({ preventScroll: true })
  }, [selectedSkillName])

  if (!active || (isProjectScope && !project)) return null

  const title = isProjectScope ? t('projectSkills') : t('globalSkills')
  const description = isProjectScope
    ? t('projectSkillsDescription', { project: project!.name })
    : t('globalSkillsDescription')
  const selectedEnabled = selectedSkill ? selectedSkills.has(selectedSkill.name) : false
  const selectedPending = selectedSkill ? pendingNames.has(selectedSkill.name) : false
  const selectedTriggers = selectedSkill?.triggers ?? skillContent?.triggers ?? []
  const selectedTags = selectedSkill?.tags ?? skillContent?.tags ?? []
  const sourceOptions: Array<{ value: SourceFilter; label: string; count: number }> = [
    { value: 'all', label: t('skillsFilterAll'), count: skills.length },
    { value: 'builtin', label: t('skillsSourceBuiltin'), count: sourceCounts.builtin },
    { value: 'personal', label: sourceGroupLabel('personal', scope), count: sourceCounts.personal },
    { value: 'plugin', label: t('skillsSourcePlugin'), count: sourceCounts.plugin },
  ]
  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: t('skillsFilterAll') },
    { value: 'enabled', label: t('skillsStatusEnabled') },
    { value: 'disabled', label: t('skillsStatusDisabled') },
  ]
  const detailTabLabels: Record<DetailTab, string> = {
    overview: t('skillsDetailOverview'),
    instructions: t('skillsDetailInstructions'),
    metadata: t('skillsDetailMetadata'),
  }

  const pageHead = (
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
                  setPathsOpen((open) => !open)
                  setSourceMenuOpen(false)
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
                            onClick={() => void copyText(searchPath, `path:${index}`, t('skillsPathCopied'))}
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
          onClick={() => void handleRescan()}
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

  const summary = (
    <div className="quickforge-skills-summary">
      <div className="quickforge-skills-summary-label">
        {t('skillsEnabledSummary', { enabled: enabledCount, total: skills.length })}
      </div>
      <div className="quickforge-skills-summary-actions">
        {bulkSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
        <button
          type="button"
          className="quickforge-skills-text-button"
          onClick={() => applyToFiltered(true)}
          disabled={loading || busy || filteredSkills.length === 0 || filteredAllEnabled}
          title={t('skillsEnableAllHint', { count: filteredSkills.length })}
        >
          {t('skillsEnableAll')}
        </button>
        <span className="quickforge-skills-dot-separator" aria-hidden="true">·</span>
        <button
          type="button"
          className="quickforge-skills-text-button"
          onClick={() => applyToFiltered(false)}
          disabled={loading || busy || filteredSkills.length === 0 || filteredAllDisabled}
          title={t('skillsDisableAllHint', { count: filteredSkills.length })}
        >
          {t('skillsDisableAll')}
        </button>
      </div>
    </div>
  )

  const toolbar = (
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
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) setQuery('')
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
                setQuery('')
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
              setSourceMenuOpen((open) => !open)
              setPathsOpen(false)
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
                      setSourceFilter(option.value)
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
              onClick={() => setStatusFilter(option.value)}
              disabled={loading}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const emptyState = (
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
            onClick={clearFilters}
          >
            {t('skillsClearFilters')}
          </button>
        )
        : (
          <button
            type="button"
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            onClick={() => void handleRescan()}
            disabled={refreshing}
          >
            {t('skillsRescan')}
          </button>
        )}
    </div>
  )

  const list = (
    <div className="quickforge-skills-list" ref={listRef} role="list" aria-label={t('availableSkills')}>
      {loading
        ? (
          <div className="quickforge-skills-loading">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('loading')}
          </div>
        )
        : filteredSkills.length === 0
          ? emptyState
          : groupedSkills.map(({ group, skills: groupSkills }) => (
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
                      onClick={() => openSkill(skill)}
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
                            onChange={() => toggleSkill(skill.name)}
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

  const overview = selectedSkill
    ? (
      <>
        <div className="quickforge-skills-detail-section">
          <p className="quickforge-skills-lead">{selectedSkill.description || '—'}</p>
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
            <span>{sourceGroupLabel(sourceGroupFor(selectedSkill), scope)}</span>
            <code>{selectedSkill.source || '—'}</code>
          </div>
        </div>
        <p className="quickforge-skills-detail-note">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          {t('skillsPageDescription')}
        </p>
      </>
    )
    : null

  const instructions = selectedSkill
    ? (
      <>
        <div className="quickforge-skills-instruction-head">
          <span className="quickforge-skills-file-name">SKILL.md</span>
          {skillContent?.totalLines
            ? <span className="quickforge-skills-line-badge">{t('skillsInstructionLines', { count: skillContent.totalLines })}</span>
            : null}
          <button
            type="button"
            className="quickforge-settings-icon-action quickforge-skills-copy-action"
            aria-label={t('skillsCopyInstructions')}
            title={t('skillsCopyInstructions')}
            disabled={!skillContent?.instructions || contentLoading}
            onClick={() => {
              if (skillContent?.instructions) {
                void copyText(skillContent.instructions, 'instructions', t('skillsInstructionsCopied'))
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
                  onClick={() => void loadSkillContent(selectedSkill.name)}
                >
                  {t('retry')}
                </button>
              </div>
            )
            : skillContent?.instructions
              ? (
                <div className="quickforge-skills-md">
                  <ReactMarkdown
                    remarkPlugins={markdownRemarkPlugins}
                    components={skillMarkdownComponents}
                    skipHtml
                  >
                    {skillContent.instructions}
                  </ReactMarkdown>
                </div>
              )
              : <div className="quickforge-skills-inline-empty">{t('noSkillContent')}</div>}
      </>
    )
    : null

  const metadata = selectedSkill
    ? (
      <dl className="quickforge-skills-meta-list">
        <SkillMetaRow label={t('skillsMetadataName')} value={selectedSkill.name} mono />
        <SkillMetaRow label={t('skillsMetadataVersion')} value={selectedSkill.version} />
        <SkillMetaRow label={t('skillsMetadataLicense')} value={selectedSkill.license} />
        <SkillMetaRow label={t('skillsMetadataCompatibility')} value={selectedSkill.compatibility} />
        <SkillMetaRow label={t('skillsMetadataAllowedTools')} value={selectedSkill.allowedTools} mono />
        <SkillMetaRow label={t('skillsMetadataEntry')} value={selectedSkill.entry} mono />
        <SkillMetaRow label={t('skillsMetadataSourceId')} value={selectedSkill.source} mono />
        <SkillMetaRow label={t('skillsTags')} value={selectedTags.length ? selectedTags.join(', ') : null} />
        <SkillMetaRow label={t('skillsTriggers')} value={selectedTriggers.length ? selectedTriggers.join(', ') : null} />
        {skillContent ? <SkillMetaRow label={t('skillsMetadataLines')} value={skillContent.totalLines} /> : null}
      </dl>
    )
    : null

  const detailDialog = selectedSkill && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDetail()
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
            <span className="quickforge-skills-tile quickforge-skills-tile-lg" data-group={sourceGroupFor(selectedSkill)} aria-hidden="true">
              <SkillGlyph skill={selectedSkill} className="size-5" />
            </span>
            <div className="quickforge-skills-detail-id">
              <div className="quickforge-skills-detail-name" id="quickforge-skill-detail-title">
                {selectedSkill.displayName || selectedSkill.name}
              </div>
              <div className="quickforge-skills-detail-slug">{selectedSkill.name}</div>
            </div>
            <button
              type="button"
              className="quickforge-settings-icon-action"
              onClick={closeDetail}
              aria-label={t('skillsCloseDetail')}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="quickforge-skills-detail-switch-row">
            <span className="quickforge-skills-switch-wrap">
              <label className="quickforge-settings-switch" aria-disabled={selectedPending || bulkSaving ? 'true' : 'false'}>
                <input
                  type="checkbox"
                  checked={selectedEnabled}
                  disabled={selectedPending || bulkSaving || loading}
                  onChange={() => toggleSkill(selectedSkill.name)}
                  aria-label={selectedEnabled
                    ? t('skillsDisableNamedSkill', { name: selectedSkill.displayName || selectedSkill.name })
                    : t('skillsEnableNamedSkill', { name: selectedSkill.displayName || selectedSkill.name })}
                />
                <span aria-hidden="true" />
              </label>
              {selectedPending ? <Loader2 className="quickforge-skills-switch-spinner" aria-hidden="true" /> : null}
            </span>
            <span className="quickforge-skills-switch-text">{t('skillsEnabledForChats')}</span>
            <span className="quickforge-skills-switch-hint">
              {selectedEnabled ? t('enabled') : t('disabled')}
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
    : null

  const card = (
    <section className="quickforge-skills-card" aria-label={title}>
      {toolbar}
      {list}
    </section>
  )

  const toastView = toast
    ? (
      <div className="quickforge-skills-toast" role="status" aria-live="polite">
        <span>{toast.message}</span>
        {toast.undo
          ? (
            <button type="button" className="quickforge-skills-toast-action" onClick={handleUndo}>
              {t('skillsUndo')}
            </button>
          )
          : null}
      </div>
    )
    : null

  const page = (
    <>
      <div className="quickforge-skills-page">
        {pageHead}
        {error
          ? (
            <div className="quickforge-settings-alert quickforge-skills-alert" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="quickforge-skills-text-button"
                onClick={() => void loadSkills()}
                disabled={loading || refreshing}
              >
                {t('retry')}
              </button>
            </div>
          )
          : null}
        {summary}
        {card}
        {toastView}
      </div>
      {detailDialog}
    </>
  )

  if (embedded) return page

  return (
    <div
      className="quickforge-dialog-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) closePanel()
      }}
    >
      <div className="quickforge-dialog-panel-in flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-quickforge">
        <div className="quickforge-skills-dialog-head">
          <div className="quickforge-skills-dialog-title">
            <BookOpen className="size-4 shrink-0" aria-hidden="true" />
            <span>{title}</span>
            <InfoTip label={description} />
          </div>
          <button
            type="button"
            className="quickforge-settings-icon-action"
            onClick={closePanel}
            disabled={busy}
            aria-label={t('close')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="quickforge-skills-dialog-body">
          {page}
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
