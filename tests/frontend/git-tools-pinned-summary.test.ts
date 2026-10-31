import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, beforeAll } from 'vitest'


import { GitToolsPinnedSummary } from '../../src/components/git/GitToolsPinnedSummary'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import type { GoalState } from '../../src/lib/goal'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'
import { appCss } from '../helpers/app-css'

const summarySource = readFileSync(new URL('../../src/components/git/GitToolsPinnedSummary.tsx', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../../src/components/git/usePinnedSummaryLayout.ts', import.meta.url), 'utf8')
const sectionsSource = readFileSync(new URL('../../src/components/git/PinnedSummarySections.tsx', import.meta.url), 'utf8')
const widgetSource = readFileSync(new URL('../../src/components/git/PinnedSummaryDesktopWidget.tsx', import.meta.url), 'utf8')
const capsuleSource = readFileSync(new URL('../../src/components/git/usePinnedSummaryCapsule.tsx', import.meta.url), 'utf8')
const goalSectionSource = readFileSync(new URL('../../src/components/git/GoalSummarySection.tsx', import.meta.url), 'utf8')
const goalUiSource = readFileSync(new URL('../../src/lib/goal-ui.ts', import.meta.url), 'utf8')
const goalInspectorSource = readFileSync(new URL('../../src/components/workspace/GoalInspectorContent.tsx', import.meta.url), 'utf8')
const dragSource = readFileSync(new URL('../../src/lib/pinned-summary-drag.ts', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const pinnedSummaryModelSource = readFileSync(new URL('../../src/hooks/usePinnedSummaryModel.ts', import.meta.url), 'utf8')
const pinnedSummaryEventsSource = readFileSync(new URL('../../src/lib/pinned-summary-events.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const cssSource = appCss

// `summarySource` is the orchestrator (props, toolbar root, mobile panel). The
// layout state machine, floating widget, summary sections and capsule segments
// live in sibling modules; `allSummarySources` is their union for the
// cross-module absence/count assertions that used to target one file.
const allSummarySources = [summarySource, layoutSource, sectionsSource, widgetSource, capsuleSource].join('\n')

function desktopWidgetBlock() {
  return widgetSource
}

describe('GitToolsPinnedSummary source contract', () => {
  beforeAll(() => {
    // Pin the rendered language to zh: the i18n default follows
    // navigator.language, which is zh on a local Chinese Windows machine but
    // en on CI runners, so untranslated assertions must not depend on the
    // host locale.
    applyAppLanguageFromSnapshot('zh')
  })

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
    expect(widgetSource).toContain("className={cn('quickforge-pinned-summary-widget fixed z-40', suspended && 'hidden')}")
    expect(allSummarySources.match(/hidden=\{suspended\}/g)).toHaveLength(2)
    expect(allSummarySources.match(/aria-hidden=\{suspended \|\| undefined\}/g)).toHaveLength(2)
    expect(allSummarySources.match(/inert=\{suspended \? true : undefined\}/g)).toHaveLength(2)
    expect(allSummarySources).not.toContain("suspended && 'opacity-0'")
  })

  it('pauses temporary interactions without cancelling an explicit close timer or normalizing mounted state', () => {
    const suspensionEffect = layoutSource.slice(
      layoutSource.indexOf('if (!suspended) return'),
      layoutSource.indexOf("if (typeof window.matchMedia !== 'function')", layoutSource.indexOf('if (!suspended) return')),
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
    expect(allSummarySources).not.toContain('normalizePinnedSummaryMountedForSuspension')
    expect(allSummarySources).not.toContain('suspensionCleanupFrameRef')
    const unmountCleanup = layoutSource.slice(
      layoutSource.indexOf('useEffect(() => () => {'),
      layoutSource.indexOf('\n  return {\n    rootRef', layoutSource.indexOf('useEffect(() => () => {')),
    )
    expect(unmountCleanup).toContain('clearCloseAnimationTimer()')
    expect(layoutSource).toContain('if (desktopDraggable || !floatingSummaryVisible || suspended) return')
    expect(layoutSource).toContain('if (!desktopDraggable || suspended) return\n    window.addEventListener(\'resize\', clampCurrentPosition)')
    expect(layoutSource).toContain('if (!desktopDraggable || !desktopWidgetMounted || suspended) return undefined')
    expect(layoutSource).toContain('if (!desktopDraggable || !desktopWidgetMounted || suspended) return')
  })

  it('cancels pending focus work while suspended and never focuses a hidden summary node', () => {
    expect(layoutSource).toContain('const focusFrameRef = useRef<number | null>(null)')
    expect(layoutSource).toContain('window.cancelAnimationFrame(focusFrameRef.current)')
    expect(layoutSource).toContain('if (suspended) return\n      target()?.focus()')
    expect(layoutSource).toContain('scheduleSummaryFocus(() => desktopPanelMinimizeRef.current)')
    expect(layoutSource).toContain('scheduleSummaryFocus(() => capsuleMainRef.current)')
    expect(layoutSource).toContain('scheduleSummaryFocus(() => topTriggerRef.current)')
    expect(allSummarySources).not.toContain('window.requestAnimationFrame(() => desktopPanelMinimizeRef.current?.focus())')
    expect(allSummarySources).not.toContain('window.requestAnimationFrame(() => capsuleMainRef.current?.focus())')
    expect(allSummarySources).not.toContain('window.requestAnimationFrame(() => topTriggerRef.current?.focus())')
  })

  it('marks the PanelRight toggle for compatibility without requiring desktop outside-dismiss exceptions', () => {
    expect(appSource).toContain('data-pinned-summary-inspector-toggle="true"')
    expect(allSummarySources).not.toContain("target?.closest('[data-pinned-summary-inspector-toggle=\"true\"]')")
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
    expect(closeBranch).toContain('setWorkspaceInspectorOpenScopeId(null)')
    expect(closeBranch).not.toContain('setGitToolsExpanded(false)')
    expect(openBranch).toContain('if (shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen)) {')
    expect(openBranch).toContain('setGitToolsExpanded(false)')
    expect(openBranch.indexOf('setGitToolsExpanded(false)')).toBeLessThan(openBranch.indexOf('setWorkspaceInspectorOpenScopeId(workspaceInspectorRuntimeScopeId)'))
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
    const resumeEffect = layoutSource.slice(
      layoutSource.indexOf('const wasSuspended = wasSuspendedRef.current'),
      layoutSource.indexOf('useEffect(() => {', layoutSource.indexOf('const wasSuspended = wasSuspendedRef.current')),
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
    expect(layoutSource).toContain("const desktopMode: DesktopMode = expanded ? 'panel' : capsuleVisible ? 'capsule' : 'closed'")
    expect(layoutSource).toContain('if (floatingSummaryVisible) closeSummary()')
    expect(layoutSource).toContain('else if (desktopDraggable) openDesktopPanel()')
  })

  it('implements desktop closed, capsule, and panel transitions with compatible expanded semantics', () => {
    const open = layoutSource.slice(layoutSource.indexOf('const openDesktopPanel'), layoutSource.indexOf('const minimizeDesktopPanel'))
    const minimize = layoutSource.slice(layoutSource.indexOf('const minimizeDesktopPanel'), layoutSource.indexOf('const closeSummary'))
    const close = layoutSource.slice(layoutSource.indexOf('const closeSummary'), layoutSource.indexOf('const toggleSummaryFromToolbar'))
    expect(open).toContain('setCapsuleVisible(false)')
    expect(open).toContain('onExpandedChange(true)')
    expect(minimize).toContain('setCapsuleVisible(true)')
    expect(minimize).toContain('onExpandedChange(false)')
    expect(close).toContain('setCapsuleVisible(false)')
    expect(close).toContain('onExpandedChange(false)')
    expect(close).toContain('setDesktopWidgetClosing(true)')
    expect(close).toContain('}, 160)')
    expect(layoutSource).toContain('const previousExpandedRef = useRef(expanded)')
    expect(layoutSource).toContain('if (previousExpanded && !capsuleVisible && desktopWidgetMounted && !desktopWidgetClosing)')
  })

  it('keeps one mounted desktop widget and crossfades panel/capsule with measured dimensions', () => {
    const widget = desktopWidgetBlock()
    const applyResolvedLayoutBlock = layoutSource.slice(
      layoutSource.indexOf('const applyResolvedLayout'),
      layoutSource.indexOf('const getPanelNaturalHeight'),
    )
    expect(widget).toContain('data-mode={desktopMode === \'closed\' ? \'capsule\' : desktopMode}')
    expect(widget).toContain('data-closing={desktopWidgetClosing ? \'true\' : \'false\'}')
    expect(widget).toContain('data-dragging={dragging ? \'true\' : \'false\'}')
    expect(widget).toContain('quickforge-pinned-summary-capsule')
    expect(widget).toContain('quickforge-pinned-summary-panel')
    expect(layoutSource).toContain('new ResizeObserver(measure)')
    expect(layoutSource).toContain("const layoutPosition = dragRef.current?.current ?? positionRef.current")
    expect(layoutSource).toContain("if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)")
    expect(applyResolvedLayoutBlock).not.toContain('updatePosition(layout.position)\n    setPanelMaxHeight')
    expect(layoutSource).toContain("'--quickforge-pinned-summary-panel-height'")
    expect(layoutSource).toContain('const borderBoxDelta = Math.max(0, panel.offsetHeight - panel.clientHeight)')
    expect(layoutSource).toContain('const headerHeight = desktopPanelHeaderRef.current?.offsetHeight ?? 0')
    expect(layoutSource).toContain('return headerHeight + content.scrollHeight + borderBoxDelta')
    expect(widget).toContain('ref={desktopPanelContentRef}')
    expect(layoutSource).toContain("'--quickforge-pinned-summary-capsule-width'")
    expect(layoutSource).toContain("'--quickforge-pinned-summary-panel-max-height': desktopMode !== 'panel' || panelMaxHeight === undefined")
    expect(widget).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4')
    expect(allSummarySources).not.toContain("branchMenuOpen ? 'overflow-visible'")
    expect(allSummarySources).not.toContain("branchMenuSide === 'left'")
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
    expect(capsuleMain).not.toContain('group-hover:bg-muted/40')
    expect(capsuleMain).not.toContain('group-focus-visible:bg-muted/40')
    expect(capsuleMain).toContain('aria-hidden="true"')
    expect(capsuleMain).toContain('<Maximize2 className="size-3.5" />')
    expect(capsuleMain.match(/<button/g)).toHaveLength(1)
    expect(widget).toContain('className="quickforge-pinned-summary-capsule-close')
    expect(widget).toContain('event.stopPropagation()')
    expect(widget).toContain("closeSummary({ focusTrigger: true })")
    expect(widget).toContain('<X className="size-4"')
    expect(widget).toContain('size-8 shrink-0')
    expect(allSummarySources).not.toContain('ChevronUp')
  })

  it('uses three semantic capsule categories with icons and one combined agent segment', () => {
    expect(capsuleSource).toContain("key: 'tasks'")
    expect(capsuleSource).toContain('<ListTodo className="size-3.5"')
    expect(capsuleSource).toContain("key: 'git'")
    expect(capsuleSource).toContain('<FileDiff className="size-3.5"')
    expect(capsuleSource).toContain("key: 'agents'")
    expect(capsuleSource).toContain('<Bot className="size-3.5"')
    expect(capsuleSource).toContain('<span>{agentRunningCount}/{agentFinishedCount}</span>')
    expect(allSummarySources).not.toContain('pinnedSummaryCapsuleRunningAria')
    expect(allSummarySources).not.toContain('pinnedSummaryCapsuleFinishedAria')
    expect(capsuleSource).toContain("key: 'fallback'")
  })

  it('renders dividers only between actual segments without dead opacity classes', () => {
    expect(widgetSource).toContain('capsuleSegments.map((segment, index) => (')
    expect(widgetSource).toContain('index > 0 ? <span className="h-3.5 w-px shrink-0"')
    expect(allSummarySources).not.toContain('bg-foreground/15')
    expect(allSummarySources).not.toContain('border-border/60')
  })

  it('does not install or handle summary-level outside/Escape dismissal on desktop', () => {
    const dismissEffect = layoutSource.slice(
      layoutSource.indexOf('if (desktopDraggable || !floatingSummaryVisible || suspended) return'),
      layoutSource.indexOf('useEffect(() => () => {'),
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
    expect(sectionsSource.match(/top-\[9\.25rem\]/g)).toHaveLength(3)
    expect(sectionsSource.match(/max-h-\[calc\(100dvh-9\.75rem\)\]/g)).toHaveLength(2)
    expect(allSummarySources).not.toContain('touch-none')
    expect(allSummarySources).not.toContain('touchAction')
  })

  it('opens the branch menu beside the desktop floating panel instead of inside its content flow', () => {
    const widget = desktopWidgetBlock()
    const sections = sectionsSource
    expect(widget).toContain('{branchMenuOpen && desktopDraggable && branchMenuPlacement && projectId ? (')
    expect(widget).toContain("branchMenuPlacement.side === 'left' ? 'right-full mr-1 origin-top-right' : 'left-full ml-1 origin-top-left'")
    expect(widget).toContain('style={{ top: branchMenuPlacement.top, maxHeight: branchMenuPlacement.maxHeight }}')
    expect(sections).toContain('{!desktopDraggable && branchMenuOpen ? (')
    expect(sections).toContain('top-[9.25rem]')
    expect(sections).not.toContain('md:top-full')
    expect(allSummarySources).not.toContain('md:top-full')
    expect(allSummarySources).not.toContain('md:w-full md:overflow-y-auto')
    expect(layoutSource).toContain('const rowRect = row.getBoundingClientRect()')
    expect(layoutSource).toContain('const widgetRect = widget.getBoundingClientRect()')
    expect(layoutSource).toContain('Math.round(rowRect.top - widgetRect.top)')
    expect(layoutSource).toContain('PINNED_BRANCH_MENU_WIDTH')
    expect(layoutSource).toContain('PINNED_BRANCH_MENU_MAX_HEIGHT')
    expect(layoutSource).toContain('useEffect(() => {\n    queueMicrotask(() => setBranchMenuOpen(false))\n  }, [desktopDraggable])')
  })

  it('tracks the active pointer on window until move/up/cancel and captures only after a real drag', () => {
    expect(layoutSource).toContain('hasPinnedSummaryDragThreshold(drag.start, currentPointer)')
    expect(layoutSource).toContain('pointerTarget: event.currentTarget')
    expect(layoutSource).toContain('drag.captureTarget = drag.pointerTarget')
    expect(layoutSource).toContain('drag.pointerTarget.setPointerCapture(event.pointerId)')
    expect(layoutSource.indexOf('drag.captureTarget = drag.pointerTarget')).toBeGreaterThan(layoutSource.indexOf('hasPinnedSummaryDragThreshold(drag.start, currentPointer)'))
    expect(layoutSource).toContain("window.addEventListener('pointermove', handlePointerMove)")
    expect(layoutSource).toContain("window.addEventListener('pointerup', handlePointerEnd)")
    expect(layoutSource).toContain("window.addEventListener('pointercancel', handlePointerEnd)")
    expect(layoutSource).toContain("window.removeEventListener('pointermove', handlePointerMove)")
    expect(layoutSource).toContain("window.removeEventListener('pointerup', handlePointerEnd)")
    expect(layoutSource).toContain("window.removeEventListener('pointercancel', handlePointerEnd)")
    expect(layoutSource).toContain('dragTrackingCleanupRef.current?.()')
    expect(layoutSource).toContain('suppressClickRef.current = true')
    expect(allSummarySources).toContain('if (suppressClickRef.current) return')
    expect(layoutSource).toContain("document.body.style.userSelect = 'none'")
    expect(layoutSource).toContain('window.requestAnimationFrame(() => {')
    expect(layoutSource).toContain("window.addEventListener('resize', clampCurrentPosition)")
    expect(layoutSource).toContain('drag.captureTarget.releasePointerCapture(drag.pointerId)')
    expect(allSummarySources).not.toContain('captureTarget: event.currentTarget')
    expect(dragSource).toContain('Math.hypot(currentX - startX, currentY - startY) >= safeThreshold')
  })

  it('clears desktop-only widget state on mobile downgrade without closing an expanded mobile panel', () => {
    const responsiveEffect = layoutSource.slice(
      layoutSource.indexOf('const previousExpanded = previousExpandedRef.current'),
      layoutSource.indexOf('useLayoutEffect(() =>', layoutSource.indexOf('const previousExpanded = previousExpandedRef.current')),
    )
    expect(responsiveEffect).toContain('if (!desktopDraggable)')
    expect(responsiveEffect).toContain('setPosition(undefined)')
    expect(responsiveEffect).toContain('setCapsuleVisible(false)')
    expect(responsiveEffect).toContain('setDesktopWidgetMounted(false)')
    expect(responsiveEffect).toContain('setDesktopWidgetClosing(false)')
    expect(responsiveEffect).not.toContain('onExpandedChange(false)')
  })

  it('clamps shape changes against transform-independent target layout dimensions', () => {
    expect(layoutSource).toContain('const width = element.offsetWidth')
    expect(layoutSource).toContain('const height = element.offsetHeight')
    expect(layoutSource).toContain('if (width > 0 && height > 0) return { width, height }')
    expect(layoutSource).toContain('width: width || rect.width')
    expect(layoutSource).toContain('height: height || rect.height')
    expect(layoutSource).toContain("const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current")
    expect(layoutSource.match(/const targetSize = getPinnedSummaryLayoutSize\(target \?\? widget\)/g)).toHaveLength(3)
    expect(layoutSource).toContain('const capsuleSize = getPinnedSummaryLayoutSize(capsule)')
    expect(layoutSource).toContain('const panelSize = getPinnedSummaryLayoutSize(panel)')
    expect(allSummarySources).not.toContain('(target ?? widget).getBoundingClientRect()')
    expect(layoutSource).toContain('const fallbackRect = rootRef.current?.getBoundingClientRect() ?? widgetRect')
    expect(layoutSource).toContain('fallbackRect,')
    expect(layoutSource).toContain('resolvePinnedSummaryInitialPosition({')
    expect(layoutSource).toContain('resolvePinnedSummaryLayout(')
    expect(layoutSource).toContain("if (mode === 'panel') setPanelMaxHeight(layout.panelMaxHeight)")
    expect(layoutSource).toContain('targetSize,')
  })

  it('anchors only the first desktop position below the conversation header and preserves toolbar-root then widget fallback order', () => {
    expect(appSource).toContain('const conversationHeaderRef = useRef<HTMLElement | null>(null)')
    expect(readFileSync(new URL('../../src/components/app/ConversationHeader.tsx', import.meta.url), 'utf8')).toContain('<header ref={headerRef}')
    expect(appSource).toContain('initialAnchorRef={conversationHeaderRef}')
    expect(summarySource).toContain('initialAnchorRef: RefObject<HTMLElement | null>')

    const initialPositionBranch = layoutSource.slice(
      layoutSource.indexOf('if (!positionRef.current) {'),
      layoutSource.indexOf('clampCurrentPosition()', layoutSource.indexOf('if (!positionRef.current) {')),
    )
    expect(initialPositionBranch).toContain('resolvePinnedSummaryInitialPosition({')
    expect(initialPositionBranch).toContain('anchorRect: initialAnchorRef.current?.getBoundingClientRect()')
    expect(initialPositionBranch).toContain('const fallbackRect = rootRef.current?.getBoundingClientRect() ?? widgetRect')
    expect(initialPositionBranch).toContain('fallbackRect,')
    expect(initialPositionBranch).toContain('applyResolvedLayout(initialPosition, targetSize')
    expect(layoutSource.match(/initialAnchorRef\.current\?\.getBoundingClientRect\(\)/g)).toHaveLength(1)
    expect(allSummarySources).not.toContain('querySelector')
    expect(dragSource).toContain('export const PINNED_SUMMARY_INITIAL_GAP = 10')
    expect(dragSource).toContain('export const PINNED_SUMMARY_INITIAL_RIGHT_INSET = 12')
    expect(dragSource).toContain('x: finiteOr(anchorRect.right, fallbackRect.right) - Math.max(0, finiteOr(targetSize.width, 0)) - PINNED_SUMMARY_INITIAL_RIGHT_INSET')
    expect(dragSource).toContain('y: Math.ceil(finiteOr(anchorRect.bottom, fallbackRect.y)) + PINNED_SUMMARY_INITIAL_GAP')
    expect(dragSource).not.toMatch(/\b(?:28|32|56)\b/)
    expect(allSummarySources).not.toContain('localStorage')
  })

  it('never re-reads the conversation header for drag, shape changes, resize, or Inspector resume', () => {
    const initialBranchStart = layoutSource.indexOf('if (!positionRef.current) {')
    const initialBranchEnd = layoutSource.indexOf('clampCurrentPosition()', initialBranchStart)
    const withoutInitialBranch = `${layoutSource.slice(0, initialBranchStart)}${layoutSource.slice(initialBranchEnd)}`
    expect(withoutInitialBranch).not.toContain('initialAnchorRef.current')

    const resumeEffect = layoutSource.slice(
      layoutSource.indexOf('const wasSuspended = wasSuspendedRef.current'),
      layoutSource.indexOf('useEffect(() => {', layoutSource.indexOf('const wasSuspended = wasSuspendedRef.current')),
    )
    expect(resumeEffect).toContain('const current = positionRef.current ??')
    expect(resumeEffect).toContain('applyResolvedLayout(current, targetSize')
    expect(resumeEffect).not.toContain('initialAnchorRef')
    expect(resumeEffect).not.toContain('resolvePinnedSummaryInitialPosition')
  })

  it('keeps current groups, task expansion, and agent folding state inside the component', () => {
    expect(summarySource).toContain('todos.slice(0, 3)')
    expect(sectionsSource).toContain("t('pinnedViewAllTasks'")
    expect(summarySource).toContain('setFinishedSubagentRunsCollapsed((value) => !value)')
    expect(sectionsSource).toContain('aria-expanded={!finishedSubagentRunsCollapsed}')
    // Finished subagent rows are no longer truncated to the first 3 runs.
    expect(allSummarySources).not.toContain('finishedSubagentRuns.slice(0, 3)')
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
      'pinnedGoalTitle',
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
    // The goal renders as a titled group like the git/tasks sections.
    expect(html).toContain('aria-labelledby="pinned-goal-title"')
    expect(html).toContain('id="pinned-goal-title"')
    expect(html).toContain('<span>1/1</span>')
    expect(html).toContain('收敛 Goal 到置顶摘要')
    expect(html).toContain('执行中')
    expect(html).toContain('构建通过')
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
    const goalIndex = sectionsSource.indexOf('{hasGoalSection && goal && goalSessionId ? (')
    expect(goalIndex).toBeGreaterThan(-1)
    expect(goalIndex).toBeLessThan(sectionsSource.indexOf('{hasGitSection && status && projectId ? ('))
    expect(sectionsSource).toContain("<GoalSummarySection goal={goal} sessionId={goalSessionId} onAction={onGoalAction} />")
    // The goal group itself (title + criteria + navigation) is owned by the
    // section component, matching the pinned git/tasks group structure.
    expect(goalSectionSource).toContain('<section aria-labelledby="pinned-goal-title">')
    expect(goalSectionSource).toContain('id="pinned-goal-title"')
    expect(goalSectionSource).toContain("t('pinnedGoalTitle')")
    // Goal-first capsule with a real status and accepted-criteria count, capped
    // density for the remaining segments.
    expect(capsuleSource.indexOf("key: 'goal'")).toBeLessThan(capsuleSource.indexOf("key: 'tasks'"))
    expect(capsuleSource).toContain("import { GoalIcon } from '@/components/goal-icon'")
    const goalCapsule = capsuleSource.slice(capsuleSource.indexOf("key: 'goal'"), capsuleSource.indexOf('if (todos.length > 0)'))
    expect(goalCapsule).toContain('<GoalIcon className="size-3.5" aria-hidden="true" />')
    expect(allSummarySources).not.toContain('<Target')
    expect(capsuleSource).toContain("t('goalCriteriaProgress', { completed: goalPassedCriteria, total: goalView.criteria.length })")
    expect(capsuleSource).toContain('return goalView ? segments.slice(0, 3) : segments')
    // Terminal goals stay reviewable: the section is never gated on an active status.
    expect(allSummarySources).not.toContain('isGoalActive')
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
    expect(allSummarySources).not.toContain('runGoalUiAction')
    // The shell executes updateGoal once; the Inspector/controller own the lock.
    expect(appSource).toContain('await agent.updateGoal(action, objective, options)')
    expect(appSource).not.toContain('runGoalUiAction')
    expect(pinnedSummaryEventsSource).toContain("'goal_updated',")
    expect(pinnedSummaryModelSource).toContain('shouldInvalidatePinnedSummary')
  })

  it('routes goal summary navigation to the existing Inspector without a new global mode', () => {
    expect(pinnedSummaryModelSource).toContain("const goalEnabled = goalSource !== 'acp'")
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

  it('counts every finished subagent run in the expanded summary title and renders them untruncated', () => {
    const finishedRun = (index: number): SubagentRunPayload => ({
      runId: `run-${index}`,
      canonicalToolCallId: `run-${index}`,
      name: 'explore',
      label: 'Explore',
      task: `Investigate module ${index}`,
      context: '',
      expectedOutput: '',
      status: 'done',
      statusLabel: 'Explore completed',
      timing: { durationMs: 1200 + index },
      allowedTools: [],
      traceMessages: [],
      tools: [],
      pendingToolCalls: [],
      input: '',
      details: '',
      output: `Done ${index}`,
      errorMessage: '',
      detailed: false,
      fingerprint: `run-${index}`,
    })
    const html = renderSummary({ finishedSubagentRuns: Array.from({ length: 5 }, (_, index) => finishedRun(index)) })
    // The finished section stays collapsed by default in static markup, but its
    // title counter is the real total instead of a capped 3.
    expect(html).toContain('已结束 · 5')
    expect(html).toContain('智能体')
    // Row rendering is covered by source contract: the visible list is derived
    // from the full finishedSubagentRuns array without truncation.
    expect(summarySource).toContain('const visibleSubagentRuns = finishedSubagentRuns')
    expect(allSummarySources).not.toContain('finishedSubagentRuns.slice(0, 3)')
  })
})
