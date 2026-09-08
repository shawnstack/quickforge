import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

/**
 * The sortable project row is the only element in ChatSidebar carrying
 * `style={{ touchAction: 'none' }}`, so it is a stable anchor for slicing the
 * row markup from the style attribute through the end of the action overlay.
 */
function projectRowSource(): string {
  const rowStart = sidebarSource.indexOf("style={{ touchAction: 'none' }}")
  const overlayStart = sidebarSource.indexOf('projectActionOverlayClass', rowStart)
  return sidebarSource.slice(rowStart, sidebarSource.indexOf('</div>', overlayStart))
}

describe('ChatSidebar project row hit area', () => {
  it('binds expand/collapse to the whole row with a drag-suppression guard', () => {
    const rowSource = projectRowSource()
    const rowDivSource = rowSource.slice(0, rowSource.indexOf('<button'))

    expect(rowDivSource).toContain('{...listeners}')
    expect(rowDivSource).toContain('{...attributes}')
    expect(rowDivSource).toContain('onPointerDown={(event) => {')
    expect(rowDivSource).toContain('suppressProjectRowClickRef.current = false')
    expect(rowDivSource).toContain('listeners?.onPointerDown?.(event)')
    expect(rowDivSource).toContain('onClick={() => {')
    expect(rowDivSource).toContain('if (suppressProjectRowClickRef.current) {')
    expect(rowDivSource).toContain('suppressProjectRowClickRef.current = false')
    expect(rowDivSource).toContain('toggleProjectExpanded(item.id)')
    expect(sidebarSource).toContain('const suppressProjectRowClickRef = useRef(false)')
  })

  it('keeps the inner icon and title buttons click-free so taps bubble to the row', () => {
    const rowSource = projectRowSource()

    const iconButtonSource = rowSource.slice(
      rowSource.indexOf('<button'),
      rowSource.indexOf('</button>') + '</button>'.length,
    )
    expect(iconButtonSource).toContain('className={iconSlotClass}')
    expect(iconButtonSource).toContain("aria-label={expanded ? t('collapseProject') : t('expandProject')}")
    expect(iconButtonSource).not.toContain('onClick')

    const titleClassIndex = rowSource.indexOf('className="flex min-w-0 flex-1 items-center text-left"')
    const titleButtonSource = rowSource.slice(
      rowSource.lastIndexOf('<button', titleClassIndex),
      rowSource.indexOf('</button>', titleClassIndex) + '</button>'.length,
    )
    expect(titleButtonSource).toContain('title={item.path}')
    expect(titleButtonSource).not.toContain('onClick')
  })

  it('stops overlay menu and new-chat clicks from bubbling into the row toggle', () => {
    const rowSource = projectRowSource()
    const overlayStart = rowSource.indexOf('projectActionOverlayClass')

    const menuButtonSource = rowSource.slice(
      rowSource.indexOf('<Button', overlayStart),
      rowSource.indexOf('</Button>') + '</Button>'.length,
    )
    expect(menuButtonSource).toContain('event.stopPropagation()')
    expect(menuButtonSource).toContain('openProjectMenu(event, item.id)')
    expect(menuButtonSource).toContain("aria-label={t('moreOptions')}")

    const newChatButtonStart = rowSource.indexOf('<Button', rowSource.indexOf('</Button>'))
    const newChatButtonSource = rowSource.slice(
      newChatButtonStart,
      rowSource.indexOf('</Button>', newChatButtonStart) + '</Button>'.length,
    )
    expect(newChatButtonSource).toContain('event.stopPropagation()')
    expect(newChatButtonSource).toContain('onStartNewProjectChat(item)')
    expect(newChatButtonSource).toContain("aria-label={t('newProjectChat')}")
  })

  it('arms the click suppression whenever a project drag finishes or is cancelled', () => {
    const finishDragSource = sidebarSource.match(/const finishProjectDrag = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\)/)?.[0]

    expect(finishDragSource).toContain('suppressProjectRowClickRef.current = true')
    expect(finishDragSource).toContain('setIsProjectDragging(false)')
  })

  it('arms the suppression at drag start so Escape-cancel cannot leave a stale flag', () => {
    const dragStartSource = sidebarSource.match(/const handleDragStart = useCallback\(\(\) => \{[\s\S]*?\}, \[\]\)/)?.[0]

    expect(dragStartSource).toContain('suppressProjectRowClickRef.current = true')
    expect(dragStartSource).toContain('setIsProjectDragging(true)')
  })
})
