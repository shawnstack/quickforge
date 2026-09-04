import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ProjectInfo } from '@/lib/types'
import ideaIconUrl from '@/assets/icons/idea.svg'
import fileManagerIconUrl from '@/assets/icons/file-manager.svg'
import vscodeIconUrl from '@/assets/icons/vscode.svg'

type ProjectOpenMenuProps = {
  project?: ProjectInfo | null
  disabled?: boolean
  disabledTargets?: Partial<Record<ProjectOpenTarget, boolean>>
  targetDisabledLabel?: string
  onOpenInExplorer: (project: ProjectInfo) => void
  onOpenInVSCode: (project: ProjectInfo) => void
  onOpenInIDEA: (project: ProjectInfo) => void
}

type ProjectOpenTarget = 'explorer' | 'vscode' | 'idea'

const PROJECT_OPEN_TARGET_STORAGE_KEY = 'quickforge:project-open-target'

function readProjectOpenTarget(): ProjectOpenTarget {
  if (typeof window === 'undefined') return 'vscode'
  const target = window.localStorage.getItem(PROJECT_OPEN_TARGET_STORAGE_KEY)
  return target === 'explorer' || target === 'idea' ? target : 'vscode'
}

export function ProjectOpenMenu({ project, disabled, disabledTargets, targetDisabledLabel, onOpenInExplorer, onOpenInVSCode, onOpenInIDEA }: ProjectOpenMenuProps) {
  const [open, setOpen] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<ProjectOpenTarget>(readProjectOpenTarget)
  const ref = useRef<HTMLDivElement | null>(null)
  const unavailable = disabled || !project?.id
  const selectedTargetDisabled = Boolean(disabledTargets?.[selectedTarget])
  const selectedIconUrl = selectedTarget === 'explorer' ? fileManagerIconUrl : selectedTarget === 'idea' ? ideaIconUrl : vscodeIconUrl
  const selectedOpenLabel = selectedTargetDisabled && targetDisabledLabel
    ? targetDisabledLabel
    : selectedTarget === 'explorer' ? t('openInExplorer') : selectedTarget === 'idea' ? t('openInIDEA') : t('openInVSCode')

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

  const handleSelectTarget = (target: ProjectOpenTarget) => {
    setSelectedTarget(target)
    window.localStorage.setItem(PROJECT_OPEN_TARGET_STORAGE_KEY, target)
    setOpen(false)
  }

  const handleOpenSelectedTarget = () => {
    if (!project) return
    if (selectedTarget === 'explorer') {
      onOpenInExplorer(project)
      return
    }
    if (selectedTarget === 'idea') {
      onOpenInIDEA(project)
      return
    }
    onOpenInVSCode(project)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <div
        className={cn(
          'inline-flex h-8 overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-background/90 text-foreground transition-colors',
          open && 'border-[color-mix(in_oklab,var(--border)_50%,transparent)] bg-background',
          unavailable && 'opacity-50',
        )}
      >
        <button
          type="button"
          className="flex h-full w-8 items-center justify-center bg-background/90 transition-colors hover:bg-muted/25 disabled:pointer-events-none"
          disabled={unavailable || selectedTargetDisabled}
          onClick={handleOpenSelectedTarget}
          aria-label={selectedOpenLabel}
          title={selectedOpenLabel}
        >
          <img src={selectedIconUrl} alt="" className="size-4" draggable={false} />
        </button>
        <button
          type="button"
          className="flex h-full w-7 items-center justify-center border-l border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/18 transition-colors hover:bg-muted/35 disabled:pointer-events-none"
          disabled={unavailable}
          onClick={() => setOpen((value) => !value)}
          aria-label={t('chooseWorkspaceOpenTarget')}
          title={t('chooseWorkspaceOpenTarget')}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <ChevronDown className={cn('size-3.5 text-muted-foreground/85 transition-transform', open && 'rotate-180 text-foreground/85')} />
        </button>
      </div>
      {open && project ? (
        <div className="quickforge-menu-in absolute right-0 top-10 z-50 w-52 origin-top-right overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--border)_38%,transparent)] bg-popover py-1.5 text-popover-foreground shadow-quickforge" role="menu">
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => handleSelectTarget('explorer')}
            role="menuitem"
          >
            <img src={fileManagerIconUrl} alt="" className="size-5 shrink-0" draggable={false} />
            <span className="min-w-0 flex-1 truncate">{t('fileManager')}</span>
            {selectedTarget === 'explorer' ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
          </button>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => handleSelectTarget('vscode')}
            disabled={Boolean(disabledTargets?.vscode)}
            title={disabledTargets?.vscode ? targetDisabledLabel : undefined}
            role="menuitem"
          >
            <img src={vscodeIconUrl} alt="" className="size-5 shrink-0" draggable={false} />
            <span className="min-w-0 flex-1 truncate">VS Code</span>
            {selectedTarget === 'vscode' ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
          </button>
          <button
            type="button"
            className="flex h-10 w-full items-center gap-3 px-3 text-left text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => handleSelectTarget('idea')}
            disabled={Boolean(disabledTargets?.idea)}
            title={disabledTargets?.idea ? targetDisabledLabel : undefined}
            role="menuitem"
          >
            <img src={ideaIconUrl} alt="" className="size-5 shrink-0" draggable={false} />
            <span className="min-w-0 flex-1 truncate">IntelliJ IDEA</span>
            {selectedTarget === 'idea' ? <Check className="size-4 shrink-0 text-muted-foreground" /> : null}
          </button>
        </div>
      ) : null}
    </div>
  )
}
