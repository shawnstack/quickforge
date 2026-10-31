import { Bot, ChevronDown, Code2, Workflow, X } from 'lucide-react'
import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { useCallback, useMemo } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Transform } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { GoalIcon } from '@/components/goal-icon'
import { FileIcon } from './file-icon'
import { panelTabFilePath } from './workspace-tab-file-path'
import { panelTabLabel, panelTabMeta, panelTabTitle } from './workspace-panel-tabs'
import type { WorkspacePanelTab } from './workspace-inspector-tabs'

function SortablePanelTab({ id, compact = false, children }: {
  id: string
  compact?: boolean
  children: (props: {
    listeners: ReturnType<typeof useSortable>['listeners']
    attributes: ReturnType<typeof useSortable>['attributes']
    isDragging: boolean
  }) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition: isDragging ? undefined : transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center',
        compact ? 'min-w-24 max-w-32 flex-1' : 'shrink-0',
        isDragging && 'relative z-30 opacity-55 drop-shadow-sm',
      )}
    >
      {children({ listeners, attributes, isDragging })}
    </div>
  )
}

type WorkspaceTabStripProps = {
  panelTabs: WorkspacePanelTab[]
  activePanelTabId?: string
  projectName?: string
  tabListOpen: boolean
  setTabListOpen: Dispatch<SetStateAction<boolean>>
  tabListRef: RefObject<HTMLDivElement | null>
  draggingPanelTabId?: string
  activatePanelTab: (tab: WorkspacePanelTab) => void
  closePanelTab: (id: string) => void
  closeOtherPanelTabs: () => void
  closeAllPanelTabs: () => void
  handlePanelTabDragStart: (event: DragStartEvent) => void
  finishPanelTabDrag: () => void
  handlePanelTabDragEnd: (event: DragEndEvent) => void
}

export function WorkspaceTabStrip({ panelTabs, activePanelTabId, projectName, tabListOpen, setTabListOpen, tabListRef, draggingPanelTabId, activatePanelTab, closePanelTab, closeOtherPanelTabs, closeAllPanelTabs, handlePanelTabDragStart, finishPanelTabDrag, handlePanelTabDragEnd }: WorkspaceTabStripProps) {
  const panelTabIds = useMemo(() => panelTabs.map((tab) => tab.id), [panelTabs])
  const panelTabSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictPanelTabToHorizontal = useCallback((args: { transform: Transform }) => ({
    ...args.transform,
    y: 0,
  }), [])

  return (
    <>
      {panelTabs.length > 0 ? (
        <div ref={tabListRef} className="relative shrink-0">
          <button
            type="button"
            className="flex size-9 items-center justify-center rounded-xl bg-transparent transition-colors hover:bg-[var(--quickforge-sidebar-hover-bg)]"
            onClick={() => setTabListOpen((value) => !value)}
            aria-label={t('rightPanelOpenTabsTitle')}
            title={t('rightPanelOpenTabsTitle')}
            aria-haspopup="menu"
            aria-expanded={tabListOpen}
          >
            <ChevronDown className={cn('size-4 transition-transform', tabListOpen && 'rotate-180')} />
          </button>
          {tabListOpen ? (
            <div className="absolute left-0 top-12 z-40 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
              <div className="max-h-[min(25rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain">
                {panelTabs.map((tab) => {
                  const item = panelTabMeta(tab)
                  const Icon = tab.kind === 'goal' ? GoalIcon : item?.icon
                  const filePath = panelTabFilePath(tab)
                  const active = tab.id === activePanelTabId
                  const label = panelTabLabel(tab, projectName)
                  const title = panelTabTitle(tab, label)
                  return (
                    <div
                      key={tab.id}
                      className={cn(
                        'group flex h-10 w-full items-center gap-2 rounded-xl px-2 transition-colors',
                        active
                          ? 'bg-[var(--quickforge-sidebar-hover-bg)] text-foreground'
                          : 'hover:bg-[var(--quickforge-sidebar-hover-bg)] hover:text-foreground',
                      )}
                      role="none"
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
                        onClick={() => {
                          activatePanelTab(tab)
                          setTabListOpen(false)
                        }}
                        role="menuitem"
                        title={title}
                      >
                        {filePath ? <FileIcon path={filePath} className="size-4 shrink-0" /> : tab.kind === 'subagent' ? <Bot className="size-4 shrink-0" /> : tab.kind === 'workflow' ? <Workflow className="size-4 shrink-0" /> : Icon ? <Icon className="size-4 shrink-0" /> : <Code2 className="size-4 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                      </button>
                      <button
                        type="button"
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full opacity-70 transition-colors hover:bg-destructive/10 group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation()
                          closePanelTab(tab.id)
                        }}
                        aria-label={t('close')}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2 border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] pt-2">
                <button
                  type="button"
                  className="flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-medium transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  onClick={closeOtherPanelTabs}
                  disabled={panelTabs.length <= 1}
                  role="menuitem"
                >
                  {t('rightPanelCloseOtherTabs')}
                </button>
                <button
                  type="button"
                  className="flex h-9 w-full items-center rounded-xl px-3 text-left text-sm font-medium transition-colors hover:bg-destructive/10"
                  onClick={closeAllPanelTabs}
                  role="menuitem"
                >
                  {t('rightPanelCloseAllTabs')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <DndContext
        sensors={panelTabSensors}
        collisionDetection={closestCenter}
        onDragStart={handlePanelTabDragStart}
        onDragEnd={handlePanelTabDragEnd}
        onDragCancel={finishPanelTabDrag}
        modifiers={[restrictPanelTabToHorizontal]}
      >
        <SortableContext items={panelTabIds} strategy={horizontalListSortingStrategy}>
          <div
            role="tablist"
            aria-label={t('workspacePanel')}
            className={cn('quickforge-inspector-tab-strip flex h-8 min-w-0 flex-1 items-center overflow-x-auto', panelTabs.length > 1 ? 'gap-0.5' : 'gap-1', draggingPanelTabId && 'cursor-grabbing')}
          >
            {panelTabs.map((tab) => {
              const item = panelTabMeta(tab)
              const Icon = tab.kind === 'goal' ? GoalIcon : item?.icon
              const filePath = panelTabFilePath(tab)
              const active = tab.id === activePanelTabId
              const label = panelTabLabel(tab, projectName)
              const title = panelTabTitle(tab, label)
              const compactTabs = panelTabs.length > 1
              return (
                <SortablePanelTab key={tab.id} id={tab.id} compact={compactTabs}>
                  {({ listeners, attributes, isDragging }) => (
                    <div
                      className={cn(
                        'group relative flex h-8 items-center gap-1.5 rounded-xl text-[13px] font-medium transition-[background-color,color,box-shadow]',
                        compactTabs ? 'w-full min-w-0' : 'max-w-40',
                        active
                          ? 'bg-[color-mix(in_oklab,var(--muted)_86%,transparent)] hover:bg-[color-mix(in_oklab,var(--muted)_86%,transparent)]'
                          : 'hover:bg-[color-mix(in_oklab,var(--muted)_72%,transparent)]',
                        draggingPanelTabId ? 'cursor-grabbing' : 'cursor-grab',
                        isDragging && 'shadow-quickforge',
                      )}
                    >
                      <button
                        type="button"
                        {...listeners}
                        {...attributes}
                        role="tab"
                        aria-selected={active}
                        className={cn(
                          'flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-xl text-left',
                          compactTabs ? 'w-full min-w-0 px-2' : 'max-w-40 px-3',
                        )}
                        onClick={() => {
                          if (!draggingPanelTabId) activatePanelTab(tab)
                        }}
                        title={title}
                      >
                        {filePath ? (
                          <FileIcon path={filePath} className={cn('size-4 shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-55 group-hover:opacity-85')} />
                        ) : tab.kind === 'subagent' ? (
                          <Bot className={cn('size-4 shrink-0', active ? '' : '')} />
                        ) : tab.kind === 'workflow' ? (
                          <Workflow className={cn('size-4 shrink-0', active ? '' : '')} />
                        ) : Icon ? (
                          <Icon className={cn('size-4 shrink-0', active ? '' : '')} />
                        ) : (
                          <Code2 className={cn('size-4 shrink-0', active ? '' : '')} />
                        )}
                        <span className={cn('quickforge-inspector-tab-label flex-1', compactTabs && 'is-faded')}>{label}</span>
                      </button>
                      <button
                        type="button"
                        className={cn(
                          'mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full opacity-0 transition-[opacity,background-color,color] hover:bg-black hover:text-white focus-visible:opacity-100 group-hover:opacity-100',
                          active && 'opacity-100',
                        )}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          closePanelTab(tab.id)
                        }}
                        aria-label={t('close')}
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  )}
                </SortablePanelTab>
              )
            })}
            {panelTabs.length === 0 ? <div className="min-w-0 flex-1" /> : null}
          </div>
        </SortableContext>
      </DndContext>
    </>
  )
}
