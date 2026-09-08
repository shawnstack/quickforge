import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

/**
 * The three collapsible section headers (pinned / projects / conversations) all
 * render `className={sectionHeaderClass}`, so the three occurrences of that
 * string in document order are stable anchors for slicing each header region.
 */
function sectionHeaderSlices(): string[] {
  const indices: number[] = []
  let cursor = 0
  while (cursor < sidebarSource.length) {
    const found = sidebarSource.indexOf('className={sectionHeaderClass}', cursor)
    if (found === -1) break
    indices.push(found)
    cursor = found + 1
  }
  expect(indices).toHaveLength(3)
  const ends = [...indices.slice(1), sidebarSource.length]
  return indices.map((start, index) => sidebarSource.slice(start, ends[index]))
}

/**
 * Extracts the `<Button ...>...</Button>` element containing the given marker
 * so the stopPropagation wrapper can be asserted next to its original call.
 */
function buttonAround(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  expect(markerIndex).toBeGreaterThanOrEqual(0)
  const start = source.lastIndexOf('<Button', markerIndex)
  const end = source.indexOf('</Button>', markerIndex) + '</Button>'.length
  return source.slice(start, end)
}

describe('ChatSidebar section header hit area', () => {
  it('binds collapse toggles to the whole header row with a drag-suppression guard', () => {
    const [pinned, projects, conversations] = sectionHeaderSlices()

    const pinnedHeaderDiv = pinned.slice(0, pinned.indexOf('<button'))
    expect(pinnedHeaderDiv).toContain('onPointerDown={() => {')
    expect(pinnedHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(pinnedHeaderDiv).toContain('onClick={() => {')
    expect(pinnedHeaderDiv).toContain('if (suppressSectionHeaderClickRef.current) {')
    expect(pinnedHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(pinnedHeaderDiv).toContain('onTogglePinnedCollapsed()')

    const projectsHeaderDiv = projects.slice(0, projects.indexOf('<button'))
    expect(projectsHeaderDiv).toContain('onPointerDown={() => {')
    expect(projectsHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(projectsHeaderDiv).toContain('onClick={() => {')
    expect(projectsHeaderDiv).toContain('if (suppressSectionHeaderClickRef.current) {')
    expect(projectsHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(projectsHeaderDiv).toContain('toggleProjectsCollapsed()')

    const conversationsHeaderDiv = conversations.slice(0, conversations.indexOf('<button'))
    expect(conversationsHeaderDiv).toContain('onPointerDown={() => {')
    expect(conversationsHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(conversationsHeaderDiv).toContain('onClick={() => {')
    expect(conversationsHeaderDiv).toContain('if (suppressSectionHeaderClickRef.current) {')
    expect(conversationsHeaderDiv).toContain('suppressSectionHeaderClickRef.current = false')
    expect(conversationsHeaderDiv).toContain('toggleConversationsCollapsed()')
  })

  it('keeps the inner title buttons click-free so taps bubble to the header row', () => {
    const [pinned, projects, conversations] = sectionHeaderSlices()

    const pinnedTitle = pinned.slice(pinned.indexOf('<button'), pinned.indexOf('</button>') + '</button>'.length)
    expect(pinnedTitle).toContain('className={sectionToggleClass}')
    expect(pinnedTitle).toContain('aria-expanded={!pinnedCollapsed}')
    expect(pinnedTitle).not.toContain('onClick')

    const projectsTitle = projects.slice(projects.indexOf('<button'), projects.indexOf('</button>') + '</button>'.length)
    expect(projectsTitle).toContain('ref={setActivatorNodeRef}')
    expect(projectsTitle).toContain('draggableSectionTitleClass')
    expect(projectsTitle).toContain('aria-expanded={!projectsVisuallyCollapsed}')
    expect(projectsTitle).toContain('{...attributes}')
    expect(projectsTitle).toContain('{...listeners}')
    expect(projectsTitle).not.toContain('onClick')

    const conversationsTitle = conversations.slice(
      conversations.indexOf('<button'),
      conversations.indexOf('</button>') + '</button>'.length,
    )
    expect(conversationsTitle).toContain('ref={setActivatorNodeRef}')
    expect(conversationsTitle).toContain('draggableSectionTitleClass')
    expect(conversationsTitle).toContain('aria-expanded={!conversationsVisuallyCollapsed}')
    expect(conversationsTitle).toContain('{...attributes}')
    expect(conversationsTitle).toContain('{...listeners}')
    expect(conversationsTitle).not.toContain('onClick')
  })

  it('reuses the hover/focus-within action class for the conversations new-chat button', () => {
    const [, , conversations] = sectionHeaderSlices()
    const newChatButton = buttonAround(conversations, 'onStartNewGlobalChat()')

    expect(newChatButton).toContain('className={sectionActionButtonClass}')
    expect(newChatButton).not.toContain("className={cn(iconButtonClass, 'quickforge-sidebar-section-icon')}")
    expect(sidebarSource).toContain(
      "const sectionActionButtonClass = `quickforge-sidebar-section-icon ${iconButtonClass} pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`",
    )
  })

  it('stops section action button clicks from bubbling into the header toggle', () => {
    const [, projects, conversations] = sectionHeaderSlices()

    const viewSortButton = buttonAround(projects, 'openViewSortMenu(event)')
    expect(viewSortButton).toContain('event.stopPropagation()')
    expect(viewSortButton).toContain("aria-label={t('filterSort')}")

    const expandAllButton = buttonAround(projects, 'toggleAllProjectsExpanded()')
    expect(expandAllButton).toContain('event.stopPropagation()')
    expect(expandAllButton).toContain("t('collapseAllProjects')")

    const addProjectButton = buttonAround(projects, 'onSelectProjectDirectory()')
    expect(addProjectButton).toContain('event.stopPropagation()')
    expect(addProjectButton).toContain("aria-label={t('addProject')}")

    const newChatButton = buttonAround(conversations, 'onStartNewGlobalChat()')
    expect(newChatButton).toContain('event.stopPropagation()')
    expect(newChatButton).toContain("aria-label={t('newChat')}")
  })

  it('arms the click suppression whenever a section drag finishes or is cancelled', () => {
    const finishSectionDragSource = sidebarSource.match(/const finishSectionDrag = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\)/)?.[0]

    expect(finishSectionDragSource).toContain('suppressSectionHeaderClickRef.current = true')
    expect(finishSectionDragSource).toContain('setDraggingSectionId(undefined)')
  })

  it('arms the suppression at section drag start so Escape-cancel cannot leave a stale flag', () => {
    const sectionDragStartSource = sidebarSource.match(/const handleSectionDragStart = useCallback\(\([\s\S]*?\}, \[\]\)/)?.[0]

    expect(sectionDragStartSource).toContain('suppressSectionHeaderClickRef.current = true')
    expect(sectionDragStartSource).toContain('setDraggingSectionId(activeSectionId)')
  })

  it('declares the shared suppression ref next to the project row one', () => {
    expect(sidebarSource).toContain('const suppressSectionHeaderClickRef = useRef(false)')
    expect(sidebarSource.indexOf('const suppressProjectRowClickRef = useRef(false)')).toBeLessThan(
      sidebarSource.indexOf('const suppressSectionHeaderClickRef = useRef(false)'),
    )
  })
})
