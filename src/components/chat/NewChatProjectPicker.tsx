import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Folder, GitBranch, Search, X } from 'lucide-react'
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
  onSelectProject: (project: ProjectInfo) => void
  onClearProject: () => void
  onNewProject: () => void
  className?: string
}

export function NewChatProjectPicker({
  projects,
  selectedProject,
  branch,
  branchMenu,
  onSelectProject,
  onClearProject,
  onNewProject,
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

  const toggleOpen = useCallback(() => {
    setBranchMenuOpen(false)
    setOpen((value) => !value)
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
        className="quickforge-project-picker-item quickforge-project-picker-item-emphasis"
        onClick={handleSelectDirectory}
        role="menuitem"
      >
        <Folder className="size-4 quickforge-project-picker-item-leading" aria-hidden="true" />
        <span className="truncate">{t('selectProjectDirectory')}</span>
      </button>
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
