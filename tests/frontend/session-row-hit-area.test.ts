import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

/**
 * All four session rows (pinned section, project timeline, project group,
 * global list) open the row container with the same hover-tip anchor, so the
 * four occurrences of that handler in document order are stable anchors for
 * slicing each row from the container attributes through the end of the
 * action overlay.
 */
function sessionRowSlices(): string[] {
  const indices: number[] = []
  let cursor = 0
  while (cursor < sidebarSource.length) {
    const found = sidebarSource.indexOf('onMouseEnter={(event) => showSessionHoverTip', cursor)
    if (found === -1) break
    indices.push(found)
    cursor = found + 1
  }
  expect(indices).toHaveLength(4)
  return indices.map((start) => {
    const overlayStart = sidebarSource.indexOf('actionOverlayClass', start)
    return sidebarSource.slice(start, sidebarSource.indexOf('</div>', overlayStart))
  })
}

/**
 * The pinned row wraps its title in a `div[role="button"]` while the other
 * three rows use a native `<button>`; both sit right before the overlay.
 */
function innerElementStart(rowSource: string): number {
  const roleButtonStart = rowSource.indexOf('role="button"')
  const buttonStart = rowSource.indexOf('<button')
  const start = roleButtonStart !== -1 && (buttonStart === -1 || roleButtonStart < buttonStart)
    ? roleButtonStart
    : buttonStart
  expect(start).toBeGreaterThanOrEqual(0)
  return start
}

describe('ChatSidebar session row hit area', () => {
  it('binds session loading to the whole row container in all four session lists', () => {
    const rows = sessionRowSlices()

    for (const rowSource of rows) {
      const rowContainerSource = rowSource.slice(0, innerElementStart(rowSource))
      expect(rowContainerSource).toContain('onMouseEnter={(event) => showSessionHoverTip(event, session.id)}')
      expect(rowContainerSource).toContain('onClickCapture={() => hideSessionHoverTip(session.id)}')
      expect(rowContainerSource).toContain('onMouseLeave')
      expect(rowContainerSource).toContain('onClick={() => onLoadSession(session.id)}')
    }
  })

  it('keeps the inner title elements click-free so taps bubble to the row', () => {
    const [pinned, timeline, projectGroup, globalList] = sessionRowSlices()

    for (const rowSource of [pinned, timeline, projectGroup, globalList]) {
      const innerSource = rowSource.slice(innerElementStart(rowSource), rowSource.indexOf('actionOverlayClass'))
      expect(innerSource).toContain('aria-busy={loadingSessionId === session.id}')
      expect(innerSource).not.toContain('onClick')
    }

    // The pinned row uses a div[role=button]: native divs never dispatch
    // click for Enter/Space, so keyboard activation must stay on onKeyDown.
    const pinnedInnerSource = pinned.slice(innerElementStart(pinned), pinned.indexOf('actionOverlayClass'))
    expect(pinnedInnerSource).toContain('role="button"')
    expect(pinnedInnerSource).toContain('tabIndex={0}')
    expect(pinnedInnerSource).toContain('onKeyDown={(event) => {')
    expect(pinnedInnerSource).toContain('onLoadSession(session.id)')
  })

  it('stops every overlay action click from bubbling into the row loader', () => {
    const pinHandler = sidebarSource.match(
      /const toggleSessionPinFromActions = \(event: React\.MouseEvent<HTMLButtonElement>, sessionId: string\) => \{[\s\S]*?\n {2}\}/,
    )?.[0]
    expect(pinHandler).toContain('event.stopPropagation()')
    expect(pinHandler).toContain('onTogglePinSession(sessionId)')

    const requestDeleteHandler = sidebarSource.match(
      /const requestDeleteSession = \(event: React\.MouseEvent<HTMLButtonElement>, sessionId: string\) => \{[\s\S]*?\n {2}\}/,
    )?.[0]
    expect(requestDeleteHandler).toContain('event.stopPropagation()')

    const confirmDeleteHandler = sidebarSource.match(
      /const confirmDeleteSession = \(event: React\.MouseEvent<HTMLButtonElement>, sessionId: string\) => \{[\s\S]*?\n {2}\}/,
    )?.[0]
    expect(confirmDeleteHandler).toContain('event.stopPropagation()')

    for (const rowSource of sessionRowSlices()) {
      const overlaySource = rowSource.slice(rowSource.indexOf('actionOverlayClass'))
      expect(overlaySource).toContain('confirmDeleteSession(event, session.id)')
      expect(overlaySource).toContain('toggleSessionPinFromActions(event, session.id)')
      expect(overlaySource).toContain('requestDeleteSession(event, session.id)')
    }
  })

  it('needs no drag-suppression guard: session rows are outside every sortable context', () => {
    expect(sidebarSource).not.toContain('suppressSessionRowClickRef')
  })
})
