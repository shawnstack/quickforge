import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import fileManagerIconUrl from '@/assets/icons/file-manager.svg'
import vscodeIconUrl from '@/assets/icons/vscode.svg'

type ProjectOpenMenuProps = {
  project?: ProjectInfo | null
  disabled?: boolean
  onOpenInExplorer: (project: ProjectInfo) => void
  onOpenInVSCode: (project: ProjectInfo) => void
}

type ProjectOpenTarget = 'explorer' | 'vscode'

const PROJECT_OPEN_TARGET_STORAGE_KEY = 'quickforge:project-open-target'

function readProjectOpenTarget(): ProjectOpenTarget {
  if (typeof window === 'undefined') return 'vscode'
  return window.localStorage.getItem(PROJECT_OPEN_TARGET_STORAGE_KEY) === 'explorer' ? 'explorer' : 'vscode'
}

export function ProjectOpenMenu({ project, disabled, onOpenInExplorer, onOpenInVSCode }: ProjectOpenMenuProps) {
  const [open, setOpen] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<ProjectOpenTarget>(readProjectOpenTarget)
  const ref = useRef<HTMLDivElement | null>(null)
  const unavailable = disabled || !project?.id
  const selectedIconUrl = selectedTarget === 'explorer' ? fileManagerIconUrl : vscodeIconUrl

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
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

  const handleOpen = (target: ProjectOpenTarget, action: (project: ProjectInfo) => void) => {
    if (!project) return
    setSelectedTarget(target)
    window.localStorage.setItem(PROJECT_OPEN_TARGET_STORAGE_KEY, target)
    setOpen(false)
    action(project)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cn(
          'inline-flex h-8 overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background/90 text-foreground transition-colors hover:bg-muted/25 disabled:pointer-events-none disabled:opacity-50',
          open && 'border-[color-mix(in_oklab,var(--border)_50%,transparent)] bg-background',
        )}
        disabled={unavailable}
        onClick={() => setOpen((value) => !value)}
        aria-label={t('openWorkspace')}
        title={t('openWorkspace')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-full w-8 items-center justify-center bg-background/90">
          <img src={selectedIconUrl} alt="" className="size-4" draggable={false} />
        </span>
        <span className="flex h-full w-7 items-center justify-center border-l border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/18">
          <ChevronDown className={cn('size-3.5 text-muted-foreground/85 transition-transform', open && 'rotate-180 text-foreground/85')} />
        </span>
      </button>
      {open && project ? (
        <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-popover py-1.5 text-popover-foreground shadow-quickforge" role="menu">
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleOpen('explorer', onOpenInExplorer)}
            role="menuitem"
          >
            <img src={fileManagerIconUrl} alt="" className="size-5 shrink-0" draggable={false} />
            <span className="min-w-0 flex-1 truncate">{t('fileManager')}</span>
            {selectedTarget === 'explorer' ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
          </button>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleOpen('vscode', onOpenInVSCode)}
            role="menuitem"
          >
            <img src={vscodeIconUrl} alt="" className="size-5 shrink-0" draggable={false} />
            <span className="min-w-0 flex-1 truncate">VS Code</span>
            {selectedTarget === 'vscode' ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  )
}
