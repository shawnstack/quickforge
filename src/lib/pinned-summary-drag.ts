export type PinnedSummaryPosition = {
  x: number
  y: number
}

export type PinnedSummarySize = {
  width: number
  height: number
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function clampPinnedSummaryPosition(
  position: PinnedSummaryPosition,
  size: PinnedSummarySize,
  viewport: PinnedSummarySize,
  margin = 12,
): PinnedSummaryPosition {
  const safeMargin = Math.max(0, finiteOr(margin, 12))
  const width = Math.max(0, finiteOr(size.width, 0))
  const height = Math.max(0, finiteOr(size.height, 0))
  const viewportWidth = Math.max(0, finiteOr(viewport.width, 0))
  const viewportHeight = Math.max(0, finiteOr(viewport.height, 0))
  const maxX = Math.max(safeMargin, viewportWidth - width - safeMargin)
  const maxY = Math.max(safeMargin, viewportHeight - height - safeMargin)
  const x = finiteOr(position.x, safeMargin)
  const y = finiteOr(position.y, safeMargin)

  return {
    x: Math.min(Math.max(safeMargin, x), maxX),
    y: Math.min(Math.max(safeMargin, y), maxY),
  }
}

export type PinnedSummaryOutsideAction = 'stay' | 'minimize' | 'close'

export type PinnedSummarySuspensionInput = {
  inspectorOpen: boolean
  desktopInspectorViewport: boolean
  mobileShell: boolean
}

export function shouldSuspendPinnedSummary({
  inspectorOpen,
  desktopInspectorViewport,
  mobileShell,
}: PinnedSummarySuspensionInput) {
  return inspectorOpen && desktopInspectorViewport && !mobileShell
}

export function shouldClosePinnedSummaryBeforeInspectorOpen(canSuspendPinnedSummaryOnInspectorOpen: boolean) {
  return !canSuspendPinnedSummaryOnInspectorOpen
}

export function getPinnedSummaryOutsideAction(
  desktopDraggable: boolean,
  mode: 'panel' | 'capsule' | 'closed',
): PinnedSummaryOutsideAction {
  if (mode === 'closed') return 'stay'
  if (!desktopDraggable) return 'close'
  return mode === 'panel' ? 'minimize' : 'stay'
}

export function hasPinnedSummaryDragThreshold(
  start: PinnedSummaryPosition,
  current: PinnedSummaryPosition,
  threshold = 4,
) {
  const safeThreshold = Math.max(0, finiteOr(threshold, 4))
  const startX = finiteOr(start.x, 0)
  const startY = finiteOr(start.y, 0)
  const currentX = finiteOr(current.x, startX)
  const currentY = finiteOr(current.y, startY)
  return Math.hypot(currentX - startX, currentY - startY) >= safeThreshold
}
