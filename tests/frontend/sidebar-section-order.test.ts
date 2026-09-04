import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SIDEBAR_SECTION_ORDER_STORAGE_KEY,
  loadSidebarSectionOrder,
  normalizeSidebarSectionOrder,
  reorderSidebarSections,
  saveSidebarSectionOrder,
} from '../../src/lib/sidebar-section-order'

function createLocalStorageMock(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, String(value))
    },
  }
}

describe('sidebar section order', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock())
  })

  it('normalizes malformed, duplicate, partial, and foreign entries', () => {
    expect(normalizeSidebarSectionOrder(undefined)).toEqual(['projects', 'tasks'])
    expect(normalizeSidebarSectionOrder(['tasks'])).toEqual(['tasks', 'projects'])
    expect(normalizeSidebarSectionOrder(['tasks', 'foreign', 'tasks'])).toEqual(['tasks', 'projects'])
    expect(normalizeSidebarSectionOrder('tasks')).toEqual(['projects', 'tasks'])
  })

  it('loads a valid persisted order and falls back for invalid JSON', () => {
    globalThis.localStorage.setItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY, JSON.stringify(['tasks', 'projects']))
    expect(loadSidebarSectionOrder()).toEqual(['tasks', 'projects'])

    globalThis.localStorage.setItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY, '{invalid')
    expect(loadSidebarSectionOrder()).toEqual(['projects', 'tasks'])
  })

  it('saves only the normalized order', () => {
    saveSidebarSectionOrder(['tasks', 'unknown', 'tasks'])

    expect(globalThis.localStorage.getItem(SIDEBAR_SECTION_ORDER_STORAGE_KEY)).toBe('["tasks","projects"]')
  })

  it('reorders only known top-level sections', () => {
    expect(reorderSidebarSections(['projects', 'tasks'], 'projects', 'tasks')).toEqual(['tasks', 'projects'])
    expect(reorderSidebarSections(['tasks', 'projects'], 'tasks', 'projects')).toEqual(['projects', 'tasks'])
    expect(reorderSidebarSections(['tasks'], 'project-entry-id', 'projects')).toEqual(['tasks', 'projects'])
    expect(reorderSidebarSections(['tasks'], 'tasks', 'project-entry-id')).toEqual(['tasks', 'projects'])
  })

  it('does not throw when storage access fails', () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } satisfies Storage

    expect(loadSidebarSectionOrder(blockedStorage)).toEqual(['projects', 'tasks'])
    expect(() => saveSidebarSectionOrder(['tasks', 'projects'], blockedStorage)).not.toThrow()
  })
})

describe('ChatSidebar section reorder wiring', () => {
  const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

  it('renders the complete Projects and Tasks sections from the persisted order', () => {
    expect(sidebarSource).toContain('sectionOrder.map((sectionId) => (')
    expect(sidebarSource).toContain("sectionId === 'projects' ? (")
    expect(sidebarSource).toContain("{t('projects')}")
    expect(sidebarSource).toContain("{t('conversations')}")
    expect(sidebarSource.indexOf('sectionOrder.map((sectionId) => (')).toBeLessThan(sidebarSource.indexOf("{t('projects')}"))
    expect(sidebarSource.indexOf('sectionOrder.map((sectionId) => (')).toBeLessThan(sidebarSource.indexOf("{t('conversations')}"))
  })

  it('keeps pinned sessions outside the sortable section context', () => {
    expect(sidebarSource.indexOf("{t('pinnedConversations')}")).toBeLessThan(sidebarSource.indexOf('sensors={sectionSensors}'))
    expect(sidebarSource.indexOf('sensors={sectionSensors}')).toBeLessThan(sidebarSource.indexOf('sectionOrder.map((sectionId) => ('))
  })

  it('uses one middle scroll container while sections and child lists grow naturally', () => {
    const sortableSectionStart = sidebarSource.indexOf('function SortableSidebarSection')
    const sortableSectionSource = sidebarSource.slice(sortableSectionStart, sidebarSource.indexOf('export const ChatSidebar', sortableSectionStart))

    expect(sortableSectionSource).not.toContain('collapsed: boolean')
    expect(sortableSectionSource).toContain("'flex flex-col'")
    expect(sortableSectionSource).not.toContain('max-h-[55%]')
    expect(sidebarSource).toContain('ref={sidebarScrollViewportRef} className="min-h-0 flex-1 overflow-y-auto"')
    expect(sidebarSource).toContain('ref={projectsDragBoundaryRef}')
    expect(sidebarSource).not.toContain('max-h-[10.5rem]')
    expect(sidebarSource).not.toContain('className="h-full overflow-y-auto pb-2"')
    expect(sidebarSource).toContain('className="mt-auto shrink-0 border-t')
  })

  it('supports pointer and keyboard sorting in the outer section context', () => {
    const sectionSensorsSource = sidebarSource.match(/const sectionSensors = useSensors\(([\s\S]*?)\n {2}\)/)?.[1]

    expect(sectionSensorsSource).toContain('useSensor(PointerSensor, { activationConstraint: { distance: 6 } })')
    expect(sectionSensorsSource).toContain('useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })')
    expect(sidebarSource).toContain('sensors={sectionSensors}')
  })

  it('uses namespaced ids and binds the sortable activator only to each title toggle', () => {
    expect(sidebarSource).toContain("const sidebarSectionDndIdPrefix = 'sidebar-section:'")
    expect(sidebarSource).toContain('id: sidebarSectionDndId(id)')
    expect(sidebarSource).toContain('items={sectionOrder.map(sidebarSectionDndId)}')
    expect(sidebarSource).not.toContain('GripVertical')
    expect(sidebarSource).not.toContain('sectionDragHandleClass')

    const sectionToggleClass = sidebarSource.match(/const sectionToggleClass = '([^']+)'/)?.[1]
    const draggableSectionTitleClass = sidebarSource.match(/const draggableSectionTitleClass = `([^`]+)`/)?.[1]
    const pinnedHeaderSource = sidebarSource.match(/(<button type="button" className=\{sectionToggleClass\}[\s\S]*?onClick=\{onTogglePinnedCollapsed\}[\s\S]*?<\/button>)/)?.[1]

    expect(sectionToggleClass).not.toContain('cursor-grab')
    expect(sectionToggleClass).not.toContain('touch-none')
    expect(sectionToggleClass).not.toContain('active:cursor-grabbing')
    expect(draggableSectionTitleClass).toContain('${sectionToggleClass} cursor-grab touch-none active:cursor-grabbing')
    expect(pinnedHeaderSource).toContain('className={sectionToggleClass}')
    expect(pinnedHeaderSource).not.toContain('draggableSectionTitleClass')
    expect(pinnedHeaderSource).not.toContain('setActivatorNodeRef')
    expect(pinnedHeaderSource).not.toContain('{...listeners}')

    const projectHeaderSource = sidebarSource.match(/<div className=\{sectionHeaderClass\}>\s*(<button[\s\S]*?onClick=\{toggleProjectsCollapsed\}[\s\S]*?<\/button>)[\s\S]*?onClick=\{openViewSortMenu\}/)?.[1]
    const tasksHeaderSource = sidebarSource.match(/<div className=\{sectionHeaderClass\}>\s*(<button[\s\S]*?onClick=\{toggleConversationsCollapsed\}[\s\S]*?<\/button>)[\s\S]*?onClick=\{onStartNewGlobalChat\}/)?.[1]

    for (const toggleSource of [projectHeaderSource, tasksHeaderSource]) {
      expect(toggleSource).toContain('ref={setActivatorNodeRef}')
      expect(toggleSource).toContain('className={cn(draggableSectionTitleClass, isDragging && \'cursor-grabbing\')}')
      expect(toggleSource).toContain('{...attributes}')
      expect(toggleSource).toContain('{...listeners}')
    }

    const projectActionsSource = sidebarSource.slice(
      sidebarSource.indexOf('onClick={openViewSortMenu}'),
      sidebarSource.indexOf('</div>', sidebarSource.indexOf('onClick={onSelectProjectDirectory}')),
    )
    const tasksActionSource = sidebarSource.slice(
      sidebarSource.indexOf('onClick={onStartNewGlobalChat}'),
      sidebarSource.indexOf('</div>', sidebarSource.indexOf('onClick={onStartNewGlobalChat}')),
    )
    expect(projectActionsSource).not.toContain('{...listeners}')
    expect(projectActionsSource).not.toContain('setActivatorNodeRef')
    expect(tasksActionSource).not.toContain('{...listeners}')
    expect(tasksActionSource).not.toContain('setActivatorNodeRef')
  })

  it('resets local display counts when shared props change across desktop/mobile instances', () => {
    const viewModeResetEffect = sidebarSource.match(/useEffect\(\(\) => \{\s*const previousSessionViewMode[\s\S]*?\}, \[sessionViewMode\]\)/)?.[0] ?? ''
    const projectsResetEffect = sidebarSource.match(/useEffect\(\(\) => \{\s*const resetForSharedCollapse = projectsCollapsed[\s\S]*?\}, \[projectsCollapsed\]\)/)?.[0] ?? ''
    const tasksResetEffect = sidebarSource.match(/useEffect\(\(\) => \{\s*const resetForSharedCollapse = conversationsCollapsed[\s\S]*?\}, \[conversationsCollapsed\]\)/)?.[0] ?? ''
    const projectExpansionResetEffect = sidebarSource.match(/useEffect\(\(\) => \{\s*const previousExpandedProjectIds[\s\S]*?\}, \[expandedProjectIds\]\)/)?.[0] ?? ''

    expect(viewModeResetEffect).toContain('previousSessionViewModeRef.current = sessionViewMode')
    expect(viewModeResetEffect).toContain('if (previousSessionViewMode === sessionViewMode) return')
    expect(viewModeResetEffect).toContain("invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')")
    expect(viewModeResetEffect).toContain('setTimelineVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)')
    expect(projectsResetEffect).toContain("invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')")
    expect(projectsResetEffect).toContain("invalidateSidebarSessionShowMoreByPrefix(showMoreStateRef.current, 'project:')")
    expect(projectsResetEffect).toContain('setTimelineVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)')
    expect(projectsResetEffect).toContain('setProjectVisibleCounts({})')
    expect(tasksResetEffect).toContain("invalidateSidebarSessionShowMore(showMoreStateRef.current, 'global')")
    expect(tasksResetEffect).toContain('setGlobalVisibleCount(SIDEBAR_SESSION_DISPLAY_STEP)')
    expect(projectExpansionResetEffect).toContain('invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)')
    expect(projectExpansionResetEffect).toContain('expandedProjectIds.has(projectId)')
    expect(appSource.match(/sessionViewMode=\{sidebarSessionViewMode\}/g)).toHaveLength(2)
    expect(appSource.match(/projectsCollapsed=\{ui\.projectsCollapsed\}/g)).toHaveLength(2)
    expect(appSource.match(/conversationsCollapsed=\{ui\.conversationsCollapsed\}/g)).toHaveLength(2)
    expect(appSource.match(/expandedProjectIds=\{expandedProjectIds\}/g)).toHaveLength(2)
  })

  it('keeps show-more aligned with regular session rows, muted, and removes the visible collapse control', () => {
    const controlsSource = sidebarSource.slice(
      sidebarSource.indexOf('const sidebarSessionRowBaseClass'),
      sidebarSource.indexOf('function SessionTitleMarquee'),
    )

    expect(controlsSource).toContain("const sidebarSessionRowBaseClass = 'group relative flex items-center gap-2 overflow-hidden rounded-lg py-1.5 text-left")
    expect(controlsSource).toContain("const sidebarSessionTitleClass = 'quickforge-sidebar-label-in truncate text-sm font-[350] leading-5'")
    expect(controlsSource).toContain("'w-full px-2 text-muted-foreground/50")
    expect(controlsSource).toContain("hover:text-muted-foreground/80")
    expect(controlsSource).not.toContain('text-xs')
    expect(controlsSource).not.toContain('onCollapse')
    expect(controlsSource).not.toContain('sidebarCollapseList')
    expect(i18nSource).not.toContain('sidebarCollapseList')
    expect(i18nSource).not.toContain("sidebarShowMore: 'Show less'")
    expect(sidebarSource).toContain('const rowClass = `${sidebarSessionRowBaseClass}')
    expect(sidebarSource).toContain('const sessionTitleClass = sidebarSessionTitleClass')
  })

  it('invalidates pending show-more requests before direct collapse and view-reset actions', () => {
    const collapseTimelineSource = sidebarSource.match(/const collapseTimelineSessions[\s\S]*?\}, \[\]\)/)?.[0] ?? ''
    const collapseProjectSource = sidebarSource.match(/const collapseProjectSessions[\s\S]*?\}, \[\]\)/)?.[0] ?? ''
    const toggleAllSource = sidebarSource.match(/const toggleAllProjectsExpanded[\s\S]*?\}, \[expandedProjectIds, onToggleAllProjectsExpanded, projects\.length\]\)/)?.[0] ?? ''
    const selectViewSource = sidebarSource.match(/const selectViewMode[\s\S]*?closeViewSortMenu\(\)\s*\}/)?.[0] ?? ''

    expect(collapseTimelineSource).toContain("invalidateSidebarSessionShowMore(showMoreStateRef.current, 'timeline')")
    expect(collapseProjectSource).toContain('invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)')
    expect(toggleAllSource).toContain('for (const projectId of expandedProjectIds)')
    expect(toggleAllSource).toContain('invalidateSidebarSessionShowMore(showMoreStateRef.current, `project:${projectId}`)')
    expect(selectViewSource).toContain('if (mode !== sessionViewMode) collapseTimelineSessions()')
    expect(sidebarSource).not.toContain('onCollapse={')
  })

  it('temporarily collapses both sections during either section drag without mutating persisted collapse state', () => {
    expect(sidebarSource).toContain('const isSectionDragging = draggingSectionId !== undefined')
    expect(sidebarSource).toContain('const projectsVisuallyCollapsed = projectsCollapsed || isSectionDragging')
    expect(sidebarSource).toContain('const conversationsVisuallyCollapsed = conversationsCollapsed || isSectionDragging')
    const sectionDragStart = sidebarSource.match(/const handleSectionDragStart[\s\S]*?\n {2}}, \[\]\)/)?.[0] ?? ''
    expect(sectionDragStart).not.toContain('onToggleProjectsCollapsed()')
    expect(sectionDragStart).not.toContain('onToggleConversationsCollapsed()')
    expect(sidebarSource).toContain('aria-expanded={!projectsVisuallyCollapsed}')
    expect(sidebarSource).toContain("!projectsVisuallyCollapsed && 'rotate-90'")
    expect(sidebarSource).toContain('projectsVisuallyCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass')
    expect(sidebarSource).toContain('aria-expanded={!conversationsVisuallyCollapsed}')
    expect(sidebarSource).toContain("!conversationsVisuallyCollapsed && 'rotate-90'")
    expect(sidebarSource).toContain('conversationsVisuallyCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass')
    expect(sidebarSource.match(/isSectionDragging && 'transition-none'/g)).toHaveLength(1)
  })

  it('closes the Tasks content panel without a transition while preserving its expand animation', () => {
    const collapsePanelClass = sidebarSource.match(/const collapsePanelClass = '([^']+)'/)?.[1]
    const tasksPanelClassLine = sidebarSource
      .split('\n')
      .find((line) => line.includes('conversationsVisuallyCollapsed ? collapsePanelClosedClass : collapsePanelOpenClass'))

    expect(collapsePanelClass).toContain('transition-[grid-template-rows,opacity] duration-200')
    expect(tasksPanelClassLine).toContain("conversationsVisuallyCollapsed && 'transition-none'")
    expect(tasksPanelClassLine).not.toContain("isSectionDragging && 'transition-none'")
  })

  it('completes start, cancel, and end state while locking horizontal section movement', () => {
    expect(sidebarSource).toContain('onDragStart={handleSectionDragStart}')
    expect(sidebarSource).toContain('onDragCancel={finishSectionDrag}')
    expect(sidebarSource).toContain('onDragEnd={handleSectionDragEnd}')
    expect(sidebarSource).toContain('const activeSectionId = sidebarSectionIdFromDndId(event.active.id)')
    expect(sidebarSource).toContain('if (activeSectionId) setDraggingSectionId(activeSectionId)')
    expect(sidebarSource).toContain('setDraggingSectionId(undefined)')
    expect(sidebarSource).toContain('transform ? { ...transform, x: 0 } : null')
  })

  it('does not restore a desktop collapsed width on viewport resize and clears stale inline width', () => {
    const resizeEffect = sidebarSource.match(/useEffect\(\(\) => \{\s*if \(isMobile \|\| !sidebarOpen\)[\s\S]*?\}, \[finishResizing, isMobile, sidebarWidth, sidebarOpen\]\)/)?.[0] ?? ''
    const finishResizeSource = sidebarSource.match(/const finishResizing = useCallback\(\(finalWidth\?: number\) => \{[\s\S]*?\n\s{2}\}, \[restoreResizeBodyStyle\]\)/)?.[0] ?? ''

    expect(resizeEffect).toContain('if (isMobile || !sidebarOpen) return')
    expect(resizeEffect).toContain('window.addEventListener(\'resize\', syncWidthToViewport)')
    expect(finishResizeSource).toContain("asideRef.current?.style.removeProperty('width')")
  })

  it('clamps the section drag preview to the visible sections boundary so it cannot drag unbounded', () => {
    expect(sidebarSource).toContain('const sectionsDragBoundaryRef = useRef<HTMLDivElement | null>(null)')
    expect(sidebarSource).toContain('ref={sectionsDragBoundaryRef}')
    expect(sidebarSource).toContain('sectionDragStartScrollTopRef.current = sidebarScrollViewportRef.current?.scrollTop ?? 0')
    expect(sidebarSource).toContain('const restrictSectionDragToViewport = useCallback<Modifier>')
    expect(sidebarSource).toContain('(scrollViewport?.scrollTop ?? 0) - sectionDragStartScrollTopRef.current')
    expect(sidebarSource).toContain('modifiers={[restrictSectionDragToViewport]}')

    const sectionContextStart = sidebarSource.indexOf('sensors={sectionSensors}')
    const sectionContextSource = sidebarSource.slice(sectionContextStart, sidebarSource.indexOf('</DndContext>', sectionContextStart))
    expect(sectionContextSource).toContain('modifiers={[restrictSectionDragToViewport]}')
    expect(sectionContextSource).toContain('autoScroll={false}')
  })

  it('retains the nested project DnD context and project persistence callback', () => {
    const sectionContextIndex = sidebarSource.indexOf('sensors={sectionSensors}')
    const projectContextIndex = sidebarSource.indexOf('sensors={sensors}', sectionContextIndex)
    expect(sectionContextIndex).toBeGreaterThan(-1)
    expect(projectContextIndex).toBeGreaterThan(sectionContextIndex)
    expect(sidebarSource).toContain('<SortableContext items={projectIds} strategy={verticalListSortingStrategy}>')
    expect(sidebarSource).toContain('onReorderProjects(reordered)')
    expect(sidebarSource).toContain('autoScroll={{ canScroll: canAutoScrollProjectsViewport }}')
  })

  it('shares one App state and localStorage persistence across desktop and mobile sidebars', () => {
    expect(appSource).toContain('useState<SidebarSectionOrder>(loadSidebarSectionOrder)')
    expect(appSource).toContain('saveSidebarSectionOrder(sidebarSectionOrder)')
    expect(appSource.match(/sectionOrder=\{sidebarSectionOrder\}/g)).toHaveLength(2)
    expect(appSource.match(/onReorderSections=\{handleSidebarSectionReorder\}/g)).toHaveLength(2)
  })
})
