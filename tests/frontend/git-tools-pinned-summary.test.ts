import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The real i18n module pulls in pi-web-ui, which requires a browser DOM; the
// source contracts below only need the app translation keys to exist.
vi.mock('@earendil-works/pi-web-ui', () => ({ translations: { en: {}, zh: {} } }))

import { GitToolsPinnedSummary } from '../../src/components/git/GitToolsPinnedSummary'
import type { GoalState } from '../../src/lib/goal'

const summarySource = readFileSync(new URL('../../src/components/git/GitToolsPinnedSummary.tsx', import.meta.url), 'utf8')
const goalSectionSource = readFileSync(new URL('../../src/components/git/GoalSummarySection.tsx', import.meta.url), 'utf8')
const goalUiSource = readFileSync(new URL('../../src/lib/goal-ui.ts', import.meta.url), 'utf8')
const goalInspectorSource = readFileSync(new URL('../../src/components/workspace/GoalInspectorContent.tsx', import.meta.url), 'utf8')
const dragSource = readFileSync(new URL('../../src/lib/pinned-summary-drag.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function desktopWidgetBlock() {
  return summarySource.slice(
    summarySource.indexOf('const desktopFloatingWidget'),
    summarySource.indexOf('return (\n    <>', summarySource.indexOf('const desktopFloatingWidget')),
  )
}

describe('GitToolsPinnedSummary source contract', () => {
  it('keeps the summary mounted only while the real desktop Inspector sidebar suspends it', () => {
    expect(appSource).toContain("window.matchMedia('(min-width: 1024px)')")
    expect(appSource).toContain('const canSuspendPinnedSummaryOnInspectorOpen = useMemo(')
    expect(appSource).toContain('() => shouldSuspendPinnedSummary({')
    expect(appSource).toContain('inspectorOpen: true')
    expect(appSource).toContain('desktopInspectorViewport')
    expect(appSource).toContain('mobileShell')
    expect(appSource).toContain('const pinnedSummarySuspended = workspaceInspectorOpen && canSuspendPinnedSummaryOnInspectorOpen')
    expect(appSource).toContain('!workspaceInspectorOpen\n        || pinnedSummarySuspended')
    expect(appSource).toContain('suspended={pinnedSummarySuspended}')
    expect(appSource).toContain('pinnedSummaryTodos.length > 0')
    expect(appSource).toContain('pinnedSummarySubagentRuns.length > 0')
    expect(appSource).toContain('pinnedSummaryRunningSubagentRuns.length > 0')
    expect(appSource).toContain('titleGitStatus?.isGitRepository')
    expect(summarySource).toContain('suspended?: boolean')
    expect(summarySource).toContain('suspended = false')
    expect(summarySource).toContain('!hasGoalSection')
    expect(summarySource).toContain('&& !hasGitSection\n  ) return null')
  })

  it('hides both toolbar and fixed widget from layout, input, Tab order, and accessibility while suspended', () => {
    expect(summarySource).toContain("className={cn('relative', suspended && 'hidden')}")
    expect(summarySource).toContain("className={cn('quickforge-pinned-summary-widget fixed z-40', suspended && 'hidden')}")
    expect(summarySource.match(/hidden=\{suspended\}/g)).toHaveLength(2)
    expect(summarySource.match(/aria-hidden=\{suspended \|\| undefined\}/g)).toHaveLength(2)
    expect(summarySource.match(/inert=\{suspended \? true : undefined\}/g)).toHaveLength(2)
    expect(summarySource).not.toContain("suspended && 'opacity-0'")
  })

  it('pauses temporary interactions without cancelling an explicit close timer or normalizing mounted state', () => {
    const suspensionEffect = summarySource.slice(
      summarySource.indexOf('if (!suspended) return'),
      summarySource.indexOf("if (typeof window.matchMedia !== 'function')", summarySource.indexOf('if (!suspended) return')),
    )
    expect(suspensionEffect).toContain('clearFocusFrame()')
    expect(suspensionEffect).toContain('finishDrag()')
    expect(suspensionEffect).toContain('window.cancelAnimationFrame(responsiveCleanupFrameRef.current)')
    expect(suspensionEffect).toContain('window.cancelAnimationFrame(dragFrameRef.current)')
    expect(suspensionEffect).toContain('queueMicrotask(() => setBranchMenuOpen(false))')
    expect(suspensionEffect).not.toContain('clearCloseAnimationTimer()')
    expect(suspensionEffect).not.toContain('setDesktopWidgetClosing(')
    expect(suspensionEffect).not.toContain('setDesktopWidgetMounted(')
    expect(suspensionEffect).not.toContain('requestAnimationFrame(')
    expect(suspensionEffect).toContain('queueMicrotask(')
    expect(suspensionEffect).not.toContain('setPosition(')
    expect(suspensionEffect).not.toContain('setCapsuleVisible(')
    expect(suspensionEffect).not.toContain('setExpandedTasksSignature(')
    expect(suspensionEffect).not.toContain('setFinishedSubagentRunsCollapsed(')
    expect(suspensionEffect).not.toContain('onExpandedChange(')
    expect(summarySource).not.toContain('normalizePinnedSummaryMountedForSuspension')
    expect(summarySource).not.toContain('suspensionCleanupFrameRef')
    const unmountCleanup = summarySource.slice(
      summarySource.indexOf('useEffect(() => () => {'),
      summarySource.indexOf('if (todos.length === 0', summarySource.indexOf('useEffect(() => () => {')),
    )
    expect(unmountCleanup).toContain('clearCloseAnimationTimer()')
    expect(summarySource).toContain('if (desktopDraggable || !floatingSummaryVisible || suspended) return')
    expect(summarySource).toContain('if (!desktopDraggable || suspended) return\n    window.addEventListener(\'resize\', clampCurrentPosition)')
    expect(summarySource).toContain('if (!desktopDraggable || !desktopWidgetMounted || suspended) return undefined')
    expect(summarySource).toContain('if (!desktopDraggable || !desktopWidgetMounted || suspended) return')
  })

  it('cancels pending focus work while suspended and never focuses a hidden summary node', () => {
    expect(summarySource).toContain('const focusFrameRef = useRef<number | null>(null)')
    expect(summarySource).toContain('window.cancelAnimationFrame(focusFrameRef.current)')
    expect(summarySource).toContain('if (suspended) return\n      target()?.focus()')
    expect(summarySource).toContain('scheduleSummaryFocus(() => desktopPanelMinimizeRef.current)')
    expect(summarySource).toContain('scheduleSummaryFocus(() => capsuleMainRef.current)')
    expect(summarySource).toContain('scheduleSummaryFocus(() => topTriggerRef.current)')
    expect(summarySource).not.toContain('window.requestAnimationFrame(() => desktopPanelMinimizeRef.current?.focus())')
    expect(summarySource).not.toContain('window.requestAnimationFrame(() => capsuleMainRef.current?.focus())')
    expect(summarySource).not.toContain('window.requestAnimationFrame(() => topTriggerRef.current?.focus())')
  })

  it('marks the PanelRight toggle for compatibility without requiring desktop outside-dismiss exceptions', () => {
    expect(appSource).toContain('data-pinned-summary-inspector-toggle="true"')
    expect(summarySource).not.toContain("target?.closest('[data-pinned-summary-inspector-toggle=\"true\"]')")
  })

  it('uses the same future suspension capability for the direct PanelRight open branch and leaves close untouched', () => {
    const panelRightClick = appSource.slice(
      appSource.indexOf('onClick={() => {', appSource.indexOf('data-pinned-summary-inspector-toggle="true"') - 600),
      appSource.indexOf('data-pinned-summary-inspector-toggle="true"'),
    )
    const closeBranch = panelRightClick.slice(
      panelRightClick.indexOf('if (workspaceInspectorOpen) {'),
      panelRightClick.indexOf('} else {'),
    )
    const openBranch = panelRightClick.slice(panelRightClick.indexOf('} else {'))
    expect(closeBranch).toContain('setWorkspaceInspectorOpen(false)')
    expect(closeBranch).not.toContain('setGitToolsExpanded(false)')
    expect(openBranch).toContain('if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {')
    expect(openBranch).toContain('setGitToolsExpanded(false)')
    expect(openBranch.indexOf('setGitToolsExpanded(false)')).toBeLessThan(openBranch.indexOf('setWorkspaceInspectorOpen(true)'))
  })

  it('closes mobile and overlay summaries before Inspector actions but preserves the desktop suspended panel; Commit/Push always closes', () => {
    const subagentCallback = appSource.slice(
      appSource.indexOf('onOpenSubagentRun={(payload) => {'),
      appSource.indexOf('onOpenChanges={() => {'),
    )
    const changesCallback = appSource.slice(
      appSource.indexOf('onOpenChanges={() => {'),
      appSource.indexOf('onOpenCommitPush={() => {'),
    )
    const commitCallback = appSource.slice(
      appSource.indexOf('onOpenCommitPush={() => {'),
      appSource.indexOf('mobileShell={mobileShell}'),
    )
    for (const callback of [subagentCallback, changesCallback]) {
      expect(callback).toContain('if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {')
      expect(callback).toContain('setGitToolsExpanded(false)')
    }
    expect(subagentCallback).toContain('openSubagentRun(payload)')
    expect(changesCallback).toContain('openWorkspaceGitChanges()')
    expect(commitCallback).toContain('setGitToolsExpanded(false)')
    expect(commitCallback).toContain('setGitCommitDialogOpen(true)')
  })

  it('reuses directional layout safety on suspension exit without opening, minimizing, or focusing', () => {
    const resumeEffect = summarySource.slice(
      summarySource.indexOf('const wasSuspended = wasSuspendedRef.current'),
      summarySource.indexOf('useEffect(() => {', summarySource.indexOf('const wasSuspended = wasSuspendedRef.current')),
    )
    expect(resumeEffect).toContain('if (!wasSuspended || suspended || !desktopDraggable || !desktopWidgetMounted) return')
    expect(resumeEffect).toContain("const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current")
    expect(resumeEffect).toContain("applyResolvedLayout(current, targetSize, desktopMode === 'panel' ? 'panel' : 'capsule')")
    expect(resumeEffect).not.toContain('openDesktopPanel')
    expect(resumeEffect).not.toContain('minimizeDesktopPanel')
    expect(resumeEffect).not.toContain('.focus()')
  })

  it('always keeps the toolbar List trigger and exposes floating visibility state', () => {
    const trigger = summarySource.slice(summarySource.indexOf('ref={topTriggerRef}'), summarySource.indexOf('{desktopFloatingWidget}'))
    expect(trigger).toContain('<List className="size-[18px]" />')
    expect(trigger).toContain('onClick={toggleSummaryFromToolbar}')
    expect(trigger).toContain('aria-pressed={floatingSummaryVisible}')
    expect(trigger).toContain('aria-expanded={floatingSummaryVisible}')
    expect(summarySource).toContain("const desktopMode: DesktopMode = expanded ? 'panel' : capsuleVisible ? 'capsule' : 'closed'")
    expect(summarySource).toContain('if (floatingSummaryVisible) closeSummary()')
    expect(summarySource).toContain('else if (desktopDraggable) openDesktopPanel()')
  })

  it('implements desktop closed, capsule, and panel transitions with compatible expanded semantics', () => {
    const open = summarySource.slice(summarySource.indexOf('const openDesktopPanel'), summarySource.indexOf('const minimizeDesktopPanel'))
    const minimize = summarySource.slice(summarySource.indexOf('const minimizeDesktopPanel'), summarySource.indexOf('const closeSummary'))
    const close = summarySource.slice(summarySource.indexOf('const closeSummary'), summarySource.indexOf('const toggleSummaryFromToolbar'))
    expect(open).toContain('setCapsuleVisible(false)')
    expect(open).toContain('onExpandedChange(true)')
    expect(minimize).toContain('setCapsuleVisible(true)')
    expect(minimize).toContain('onExpandedChange(false)')
    expect(close).toContain('setCapsuleVisible(false)')
    expect(close).toContain('onExpandedChange(false)')
    expect(close).toContain('setDesktopWidgetClosing(true)')
    expect(close).toContain('}, 160)')
    expect(summarySource).toContain('const previousExpandedRef = useRef(expanded)')
    expect(summarySource).toContain('if (previousExpanded && !capsuleVisible && desktopWidgetMounted && !desktopWidgetClosing)')
  })

  it('keeps one mounted desktop widget and crossfades panel/capsule with measured dimensions', () => {
    const widget = desktopWidgetBlock()
    const applyResolvedLayoutBlock = summarySource.slice(
      summarySource.indexOf('const applyResolvedLayout'),
      summarySource.indexOf('const getPanelNaturalHeight'),
    )
    expect(widget).toContain('data-mode={desktopMode === \'closed\' ? \'capsule\' : desktopMode}')
    expect(widget).toContain('data-closing={desktopWidgetClosing ? \'true\' : \'false\'}')
    expect(widget).toContain('data-dragging={dragging ? \'true\' : \'false\'}')
    expect(widget).toContain('quickforge-pinned-summary-capsule')
    expect(widget).toContain('quickforge-pinned-summary-panel')
    expect(summarySource).toContain('new ResizeObserver(measure)')
    expect(summarySource).toContain("const layoutPosition = dragRef.current?.current ?? positionRef.current")
    expect(summarySource).toContain("if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)")
    expect(applyResolvedLayoutBlock).not.toContain('updatePosition(layout.position)\n    setPanelMaxHeight')
    expect(summarySource).toContain("'--quickforge-pinned-summary-panel-height'")
    expect(summarySource).toContain('const borderBoxDelta = Math.max(0, panel.offsetHeight - panel.clientHeight)')
    expect(summarySource).toContain('const headerHeight = desktopPanelHeaderRef.current?.offsetHeight ?? 0')
    expect(summarySource).toContain('return headerHeight + content.scrollHeight + borderBoxDelta')
    expect(summarySource).toContain('ref={desktopPanelContentRef}')
    expect(summarySource).toContain("'--quickforge-pinned-summary-capsule-width'")
    expect(summarySource).toContain("'--quickforge-pinned-summary-panel-max-height': desktopMode !== 'panel' || panelMaxHeight === undefined")
    expect(summarySource).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4')
    expect(summarySource).not.toContain("branchMenuOpen ? 'overflow-visible'")
    expect(summarySource).not.toContain("branchMenuSide === 'left'")
    expect(cssSource).toContain('width 220ms cubic-bezier(.22,.8,.24,1)')
    expect(cssSource).toContain('height 220ms cubic-bezier(.22,.8,.24,1)')
    expect(cssSource).toContain('max-height: var(--quickforge-pinned-summary-panel-max-height')
    expect(cssSource).not.toContain('height: min(max-content')
    expect(cssSource).toContain('transform-origin: top right')
    expect(cssSource).toContain('.quickforge-pinned-summary-widget[data-mode="panel"] .quickforge-pinned-summary-capsule')
    expect(cssSource).toContain('.quickforge-pinned-summary-widget[data-mode="panel"] .quickforge-pinned-summary-panel')
    expect(cssSource).toContain('.quickforge-pinned-summary-widget[data-dragging="true"]')
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)')
    expect(cssSource).not.toContain('quickforge-pinned-summary-enter')
  })

  it('renders panel minimize and close as separate accessible actions', () => {
    const widget = desktopWidgetBlock()
    expect(widget).toContain("onClick={() => minimizeDesktopPanel()} aria-label={t('pinnedSummaryMinimize')}")
    expect(widget).toContain('<Minimize2 className="size-4"')
    expect(widget).toContain('<Maximize2 className="size-3.5" />')
    expect(widget).toContain("onClick={() => closeSummary({ focusTrigger: true })} aria-label={t('pinnedSummaryClose')}")
    expect(widget).toContain('<X className="size-4"')
  })

  it('uses a non-button Maximize2 visual slot inside the capsule body while keeping X independent', () => {
    const widget = desktopWidgetBlock()
    const capsuleMain = widget.slice(
      widget.indexOf('<button\n          ref={capsuleMainRef}'),
      widget.indexOf('<button\n          type="button"\n          className="quickforge-pinned-summary-capsule-close'),
    )
    expect(capsuleMain).toContain('className="quickforge-pinned-summary-capsule-main group')
    expect(capsuleMain).toContain('openDesktopPanel()')
    expect(capsuleMain).toContain('inline-flex size-7 shrink-0 items-center justify-center rounded-full')
    expect(capsuleMain).toContain('group-hover:bg-muted/40')
    expect(capsuleMain).toContain('group-focus-visible:bg-muted/40')
    expect(capsuleMain).toContain('aria-hidden="true"')
    expect(capsuleMain).toContain('<Maximize2 className="size-3.5" />')
    expect(capsuleMain.match(/<button/g)).toHaveLength(1)
    expect(widget).toContain('className="quickforge-pinned-summary-capsule-close')
    expect(widget).toContain('event.stopPropagation()')
    expect(widget).toContain("closeSummary({ focusTrigger: true })")
    expect(widget).toContain('<X className="size-4"')
    expect(widget).toContain('size-8 shrink-0')
    expect(summarySource).not.toContain('ChevronUp')
  })

  it('uses three semantic capsule categories with icons and one combined agent segment', () => {
    expect(summarySource).toContain("key: 'tasks'")
    expect(summarySource).toContain('<ListTodo className="size-3.5"')
    expect(summarySource).toContain("key: 'git'")
    expect(summarySource).toContain('<FileDiff className="size-3.5"')
    expect(summarySource).toContain("key: 'agents'")
    expect(summarySource).toContain('<Bot className="size-3.5"')
    expect(summarySource).toContain('<span>{agentRunningCount}/{agentFinishedCount}</span>')
    expect(summarySource).not.toContain('pinnedSummaryCapsuleRunningAria')
    expect(summarySource).not.toContain('pinnedSummaryCapsuleFinishedAria')
    expect(summarySource).toContain("key: 'fallback'")
  })

  it('renders dividers only between actual segments using foreground/15', () => {
    expect(summarySource).toContain('capsuleSegments.map((segment, index) => (')
    expect(summarySource).toContain('index > 0 ? <span className="h-3.5 w-px shrink-0 bg-foreground/15"')
    expect(summarySource).not.toContain('border-border/60')
  })

  it('does not install or handle summary-level outside/Escape dismissal on desktop', () => {
    const dismissEffect = summarySource.slice(
      summarySource.indexOf('if (desktopDraggable || !floatingSummaryVisible || suspended) return'),
      summarySource.indexOf('useEffect(() => () => {'),
    )
    expect(dismissEffect).toContain("getPinnedSummaryOutsideAction(false) === 'close'")
    expect(dismissEffect).toContain("if (event.key === 'Escape') closeSummary({ focusTrigger: true })")
    expect(dismissEffect).toContain("document.addEventListener('pointerdown', handlePointerDown)")
    expect(dismissEffect).toContain("document.addEventListener('keydown', handleKeyDown)")
    expect(dismissEffect).not.toContain('desktopWidgetRef.current?.contains')
    expect(dismissEffect).not.toContain('minimizeDesktopPanel')
    expect(dismissEffect).not.toContain('preventDefault')
    expect(dismissEffect).not.toContain('stopPropagation')
    expect(dragSource).toContain("export type PinnedSummaryOutsideAction = 'stay' | 'close'")
    expect(dragSource).not.toContain("'minimize'")
  })

  it('keeps mobile and mobileShell as List plus fixed panel with no desktop minimize/capsule branch', () => {
    const mobile = summarySource.slice(summarySource.indexOf('{!desktopDraggable && expanded ? ('), summarySource.indexOf('{desktopFloatingWidget}'))
    expect(mobile).toContain('fixed inset-x-2 top-14')
    expect(mobile).toContain("mobileShell && 'md:fixed md:inset-x-2 md:right-auto md:top-14")
    expect(mobile).toContain("aria-label={t('pinnedSummaryClose')}")
    expect(mobile).not.toContain('pinnedSummaryMinimize')
    expect(mobile).not.toContain('quickforge-pinned-summary-capsule')
    expect(summarySource.match(/top-\[9\.25rem\]/g)).toHaveLength(3)
    expect(summarySource.match(/max-h-\[calc\(100dvh-9\.75rem\)\]/g)).toHaveLength(2)
    expect(summarySource).not.toContain('touch-none')
    expect(summarySource).not.toContain('touchAction')
  })

  it('opens the branch menu beside the desktop floating panel instead of inside its content flow', () => {
    const widget = desktopWidgetBlock()
    const sections = summarySource.slice(
      summarySource.indexOf('const summarySections'),
      summarySource.indexOf('const desktopWidgetStyle'),
    )
    expect(widget).toContain('{branchMenuOpen && desktopDraggable && branchMenuPlacement && projectId ? (')
    expect(widget).toContain("branchMenuPlacement.side === 'left' ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left'")
    expect(widget).toContain('style={{ top: branchMenuPlacement.top, maxHeight: branchMenuPlacement.maxHeight }}')
    expect(sections).toContain('{!desktopDraggable && branchMenuOpen ? (')
    expect(sections).toContain('top-[9.25rem]')
    expect(sections).not.toContain('md:top-full')
    expect(summarySource).not.toContain('md:top-full')
    expect(summarySource).not.toContain('md:w-full md:overflow-y-auto')
    expect(summarySource).toContain('const rowRect = row.getBoundingClientRect()')
    expect(summarySource).toContain('const widgetRect = widget.getBoundingClientRect()')
    expect(summarySource).toContain('Math.round(rowRect.top - widgetRect.top)')
    expect(summarySource).toContain('PINNED_BRANCH_MENU_WIDTH')
    expect(summarySource).toContain('PINNED_BRANCH_MENU_MAX_HEIGHT')
    expect(summarySource).toContain('useEffect(() => {\n    queueMicrotask(() => setBranchMenuOpen(false))\n  }, [desktopDraggable])')
  })

  it('tracks the active pointer on window until move/up/cancel and captures only after a real drag', () => {
    expect(summarySource).toContain('hasPinnedSummaryDragThreshold(drag.start, currentPointer)')
    expect(summarySource).toContain('pointerTarget: event.currentTarget')
    expect(summarySource).toContain('drag.captureTarget = drag.pointerTarget')
    expect(summarySource).toContain('drag.pointerTarget.setPointerCapture(event.pointerId)')
    expect(summarySource.indexOf('drag.captureTarget = drag.pointerTarget')).toBeGreaterThan(summarySource.indexOf('hasPinnedSummaryDragThreshold(drag.start, currentPointer)'))
    expect(summarySource).toContain("window.addEventListener('pointermove', handlePointerMove)")
    expect(summarySource).toContain("window.addEventListener('pointerup', handlePointerEnd)")
    expect(summarySource).toContain("window.addEventListener('pointercancel', handlePointerEnd)")
    expect(summarySource).toContain("window.removeEventListener('pointermove', handlePointerMove)")
    expect(summarySource).toContain("window.removeEventListener('pointerup', handlePointerEnd)")
    expect(summarySource).toContain("window.removeEventListener('pointercancel', handlePointerEnd)")
    expect(summarySource).toContain('dragTrackingCleanupRef.current?.()')
    expect(summarySource).toContain('suppressClickRef.current = true')
    expect(summarySource).toContain('if (suppressClickRef.current) return')
    expect(summarySource).toContain("document.body.style.userSelect = 'none'")
    expect(summarySource).toContain('window.requestAnimationFrame(() => {')
    expect(summarySource).toContain("window.addEventListener('resize', clampCurrentPosition)")
    expect(summarySource).toContain('drag.captureTarget.releasePointerCapture(drag.pointerId)')
    expect(summarySource).not.toContain('captureTarget: event.currentTarget')
    expect(dragSource).toContain('Math.hypot(currentX - startX, currentY - startY) >= safeThreshold')
  })

  it('clears desktop-only widget state on mobile downgrade without closing an expanded mobile panel', () => {
    const responsiveEffect = summarySource.slice(
      summarySource.indexOf('const previousExpanded = previousExpandedRef.current'),
      summarySource.indexOf('useLayoutEffect(() =>', summarySource.indexOf('const previousExpanded = previousExpandedRef.current')),
    )
    expect(responsiveEffect).toContain('if (!desktopDraggable)')
    expect(responsiveEffect).toContain('setPosition(undefined)')
    expect(responsiveEffect).toContain('setCapsuleVisible(false)')
    expect(responsiveEffect).toContain('setDesktopWidgetMounted(false)')
    expect(responsiveEffect).toContain('setDesktopWidgetClosing(false)')
    expect(responsiveEffect).not.toContain('onExpandedChange(false)')
  })

  it('clamps shape changes against transform-independent target layout dimensions', () => {
    expect(summarySource).toContain('const width = element.offsetWidth')
    expect(summarySource).toContain('const height = element.offsetHeight')
    expect(summarySource).toContain('if (width > 0 && height > 0) return { width, height }')
    expect(summarySource).toContain('width: width || rect.width')
    expect(summarySource).toContain('height: height || rect.height')
    expect(summarySource).toContain("const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current")
    expect(summarySource.match(/const targetSize = getPinnedSummaryLayoutSize\(target \?\? widget\)/g)).toHaveLength(3)
    expect(summarySource).toContain('const capsuleSize = getPinnedSummaryLayoutSize(capsule)')
    expect(summarySource).toContain('const panelSize = getPinnedSummaryLayoutSize(panel)')
    expect(summarySource).not.toContain('(target ?? widget).getBoundingClientRect()')
    expect(summarySource).toContain('const fallbackRect = rootRef.current?.getBoundingClientRect() ?? widgetRect')
    expect(summarySource).toContain('fallbackRect,')
    expect(summarySource).toContain('resolvePinnedSummaryInitialPosition({')
    expect(summarySource).toContain('resolvePinnedSummaryLayout(')
    expect(summarySource).toContain("if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)")
    expect(summarySource).toContain('targetSize,')
  })

  it('anchors only the first desktop position below the conversation header and preserves toolbar-root then widget fallback order', () => {
    expect(appSource).toContain('const conversationHeaderRef = useRef<HTMLElement | null>(null)')
    expect(appSource).toContain('<header ref={conversationHeaderRef}')
    expect(appSource).toContain('initialAnchorRef={conversationHeaderRef}')
    expect(summarySource).toContain('initialAnchorRef: RefObject<HTMLElement | null>')

    const initialPositionBranch = summarySource.slice(
      summarySource.indexOf('if (!positionRef.current) {'),
      summarySource.indexOf('clampCurrentPosition()', summarySource.indexOf('if (!positionRef.current) {')),
    )
    expect(initialPositionBranch).toContain('resolvePinnedSummaryInitialPosition({')
    expect(initialPositionBranch).toContain('anchorRect: initialAnchorRef.current?.getBoundingClientRect()')
    expect(initialPositionBranch).toContain('const fallbackRect = rootRef.current?.getBoundingClientRect() ?? widgetRect')
    expect(initialPositionBranch).toContain('fallbackRect,')
    expect(initialPositionBranch).toContain('applyResolvedLayout(initialPosition, targetSize')
    expect(summarySource.match(/initialAnchorRef\.current\?\.getBoundingClientRect\(\)/g)).toHaveLength(1)
    expect(summarySource).not.toContain('querySelector')
    expect(dragSource).toContain('export const PINNED_SUMMARY_INITIAL_GAP = 10')
    expect(dragSource).toContain('export const PINNED_SUMMARY_INITIAL_RIGHT_INSET = 12')
    expect(dragSource).toContain('x: finiteOr(anchorRect.right, fallbackRect.right) - Math.max(0, finiteOr(targetSize.width, 0)) - PINNED_SUMMARY_INITIAL_RIGHT_INSET')
    expect(dragSource).toContain('y: Math.ceil(finiteOr(anchorRect.bottom, fallbackRect.y)) + PINNED_SUMMARY_INITIAL_GAP')
    expect(dragSource).not.toMatch(/\b(?:28|32|56)\b/)
    expect(summarySource).not.toContain('localStorage')
  })

  it('never re-reads the conversation header for drag, shape changes, resize, or Inspector resume', () => {
    const initialBranchStart = summarySource.indexOf('if (!positionRef.current) {')
    const initialBranchEnd = summarySource.indexOf('clampCurrentPosition()', initialBranchStart)
    const withoutInitialBranch = `${summarySource.slice(0, initialBranchStart)}${summarySource.slice(initialBranchEnd)}`
    expect(withoutInitialBranch).not.toContain('initialAnchorRef.current')

    const resumeEffect = summarySource.slice(
      summarySource.indexOf('const wasSuspended = wasSuspendedRef.current'),
      summarySource.indexOf('useEffect(() => {', summarySource.indexOf('const wasSuspended = wasSuspendedRef.current')),
    )
    expect(resumeEffect).toContain('const current = positionRef.current ??')
    expect(resumeEffect).toContain('applyResolvedLayout(current, targetSize')
    expect(resumeEffect).not.toContain('initialAnchorRef')
    expect(resumeEffect).not.toContain('resolvePinnedSummaryInitialPosition')
  })

  it('keeps current groups, task expansion, and agent folding state inside the component', () => {
    expect(summarySource).toContain('todos.slice(0, 3)')
    expect(summarySource).toContain("t('pinnedViewAllTasks'")
    expect(summarySource).toContain('setFinishedSubagentRunsCollapsed((value) => !value)')
    expect(summarySource).toContain('aria-expanded={!finishedSubagentRunsCollapsed}')
  })

  it('defines matching three-state and capsule aria keys in both languages', () => {
    for (const key of [
      'pinnedSummaryExpand',
      'pinnedSummaryMinimize',
      'pinnedSummaryClose',
      'pinnedSummaryDrag',
      'pinnedSummaryCapsuleAria',
      'pinnedSummaryCapsuleTasksAria',
      'pinnedSummaryCapsuleGitAria',
      'pinnedSummaryCapsuleAgentsAria',
      'pinnedSummaryCapsuleFallbackAria',
      'pinnedSummaryCapsuleSeparator',
    ]) {
      expect(i18nSource.match(new RegExp(`${key}:`, 'g'))).toHaveLength(2)
    }
    for (const removedKey of ['pinnedSummaryCapsuleRunningAria', 'pinnedSummaryCapsuleFinishedAria']) {
      expect(i18nSource).not.toContain(`${removedKey}:`)
    }
    expect(i18nSource).toContain("pinnedSummaryMinimize: 'Minimize to summary'")
    expect(i18nSource).toContain("pinnedSummaryMinimize: '缩小为摘要'")
    expect(i18nSource).toContain("pinnedSummaryClose: 'Close pinned summary'")
    expect(i18nSource).toContain("pinnedSummaryClose: '关闭置顶摘要'")
  })
})

describe('GitToolsPinnedSummary goal section', () => {
  const goalState: GoalState = {
    id: 'goal-1',
    sessionId: 'session-1',
    revision: 3,
    objective: '收敛 Goal 到置顶摘要',
    status: 'running',
    criteria: [{ id: 'c1', description: '构建通过', required: true, status: 'passed', evidenceIds: [] }],
    scope: [],
    summary: '',
    budget: { maxIterations: 8, maxActiveDurationMs: 1_800_000 },
    usage: { iterations: 5, activeDurationMs: 1_080_000 },
    evidence: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function renderSummary(overrides: Record<string, unknown> = {}) {
    return renderToStaticMarkup(createElement(GitToolsPinnedSummary, {
      todos: [],
      runningSubagentRuns: [],
      finishedSubagentRuns: [],
      expanded: true,
      onExpandedChange: () => {},
      onOpenSubagentRun: () => {},
      onOpenChanges: () => {},
      onOpenCommitPush: () => {},
      onCheckout: async () => {},
      onCreated: () => {},
      onOpenGraph: () => {},
      initialAnchorRef: { current: null },
      ...overrides,
    }))
  }

  it('stays mounted for a goal-only session and renders the goal section', () => {
    const html = renderSummary({ goal: goalState, goalSessionId: 'session-1', onGoalAction: async () => {} })
    expect(html).toContain('quickforge-goal-summary')
    expect(html).toContain('收敛 Goal 到置顶摘要')
    expect(html).toContain('执行中')
    expect(html).toContain('quickforge-goal-icon')
    expect(html).not.toContain('lucide-target')
    // No git repo, todo list or subagent run is required for the summary.
    expect(appSource).toContain('|| Boolean(pinnedSummaryGoal)')
    expect(appSource).toContain('goal={pinnedSummaryGoal}')
    expect(appSource).toContain('goalSessionId={pinnedSummaryGoalSessionId}')
    expect(appSource).toContain('onGoalAction={handlePinnedGoalAction}')
  })

  it('collapses to nothing without a goal, git repo, todos or subagent runs', () => {
    expect(renderSummary({ expanded: false })).toBe('')
  })

  it('keeps the goal section above git/tasks/agents and out of their density', () => {
    const goalIndex = summarySource.indexOf('{hasGoalSection && goal && goalSessionId ? (')
    expect(goalIndex).toBeGreaterThan(-1)
    expect(goalIndex).toBeLessThan(summarySource.indexOf('{hasGitSection && status && projectId ? ('))
    expect(summarySource).toContain("<GoalSummarySection goal={goal} sessionId={goalSessionId} onAction={onGoalAction} />")
    // Goal-first capsule with a real status and accepted-criteria count, capped
    // density for the remaining segments.
    expect(summarySource.indexOf("key: 'goal'")).toBeLessThan(summarySource.indexOf("key: 'tasks'"))
    expect(summarySource).toContain("import { GoalIcon } from '@/components/goal-icon'")
    const goalCapsule = summarySource.slice(summarySource.indexOf("key: 'goal'"), summarySource.indexOf('if (todos.length > 0)'))
    expect(goalCapsule).toContain('<GoalIcon className="size-3.5" aria-hidden="true" />')
    expect(summarySource).not.toContain('<Target')
    expect(summarySource).toContain("t('goalCriteriaProgress', { completed: goalPassedCriteria, total: goalView.criteria.length })")
    expect(summarySource).toContain('return goalView ? segments.slice(0, 3) : segments')
    // Terminal goals stay reviewable: the section is never gated on an active status.
    expect(summarySource).not.toContain('isGoalActive')
  })

  it('keeps the two-line summary navigation-only and owns the shared action lock in the Inspector', () => {
    expect(goalSectionSource).toContain("from '@/lib/goal-ui'")
    expect(goalSectionSource).toContain("onClick={() => requestOpenGoalSummary(sessionId, goal.id, 'progress')}")
    expect(goalSectionSource).not.toContain('runGoalUiAction')
    expect(goalSectionSource).not.toContain('onAction(')
    expect(goalSectionSource).not.toContain('<textarea')
    expect(goalSectionSource.match(/<button\b/g)).toHaveLength(1)
    expect(goalSectionSource.match(/<span className="flex min-w-0/g)).toHaveLength(2)
    expect(goalInspectorSource).toContain('runGoalUiAction(sessionId, goal.id, action, () => onAction(action, undefined, options))')
    expect(goalInspectorSource).toContain('runGoalUiAction(sessionId, goal.id, action, () => onAction(action, undefined, { ...options!, signal: controller.signal }))')
    expect(goalUiSource).toContain('export const OPEN_GOAL_SUMMARY_EVENT')
    expect(summarySource).not.toContain('runGoalUiAction')
    // The shell executes updateGoal once; the Inspector/controller own the lock.
    expect(appSource).toContain('await agent.updateGoal(action, objective, options)')
    expect(appSource).not.toContain('runGoalUiAction')
    expect(appSource).toContain("'goal_updated',")
  })

  it('routes goal summary navigation to the existing Inspector without a new global mode', () => {
    expect(appSource).toContain("const pinnedSummaryGoalEnabled = pinnedSummaryGoalSource !== 'acp'")
    const goalOpenListener = appSource.indexOf('window.addEventListener(OPEN_GOAL_SUMMARY_EVENT')
    expect(goalOpenListener).toBeGreaterThan(-1)
    const goalOpenHandler = appSource.slice(appSource.lastIndexOf('const handler = (event: Event) => {', goalOpenListener), goalOpenListener)
    expect(goalOpenHandler).toContain('sessionId !== pinnedSummaryGoalSessionId')
    expect(goalOpenHandler).toContain('pinnedSummaryGoal.id !== goalId')
    expect(goalOpenHandler).toContain("requestWorkspaceInspector({ projectId: workspaceInspectorScope.projectId, kind: 'goal', sessionId, goalId, view: detail.view === 'edit' ? 'edit' : 'progress' })")
    expect(goalOpenHandler).not.toContain('setWorkspaceInspectorOpen(false)')
    expect(goalOpenHandler).not.toContain('setGitToolsExpanded(true)')
    expect(appSource).toContain('goalUnavailable')
    // The inspector is still the only suspended/closed owner: no new mode flag.
    expect(appSource).not.toContain('goalSummaryMode')
  })
})
