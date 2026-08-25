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

  it('compacts visual collapses while preserving expanded sizing and scroll boundaries', () => {
    const sortableSectionSource = sidebarSource.match(/function SortableSidebarSection([\s\S]*?)\n}\n\nexport const ChatSidebar/)?.[1]

    expect(sortableSectionSource).toContain('collapsed: boolean')
    expect(sortableSectionSource).toContain("'flex min-h-0 flex-col overflow-hidden'")
    expect(sortableSectionSource).toContain("collapsed ? 'shrink-0' : id === 'projects' ? 'max-h-[55%]' : 'flex-1'")
    expect(sidebarSource).toContain("collapsed={sectionId === 'projects' ? projectsVisuallyCollapsed : conversationsVisuallyCollapsed}")
    expect(sidebarSource).toContain('className="flex min-h-0 flex-1 flex-col overflow-hidden"')
    expect(sidebarSource).toContain('ref={projectsScrollViewportRef} className="h-full overflow-y-auto"')
    expect(sidebarSource).toContain('className="h-full overflow-y-auto pb-2"')
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

    const projectHeaderSource = sidebarSource.match(/<div className=\{sectionHeaderClass\}>\s*(<button[\s\S]*?onClick=\{onToggleProjectsCollapsed\}[\s\S]*?<\/button>)[\s\S]*?onClick=\{openViewSortMenu\}/)?.[1]
    const tasksHeaderSource = sidebarSource.match(/<div className=\{sectionHeaderClass\}>\s*(<button[\s\S]*?onClick=\{onToggleConversationsCollapsed\}[\s\S]*?<\/button>)[\s\S]*?onClick=\{onStartNewGlobalChat\}/)?.[1]

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

  it('temporarily collapses both sections during either section drag without mutating persisted collapse state', () => {
    expect(sidebarSource).toContain('const isSectionDragging = draggingSectionId !== undefined')
    expect(sidebarSource).toContain('const projectsVisuallyCollapsed = projectsCollapsed || isSectionDragging')
    expect(sidebarSource).toContain('const conversationsVisuallyCollapsed = conversationsCollapsed || isSectionDragging')
    expect(sidebarSource).not.toContain('onToggleProjectsCollapsed()')
    expect(sidebarSource).not.toContain('onToggleConversationsCollapsed()')
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
