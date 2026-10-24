import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')
const rowSource = readFileSync(new URL('../../src/components/sidebar/chat-sidebar/SidebarSessionRow.tsx', import.meta.url), 'utf8')

// 四个会话分区（置顶 / 时间线 / 项目组 / 全局）共用 SidebarSessionRow 一个实现：
// 命中区契约在行组件上断言一次，装配层（sessionRowProps）的透传在 ChatSidebar 上断言。
describe('ChatSidebar session row hit area', () => {
  it('binds session loading to the whole row container in all four session lists', () => {
    expect(sidebarSource).toContain('loading: loadingSessionId === session.id')
    expect(sidebarSource).toContain('onHoverTipEnter: showSessionHoverTip')
    expect(sidebarSource).toContain('onHoverTipHide: hideSessionHoverTip')
    expect(sidebarSource).toContain('onRowMouseLeave: handleSessionRowMouseLeave')

    const containerStart = rowSource.indexOf('onMouseEnter={(event) => onHoverTipEnter')
    const overlayStart = rowSource.indexOf('className={cn(actionOverlayClass')
    expect(containerStart).toBeGreaterThan(-1)
    expect(overlayStart).toBeGreaterThan(containerStart)
    const rowContainerSource = rowSource.slice(containerStart, overlayStart)
    expect(rowContainerSource).toContain('onMouseEnter={(event) => onHoverTipEnter(event, session.id)}')
    expect(rowContainerSource).toContain('onClickCapture={() => onHoverTipHide(session.id)}')
    expect(rowContainerSource).toContain('onMouseLeave={() => onRowMouseLeave(session.id, deleting)}')
    expect(rowContainerSource).toContain('onClick={() => onLoadSession(session.id)}')
  })

  it('keeps the inner title elements click-free so taps bubble to the row', () => {
    const interactiveStart = rowSource.indexOf("variant === 'pinned' ? (")
    const overlayStart = rowSource.indexOf('className={cn(actionOverlayClass')
    expect(interactiveStart).toBeGreaterThan(-1)
    expect(overlayStart).toBeGreaterThan(interactiveStart)
    const innerSource = rowSource.slice(interactiveStart, overlayStart)
    expect(innerSource).toContain('aria-busy={loading}')
    expect(innerSource).not.toContain('onClick')

    // The pinned row uses a div[role=button]: native divs never dispatch
    // click for Enter/Space, so keyboard activation must stay on onKeyDown.
    const pinnedBranch = innerSource.slice(0, innerSource.indexOf(') : ('))
    expect(pinnedBranch).toContain('role="button"')
    expect(pinnedBranch).toContain('tabIndex={0}')
    expect(pinnedBranch).toContain('onKeyDown={(event) => {')
    expect(pinnedBranch).toContain('onLoadSession(session.id)')
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

    const overlaySource = rowSource.slice(rowSource.indexOf('className={cn(actionOverlayClass'))
    expect(overlaySource).toContain('onConfirmDelete(event, session.id)')
    expect(overlaySource).toContain('onTogglePin(event, session.id)')
    expect(overlaySource).toContain('onRequestDelete(event, session.id)')
    expect(sidebarSource).toContain('onTogglePin: toggleSessionPinFromActions')
    expect(sidebarSource).toContain('onRequestDelete: requestDeleteSession')
    expect(sidebarSource).toContain('onConfirmDelete: confirmDeleteSession')
  })

  it('needs no drag-suppression guard: session rows are outside every sortable context', () => {
    expect(sidebarSource).not.toContain('suppressSessionRowClickRef')
    expect(rowSource).not.toContain('suppressSessionRowClickRef')
  })
})
