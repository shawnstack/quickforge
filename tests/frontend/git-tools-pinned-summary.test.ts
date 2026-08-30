import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const summarySource = readFileSync(new URL('../../src/components/git/GitToolsPinnedSummary.tsx', import.meta.url), 'utf8')
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
    expect(appSource).toContain('const pinnedSummarySuspended = useMemo(')
    expect(appSource).toContain('() => shouldSuspendPinnedSummary({')
    expect(appSource).toContain('inspectorOpen: workspaceInspectorOpen')
    expect(appSource).toContain('desktopInspectorViewport')
    expect(appSource).toContain('mobileShell')
    expect(appSource).toContain('!workspaceInspectorOpen\n        || pinnedSummarySuspended')
    expect(appSource).toContain('suspended={pinnedSummarySuspended}')
    expect(appSource).toContain('pinnedSummaryTodos.length > 0')
    expect(appSource).toContain('pinnedSummarySubagentRuns.length > 0')
    expect(appSource).toContain('pinnedSummaryRunningSubagentRuns.length > 0')
    expect(appSource).toContain('titleGitStatus?.isGitRepository')
    expect(summarySource).toContain('suspended?: boolean')
    expect(summarySource).toContain('suspended = false')
    expect(summarySource).toContain('if (todos.length === 0 && runningSubagentRuns.length === 0 && finishedSubagentRuns.length === 0 && !hasGitSection) return null')
  })

  it('hides both toolbar and fixed widget from layout, input, Tab order, and accessibility while suspended', () => {
    expect(summarySource).toContain("className={cn('relative', suspended && 'hidden')}")
    expect(summarySource).toContain("className={cn('quickforge-pinned-summary-widget fixed z-40', suspended && 'hidden')}")
    expect(summarySource.match(/hidden=\{suspended\}/g)).toHaveLength(2)
    expect(summarySource.match(/aria-hidden=\{suspended \|\| undefined\}/g)).toHaveLength(2)
    expect(summarySource.match(/inert=\{suspended \? true : undefined\}/g)).toHaveLength(2)
    expect(summarySource).not.toContain("suspended && 'opacity-0'")
  })

  it('pauses summary side effects without resetting logical mode, position, task expansion, or agent folding', () => {
    const suspensionEffect = summarySource.slice(
      summarySource.indexOf('if (!suspended) return'),
      summarySource.indexOf("if (typeof window.matchMedia !== 'function')", summarySource.indexOf('if (!suspended) return')),
    )
    expect(suspensionEffect).toContain('clearCloseAnimationTimer()')
    expect(suspensionEffect).toContain('clearFocusFrame()')
    expect(suspensionEffect).toContain('finishDrag()')
    expect(suspensionEffect).toContain('window.cancelAnimationFrame(responsiveCleanupFrameRef.current)')
    expect(suspensionEffect).toContain('window.cancelAnimationFrame(dragFrameRef.current)')
    expect(suspensionEffect).toContain('setBranchMenuOpen(false)')
    expect(suspensionEffect).toContain('setDesktopWidgetClosing(false)')
    expect(suspensionEffect).toContain('const frame = window.requestAnimationFrame(() => {')
    expect(suspensionEffect).toContain('suspensionCleanupFrameRef.current = frame')
    expect(suspensionEffect).not.toContain('setPosition(')
    expect(suspensionEffect).not.toContain('setCapsuleVisible(')
    expect(suspensionEffect).not.toContain('setExpandedTasksSignature(')
    expect(suspensionEffect).not.toContain('setFinishedSubagentRunsCollapsed(')
    expect(suspensionEffect).not.toContain('onExpandedChange(')
    expect(summarySource).toContain('if (!floatingSummaryVisible || suspended) return')
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

  it('marks the PanelRight toggle so document pointerdown cannot pre-minimize the summary', () => {
    expect(appSource).toContain('data-pinned-summary-inspector-toggle="true"')
    expect(summarySource).toContain("target?.closest('[data-pinned-summary-inspector-toggle=\"true\"]')")
    expect(summarySource.indexOf("target?.closest('[data-pinned-summary-inspector-toggle=\"true\"]')")).toBeLessThan(summarySource.indexOf('getPinnedSummaryOutsideAction(desktopDraggable, desktopMode)'))
  })

  it('keeps Inspector-opening summary actions reversible while Commit/Push still closes permanently', () => {
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
      appSource.indexOf('onCheckout={handleCheckoutTitleBranch}'),
    )
    expect(subagentCallback).toContain('openSubagentRun(payload)')
    expect(subagentCallback).not.toContain('setGitToolsExpanded(false)')
    expect(changesCallback).toContain('openWorkspaceGitChanges()')
    expect(changesCallback).not.toContain('setGitToolsExpanded(false)')
    expect(commitCallback).toContain('setGitToolsExpanded(false)')
    expect(commitCallback).toContain('setGitCommitDialogOpen(true)')
  })

  it('re-clamps the preserved target mode on suspension exit without opening, minimizing, or focusing', () => {
    const resumeEffect = summarySource.slice(
      summarySource.indexOf('const wasSuspended = wasSuspendedRef.current'),
      summarySource.indexOf('useEffect(() => {', summarySource.indexOf('const wasSuspended = wasSuspendedRef.current')),
    )
    expect(resumeEffect).toContain('if (!wasSuspended || suspended || !desktopDraggable || !desktopWidgetMounted) return')
    expect(resumeEffect).toContain("const target = desktopMode === 'panel' ? desktopPanelRef.current : capsuleRef.current")
    expect(resumeEffect).toContain('clampPinnedSummaryPosition(')
    expect(resumeEffect).toContain('{ width: window.innerWidth, height: window.innerHeight }')
    expect(resumeEffect).toContain('applyWidgetPosition(next)')
    expect(resumeEffect).toContain('updatePosition(next)')
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
    expect(widget).toContain('data-mode={desktopMode === \'closed\' ? \'capsule\' : desktopMode}')
    expect(widget).toContain('data-closing={desktopWidgetClosing ? \'true\' : \'false\'}')
    expect(widget).toContain('data-dragging={dragging ? \'true\' : \'false\'}')
    expect(widget).toContain('quickforge-pinned-summary-capsule')
    expect(widget).toContain('quickforge-pinned-summary-panel')
    expect(summarySource).toContain('new ResizeObserver(measure)')
    expect(summarySource).toContain("'--quickforge-pinned-summary-panel-height'")
    expect(summarySource).toContain("'--quickforge-pinned-summary-capsule-width'")
    expect(cssSource).toContain('width 220ms cubic-bezier(.22,.8,.24,1)')
    expect(cssSource).toContain('height 220ms cubic-bezier(.22,.8,.24,1)')
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
    expect(widget).toContain("onClick={() => closeSummary({ focusTrigger: true })} aria-label={t('pinnedSummaryClose')}")
    expect(widget).toContain('<X className="size-4"')
  })

  it('expands reliably from the capsule body and closes only via the semantic X action', () => {
    const widget = desktopWidgetBlock()
    expect(widget).toContain('className="quickforge-pinned-summary-capsule-main')
    expect(widget).toContain('openDesktopPanel()')
    expect(widget).toContain('className="quickforge-pinned-summary-capsule-close')
    expect(widget).toContain('event.stopPropagation()')
    expect(widget).toContain("closeSummary({ focusTrigger: true })")
    expect(widget).toContain('<X className="size-4"')
    expect(widget).toContain('<ChevronUp className="ml-auto size-3.5')
    expect(widget).toContain('size-8 shrink-0')
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

  it('keeps a desktop capsule resident on outside press and minimizes an open desktop panel to it', () => {
    expect(summarySource).toContain('if (!floatingSummaryVisible || suspended) return')
    expect(summarySource).toContain('if (desktopWidgetRef.current?.contains(event.target as Node)) return')
    expect(summarySource).toContain('const outsideAction = getPinnedSummaryOutsideAction(desktopDraggable, desktopMode)')
    expect(summarySource).toContain("if (outsideAction === 'minimize') minimizeDesktopPanel({ focusCapsule: false })")
    expect(summarySource).toContain("else if (outsideAction === 'close') closeSummary()")
    expect(summarySource).not.toContain("if (outsideAction === 'stay')")
    expect(summarySource).toContain("if (event.key === 'Escape') closeSummary({ focusTrigger: true })")
    expect(summarySource).toContain('scheduleSummaryFocus(() => topTriggerRef.current)')
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
    expect(summarySource).toContain('x: (anchorRect?.right ?? widgetRect.right) - targetSize.width')
    expect(summarySource).toContain('targetSize,')
  })

  it('anchors initial desktop position to the toolbar and does not persist it', () => {
    expect(summarySource).toContain('const anchorRect = rootRef.current?.getBoundingClientRect()')
    expect(summarySource).toContain('x: (anchorRect?.right ?? widgetRect.right) - targetSize.width')
    expect(summarySource).toContain('y: anchorRect?.top ?? widgetRect.top')
    expect(summarySource).toContain('positionRef.current')
    expect(summarySource).not.toContain('localStorage')
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
