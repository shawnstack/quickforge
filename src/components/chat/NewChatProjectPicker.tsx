import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Check, ChevronDown, Folder, GitBranch, Loader2, Plus, Search, X } from 'lucide-react'
import { GitBranchMenu } from '@/components/git/GitBranchMenu'
import type { GitStatusResponse } from '@/components/workspace/workspace-types'
import type { ProjectInfo } from '@/lib/types'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type NewChatBranchMenuOptions = {
  projectId: string
  dirtyCount?: number
  onCheckout: (branch: string) => Promise<void>
  onCreated?: (status: GitStatusResponse) => void
  onOpenGraph?: () => void
  onOpenChanges?: () => void
}

type NewChatProjectPickerProps = {
  projects: ProjectInfo[]
  selectedProject?: ProjectInfo
  branch?: string
  branchMenu?: NewChatBranchMenuOptions
  workspacePath?: string
  onSelectProject: (project: ProjectInfo) => void
  onClearProject: () => void
  onNewProject: () => void
  onCreateProject?: (name: string) => Promise<ProjectInfo | undefined>
  className?: string
}

const PROJECT_NAME_INVALID_CHARS = /[\\/:*?"<>|]/
const PROJECT_NAME_MAX_LENGTH = 64

function hasControlCharacter(value: string) {
  for (const char of value) {
    if (char.charCodeAt(0) < 32) return true
  }
  return false
}

export function NewChatProjectPicker({
  projects,
  selectedProject,
  branch,
  branchMenu,
  workspacePath,
  onSelectProject,
  onClearProject,
  onNewProject,
  onCreateProject,
  className,
}: NewChatProjectPickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>()
  const branchTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [branchMenuStyle, setBranchMenuStyle] = useState<CSSProperties>()
  const [view, setView] = useState<'list' | 'create'>('list')
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string>('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const shownProject = selectedProject
  const selectedProjectId = shownProject?.id
  const shownBranch = selectedProjectId ? branch?.trim() || undefined : undefined
  const branchMenuVisible = branchMenuOpen && Boolean(shownBranch) && Boolean(branchMenu)

  const filteredProjects = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return projects
    return projects.filter((project) => {
      const name = project.name.toLowerCase()
      const path = project.path.toLowerCase()
      return name.includes(keyword) || path.includes(keyword)
    })
  }, [projects, query])

  const trimmedProjectName = projectName.trim()
  const nameValidation = useMemo(() => {
    if (!trimmedProjectName) return { ok: false, error: '' }
    if (
      trimmedProjectName === '.'
      || trimmedProjectName === '..'
      || PROJECT_NAME_INVALID_CHARS.test(trimmedProjectName)
      || hasControlCharacter(trimmedProjectName)
    ) {
      return { ok: false, error: t('projectNameInvalid') }
    }
    if (trimmedProjectName.length > PROJECT_NAME_MAX_LENGTH) {
      return { ok: false, error: t('projectNameTooLong') }
    }
    const duplicate = projects.find(
      (project) => project.name.toLowerCase() === trimmedProjectName.toLowerCase(),
    )
    if (duplicate) return { ok: false, error: t('projectFolderExists'), duplicate }
    return { ok: true, error: '' }
  }, [projects, trimmedProjectName])

  const workspacePreview = useMemo(() => {
    if (!workspacePath) return trimmedProjectName
    const normalized = workspacePath.replace(/[\\/]+$/, '')
    return `${normalized}/${trimmedProjectName || '…'}`
  }, [trimmedProjectName, workspacePath])

  const updatePopoverPosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(350, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    setPopoverStyle({
      position: 'fixed',
      left,
      bottom: Math.max(12, window.innerHeight - rect.top + 10),
      width,
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    updatePopoverPosition()
    const handleUpdate = () => updatePopoverPosition()
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
    }
  }, [open, updatePopoverPosition])

  const updateBranchMenuPosition = useCallback(() => {
    const trigger = branchTriggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 24)
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    setBranchMenuStyle({
      position: 'fixed',
      left,
      top: 'auto',
      bottom: Math.max(12, window.innerHeight - rect.top + 8),
      width,
      maxHeight: Math.max(220, rect.top - 20),
      overflowY: 'auto',
    })
  }, [])

  useEffect(() => {
    if (!branchMenuOpen) return undefined
    updateBranchMenuPosition()
    const handleUpdate = () => updateBranchMenuPosition()
    window.addEventListener('resize', handleUpdate)
    window.addEventListener('scroll', handleUpdate, true)
    return () => {
      window.removeEventListener('resize', handleUpdate)
      window.removeEventListener('scroll', handleUpdate, true)
    }
  }, [branchMenuOpen, updateBranchMenuPosition])

  useEffect(() => {
    if (!branchMenuOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (branchTriggerRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.quickforge-empty-project-branch-menu')) return
      setBranchMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBranchMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [branchMenuOpen])

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelectProject = (project: ProjectInfo) => {
    setOpen(false)
    setBranchMenuOpen(false)
    onSelectProject(project)
  }

  const handleSelectDirectory = () => {
    setOpen(false)
    setBranchMenuOpen(false)
    onNewProject()
  }

  const resetCreateForm = useCallback(() => {
    setProjectName('')
    setCreateError('')
    setCreating(false)
  }, [])

  const openCreateView = useCallback(() => {
    resetCreateForm()
    setView('create')
    // Focus lands on the name input after the panel renders.
    window.setTimeout(() => nameInputRef.current?.focus(), 0)
  }, [resetCreateForm])

  const backToProjectList = useCallback(() => {
    resetCreateForm()
    setView('list')
  }, [resetCreateForm])

  const handleCreateProject = useCallback(async () => {
    if (!onCreateProject || creating || !nameValidation.ok) return
    const name = trimmedProjectName
    setCreating(true)
    setCreateError('')
    try {
      const project = await onCreateProject(name)
      if (project) {
        resetCreateForm()
        setView('list')
        setQuery('')
        setOpen(false)
        setBranchMenuOpen(false)
        onSelectProject(project)
      }
    } catch (error) {
      const code = (error as { code?: string })?.code
      const message =
        code === 'PROJECT_FOLDER_EXISTS'
          ? t('projectFolderExists')
          : code === 'INVALID_PROJECT_NAME'
            ? t('projectNameInvalid')
            : (error as Error)?.message || t('createProjectFailed')
      setCreateError(message)
    } finally {
      setCreating(false)
    }
  }, [creating, nameValidation.ok, onCreateProject, onSelectProject, resetCreateForm, trimmedProjectName])

  const handleNameKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void handleCreateProject()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (projectName.trim()) {
          setProjectName('')
          setCreateError('')
        } else {
          backToProjectList()
        }
      }
    },
    [backToProjectList, handleCreateProject, projectName],
  )

  const toggleOpen = useCallback(() => {
    setBranchMenuOpen(false)
    setOpen((value) => {
      if (!value) {
        setView('list')
        setProjectName('')
        setCreateError('')
        setCreating(false)
      }
      return !value
    })
  }, [])

  const toggleBranchMenu = useCallback(() => {
    setOpen(false)
    setBranchMenuOpen((value) => !value)
  }, [])

  const handleTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setBranchMenuOpen(false)
      setOpen((value) => !value)
    }
  }, [])

  const triggerProps = {
    ref: triggerRef,
    role: 'button',
    tabIndex: 0,
    onClick: toggleOpen,
    onKeyDown: handleTriggerKeyDown,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
  } as const

  const popover = open && popoverStyle ? (
    <div ref={popoverRef} className="quickforge-project-picker-popover" style={popoverStyle} role="menu">
      {view === 'list' ? (
        <>
          <label className="quickforge-project-picker-search">
            <Search className="size-4" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchProjects')}
              autoFocus
            />
          </label>

          <div className="quickforge-project-picker-list">
            {filteredProjects.length > 0 ? filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="quickforge-project-picker-item"
                onClick={() => handleSelectProject(project)}
                role="menuitem"
              >
                <Folder className="size-4 quickforge-project-picker-item-leading" aria-hidden="true" />
                <span className="truncate">{project.name}</span>
                {selectedProjectId === project.id ? <Check className="ml-auto size-4" aria-hidden="true" /> : null}
              </button>
            )) : (
              <div className="quickforge-project-picker-empty">{t('noMatchingProjects')}</div>
            )}
          </div>

          <div className="quickforge-project-picker-separator" />

          <button
            type="button"
            className="quickforge-project-picker-item"
            onClick={handleSelectDirectory}
            role="menuitem"
          >
            <Folder className="size-4 quickforge-project-picker-item-leading" aria-hidden="true" />
            <span className="truncate">{t('selectProjectDirectory')}</span>
          </button>

          {onCreateProject ? (
            <button
              type="button"
              className="quickforge-project-picker-item quickforge-project-picker-item-emphasis"
              onClick={openCreateView}
              role="menuitem"
            >
              <Plus className="size-4 quickforge-project-picker-item-leading" aria-hidden="true" />
              <span className="truncate">{t('newProjectInWorkspace')}</span>
              {workspacePath ? (
                <span className="quickforge-project-picker-item-hint">{t('newProjectInWorkspaceHint')}</span>
              ) : null}
            </button>
          ) : null}
        </>
      ) : (
        <div className="quickforge-project-create">
          <div className="quickforge-project-create-head">
            <button
              type="button"
              className="quickforge-project-create-back"
              onClick={backToProjectList}
              aria-label={t('back')}
              title={t('back')}
              disabled={creating}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </button>
            <div className="quickforge-project-create-heading">
              <div className="quickforge-project-create-title">{t('newProjectInWorkspace')}</div>
              <div className="quickforge-project-create-subtitle">{t('newProjectInWorkspaceDescription')}</div>
            </div>
          </div>

          <div className="quickforge-project-create-field">
            <label htmlFor="quickforge-new-project-name">{t('projectNameLabel')}</label>
            <input
              id="quickforge-new-project-name"
              ref={nameInputRef}
              className="quickforge-project-create-input"
              value={projectName}
              onChange={(event) => {
                setProjectName(event.target.value)
                if (createError) setCreateError('')
              }}
              onKeyDown={handleNameKeyDown}
              placeholder={t('projectNamePlaceholder')}
              autoComplete="off"
              spellCheck={false}
              disabled={creating}
              aria-invalid={Boolean(nameValidation.error) || Boolean(createError)}
              aria-describedby="quickforge-new-project-message"
            />
          </div>

          <div className="quickforge-project-create-path" title={workspacePreview}>
            <Folder className="size-3" aria-hidden="true" />
            <span className="truncate">{workspacePreview}</span>
          </div>

          <div
            id="quickforge-new-project-message"
            className={cn(
              'quickforge-project-create-message',
              (nameValidation.error || createError) && 'quickforge-project-create-message-error',
            )}
            role="status"
          >
            {createError || nameValidation.error || (
              trimmedProjectName ? t('createProjectReady') : t('createProjectHint')
            )}
            {nameValidation.duplicate ? (
              <>
                {' '}
                <button
                  type="button"
                  className="quickforge-project-create-link"
                  onClick={() => handleSelectProject(nameValidation.duplicate as ProjectInfo)}
                >
                  {t('useExistingProject')}
                </button>
              </>
            ) : null}
          </div>

          <div className="quickforge-project-create-actions">
            <button
              type="button"
              className="quickforge-project-create-cancel"
              onClick={backToProjectList}
              disabled={creating}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="quickforge-project-create-submit"
              onClick={() => void handleCreateProject()}
              disabled={creating || !nameValidation.ok}
            >
              {creating ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span>{t('creatingProject')}</span>
                </>
              ) : (
                <span>{t('createProjectAction')}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  ) : null

  return (
    <div ref={rootRef} className={cn('quickforge-empty-project-picker', open ? 'quickforge-empty-project-picker-open' : undefined, className)}>
      <div className="quickforge-empty-project-trigger">
        {selectedProjectId ? (
          <span className="quickforge-empty-project-chip" {...triggerProps}>
            <span className="quickforge-empty-project-chip-action">
              <Folder className="size-3.5 quickforge-empty-project-chip-folder" aria-hidden="true" />
              <button
                type="button"
                className="quickforge-empty-project-chip-clear"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  setBranchMenuOpen(false)
                  onClearProject()
                }}
                aria-label={t('useNoProject')}
                title={t('useNoProject')}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
            <span className="truncate">{shownProject?.name}</span>
          </span>
        ) : (
          <span className="quickforge-empty-project-pill" {...triggerProps}>
            <Folder className="size-4" aria-hidden="true" />
            <span className="truncate">{t('chooseProject')}</span>
          </span>
        )}
        {shownBranch && branchMenu ? (
          <button
            ref={branchTriggerRef}
            type="button"
            className="quickforge-empty-project-branch"
            title={t('gitBranchLabel', { branch: shownBranch })}
            aria-label={t('gitBranchLabel', { branch: shownBranch })}
            aria-haspopup="menu"
            aria-expanded={branchMenuVisible}
            onClick={toggleBranchMenu}
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span className="truncate">{shownBranch}</span>
            <ChevronDown className="size-3 quickforge-empty-project-branch-chevron" aria-hidden="true" />
          </button>
        ) : shownBranch ? (
          <span
            className="quickforge-empty-project-branch"
            title={t('gitBranchLabel', { branch: shownBranch })}
            aria-label={t('gitBranchLabel', { branch: shownBranch })}
          >
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span className="truncate">{shownBranch}</span>
          </span>
        ) : null}
      </div>
      {typeof document !== 'undefined' ? createPortal(popover, document.body) : null}
      {typeof document !== 'undefined' && branchMenuVisible && branchMenuStyle && shownBranch && branchMenu ? createPortal(
        <GitBranchMenu
          projectId={branchMenu.projectId}
          currentBranch={shownBranch}
          dirtyCount={branchMenu.dirtyCount}
          className="quickforge-empty-project-branch-menu origin-bottom"
          style={branchMenuStyle}
          onCheckout={async (nextBranch) => {
            await branchMenu.onCheckout(nextBranch)
            setBranchMenuOpen(false)
          }}
          onCreated={(status) => {
            setBranchMenuOpen(false)
            branchMenu.onCreated?.(status)
          }}
          onOpenGraph={branchMenu.onOpenGraph ? () => {
            setBranchMenuOpen(false)
            branchMenu.onOpenGraph?.()
          } : undefined}
          onOpenChanges={branchMenu.onOpenChanges ? () => {
            setBranchMenuOpen(false)
            branchMenu.onOpenChanges?.()
          } : undefined}
        />,
        document.body,
      ) : null}
    </div>
  )
}
