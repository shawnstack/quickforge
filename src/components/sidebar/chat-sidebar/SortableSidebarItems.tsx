import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { SidebarSectionId } from '@/lib/sidebar-section-order'
import { sidebarSectionDndId } from './sidebar-utils'

export function SortableProjectItem({ id, children }: { id: string; children: (props: { listeners: ReturnType<typeof useSortable>['listeners']; attributes: ReturnType<typeof useSortable>['attributes'] }) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-50 opacity-40')}>
      {children({ listeners, attributes })}
    </div>
  )
}

export function SortableSidebarSection({ id, children }: { id: SidebarSectionId; children: (props: {
  listeners: ReturnType<typeof useSortable>['listeners']
  attributes: ReturnType<typeof useSortable>['attributes']
  setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
  isDragging: boolean
}) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sidebarSectionDndId(id),
  })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform ? { ...transform, x: 0 } : null),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex flex-col',
        isDragging && 'relative z-30 opacity-55',
      )}
    >
      {children({ listeners, attributes, setActivatorNodeRef, isDragging })}
    </div>
  )
}
