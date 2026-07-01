import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, Folder, Search, X } from 'lucide-react'
import type { ChatScope, ProjectInfo } from '@/lib/types'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type NewChatProjectPickerProps = {
  projects: ProjectInfo[]
  selectedProject?: ProjectInfo
  chatScope: ChatScope
  onSelectProject: (project: ProjectInfo) => void
  onClearProject: () => void
  onNewProject: () => void
  className?: string
}

export function NewChatProjectPicker({
  projects,
  selectedProject,
  chatScope,
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
  const selectedProjectId = chatScope === 'project' ? selectedProject?.id : undefined

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
    onSelectProject(project)
  }

  const handleSelectDirectory = () => {
    setOpen(false)
    onNewProject()
  }

  const toggleOpen = useCallback(() => {
    setOpen((value) => !value)
  }, [])

  const handleTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
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
                  onClearProject()
                }}
                aria-label={t('useNoProject')}
                title={t('useNoProject')}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
            <span className="truncate">{selectedProject?.name}</span>
          </span>
        ) : (
          <span className="quickforge-empty-project-pill" {...triggerProps}>
            <Folder className="size-4" aria-hidden="true" />
            <span className="truncate">{t('chooseProject')}</span>
          </span>
        )}
      </div>
      {typeof document !== 'undefined' ? createPortal(popover, document.body) : null}
    </div>
  )
}
