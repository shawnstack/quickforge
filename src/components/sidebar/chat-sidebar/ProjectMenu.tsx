import { createPortal } from 'react-dom'
import { FolderOpen, Puzzle, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import type { ProjectInfo } from '@/lib/types'
import { projectMenuClass } from './sidebar-classes'

/** 项目行「⋯」菜单：资源管理器打开 / 项目技能 / 删除（带二次确认态），fixed 定位由调用方计算。 */
export function ProjectMenu({
  position,
  project,
  confirmingDelete,
  canOpenInExplorer,
  onOpenInExplorer,
  onOpenProjectSkills,
  onRequestDelete,
  onConfirmDelete,
}: {
  position: { x: number; y: number }
  project: ProjectInfo
  confirmingDelete: boolean
  canOpenInExplorer: boolean
  onOpenInExplorer: (project: ProjectInfo) => void
  onOpenProjectSkills: (project: ProjectInfo) => void
  onRequestDelete: (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => void
  onConfirmDelete: (event: React.MouseEvent<HTMLButtonElement>, projectId: string) => void
}) {
  return createPortal(
    <div
      className={projectMenuClass}
      style={{ left: position.x, top: position.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {canOpenInExplorer ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          title={t('openInExplorer')}
          aria-label={t('openInExplorer')}
          onClick={() => onOpenInExplorer(project)}
        >
          <FolderOpen className="size-4 shrink-0" />
          <span>{t('openFolder')}</span>
        </button>
      ) : null}
      <button
        type="button"
        className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
        onClick={() => onOpenProjectSkills(project)}
      >
        <Puzzle className="size-4 shrink-0" />
        <span>{t('manageProjectSkills')}</span>
      </button>
      {confirmingDelete ? (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-destructive px-2 py-1.5 text-left text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          aria-label={t('confirmDelete')}
          onClick={(event) => onConfirmDelete(event, project.id)}
        >
          <span>{t('confirm')}</span>
        </button>
      ) : (
        <button
          type="button"
          className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          aria-label={t('deleteProject')}
          onClick={(event) => onRequestDelete(event, project.id)}
        >
          <Trash2 className="size-4 shrink-0" />
          <span>{t('deleteProject')}</span>
        </button>
      )}
    </div>,
    document.body,
  )
}
