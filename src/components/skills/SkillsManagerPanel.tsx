import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { InfoTip } from '@/components/ui/info-tip'
import { useSkillsManager, type SkillsSavedPayload } from '@/hooks/use-skills-manager'
import { t } from '@/lib/i18n'
import type { ProjectInfo, SkillsScope } from '@/lib/types'
import { SkillDetailDialog } from './SkillDetailDialog'
import { SkillsList } from './SkillsList'
import { SkillsPageHead } from './SkillsPageHead'
import { SkillsSummary } from './SkillsSummary'
import { SkillsToolbar, type StatusFilter } from './SkillsToolbar'
import { SOURCE_GROUPS, sourceGroupFor, sourceGroupLabel, type SourceFilter } from './skill-source'

export type SkillsManagerPanelProps = {
  active?: boolean
  scope: SkillsScope
  project?: ProjectInfo
  embedded?: boolean
  onClose?: () => void
  onSaved: (payload: SkillsSavedPayload) => void
}

/**
 * Skills 管理面板：列表筛选、分组展示、单技能开关、批量启用/停用与详情阅读。
 * 数据层（加载、乐观保存与回滚）在 `useSkillsManager`，子区块见同目录组件。
 */
export function SkillsManagerPanel({
  active = true,
  scope,
  project,
  embedded = false,
  onClose,
  onSaved,
}: SkillsManagerPanelProps) {
  const isProjectScope = scope === 'project'

  const manager = useSkillsManager({ active, scope, project, onSaved })
  const {
    skills,
    selectedSkills,
    searchPaths,
    loading,
    refreshing,
    error,
    pendingNames,
    bulkSaving,
    busy,
    toast,
    selectedSkillName,
    skillContent,
    contentLoading,
    contentError,
    reload,
    rescan,
    toggleSkill,
    queueSelection,
    openSkill,
    closeDetail,
    hideToast,
    showToast,
  } = manager

  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const [pathsOpen, setPathsOpen] = useState(false)
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const sourceMenuRef = useRef<HTMLDivElement>(null)
  const pathsPopoverRef = useRef<HTMLDivElement>(null)
  const copiedTimerRef = useRef<number | null>(null)

  const hasFilters = query.trim().length > 0 || sourceFilter !== 'all' || statusFilter !== 'all'

  useEffect(() => () => {
    if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
  }, [])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [query, sourceFilter, statusFilter])

  const closePanel = useCallback(() => {
    hideToast()
    setSourceMenuOpen(false)
    setPathsOpen(false)
    closeDetail()
    onClose?.()
  }, [closeDetail, hideToast, onClose])

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
      if (selectedSkillName) {
        closeDetail()
        return
      }
      if (!embedded && !busy) closePanel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [active, busy, closeDetail, closePanel, embedded, pathsOpen, selectedSkillName, sourceMenuOpen])

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
    const counts = { builtin: 0, personal: 0, plugin: 0 }
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

  if (!active || (isProjectScope && !project)) return null

  const title = isProjectScope ? t('projectSkills') : t('globalSkills')
  const description = isProjectScope
    ? t('projectSkillsDescription', { project: project!.name })
    : t('globalSkillsDescription')
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

  const clearFilters = () => {
    setQuery('')
    setSourceFilter('all')
    setStatusFilter('all')
  }

  const applyToFiltered = (enabled: boolean) => {
    if (filteredSkills.length === 0 || loading || busy) return
    const next = new Set(selectedSkills)
    const changed: string[] = []
    for (const skill of filteredSkills) {
      if (next.has(skill.name) === enabled) continue
      changed.push(skill.name)
      if (enabled) next.add(skill.name)
      else next.delete(skill.name)
    }
    if (changed.length === 0) return
    queueSelection(next, changed, {
      bulk: true,
      message: t(enabled ? 'skillsBulkEnabled' : 'skillsBulkDisabled', { count: changed.length }),
      undo: new Set(selectedSkills),
    })
  }

  const handleUndo = () => {
    const undo = toast?.undo
    if (!undo) return
    queueSelection(new Set(undo), [], { bulk: true, message: t('skillsUndone') })
  }

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
        <SkillsPageHead
          scope={scope}
          searchPaths={searchPaths}
          pathsOpen={pathsOpen}
          setPathsOpen={setPathsOpen}
          closeSourceMenu={() => setSourceMenuOpen(false)}
          pathsPopoverRef={pathsPopoverRef}
          copiedTarget={copiedTarget}
          onCopyText={copyText}
          onRescan={() => void rescan()}
          busy={busy}
          loading={loading}
          refreshing={refreshing}
        />
        {error
          ? (
            <div className="quickforge-settings-alert quickforge-skills-alert" role="alert">
              <span>{error}</span>
              <button
                type="button"
                className="quickforge-skills-text-button"
                onClick={() => void reload()}
                disabled={loading || refreshing}
              >
                {t('retry')}
              </button>
            </div>
          )
          : null}
        <SkillsSummary
          enabledCount={enabledCount}
          total={skills.length}
          bulkSaving={bulkSaving}
          disabled={loading || busy || filteredSkills.length === 0 || filteredAllEnabled}
          disableAllDisabled={loading || busy || filteredSkills.length === 0 || filteredAllDisabled}
          filteredCount={filteredSkills.length}
          onEnableAll={() => applyToFiltered(true)}
          onDisableAll={() => applyToFiltered(false)}
        />
        <section className="quickforge-skills-card" aria-label={title}>
          <SkillsToolbar
            searchInputRef={searchInputRef}
            query={query}
            onQueryChange={setQuery}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sourceMenuOpen={sourceMenuOpen}
            setSourceMenuOpen={setSourceMenuOpen}
            closePathsMenu={() => setPathsOpen(false)}
            sourceMenuRef={sourceMenuRef}
            sourceOptions={sourceOptions}
            statusOptions={statusOptions}
            loading={loading}
          />
          <SkillsList
            listRef={listRef}
            loading={loading}
            hasFilters={hasFilters}
            filteredCount={filteredSkills.length}
            groupedSkills={groupedSkills}
            selectedSkills={selectedSkills}
            pendingNames={pendingNames}
            selectedSkillName={selectedSkillName}
            bulkSaving={bulkSaving}
            scope={scope}
            onOpenSkill={openSkill}
            onToggleSkill={toggleSkill}
            onClearFilters={clearFilters}
            onRescan={() => void rescan()}
            refreshing={refreshing}
          />
        </section>
        {toastView}
      </div>
      {selectedSkill
        ? (
          <SkillDetailDialog
            skill={selectedSkill}
            scope={scope}
            content={skillContent}
            contentLoading={contentLoading}
            contentError={contentError}
            enabled={selectedSkills.has(selectedSkill.name)}
            pending={pendingNames.has(selectedSkill.name)}
            bulkSaving={bulkSaving}
            listLoading={loading}
            copiedTarget={copiedTarget}
            onToggle={toggleSkill}
            onReloadContent={(name) => void manager.reloadSkillContent(name)}
            onCopyText={copyText}
            onClose={closeDetail}
          />
        )
        : null}
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

export type SkillsDialogProps = {
  open: boolean
  scope: SkillsScope
  project?: ProjectInfo
  onOpenChange: (open: boolean) => void
  onSaved: (payload: SkillsSavedPayload) => void
}

/** 项目菜单打开的技能对话框（全局 Skills 走设置页内嵌面板）。 */
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
