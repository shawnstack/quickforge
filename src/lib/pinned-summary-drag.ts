export type PinnedSummaryPosition = {
  x: number
  y: number
}

export type PinnedSummarySize = {
  width: number
  height: number
}

export type PinnedSummaryAnchorRect = {
  bottom: number
  right: number
}

export type ResolvePinnedSummaryInitialPositionInput = {
  anchorRect?: PinnedSummaryAnchorRect
  fallbackRect: PinnedSummaryPosition & { right: number }
  targetSize: PinnedSummarySize
}

export type PinnedSummaryLayoutMode = 'panel' | 'capsule'

export type PinnedSummaryLayout = {
  position: PinnedSummaryPosition
  panelMaxHeight: number
}

export const PINNED_SUMMARY_INITIAL_GAP = 10
export const PINNED_SUMMARY_INITIAL_RIGHT_INSET = 12
export const PINNED_SUMMARY_VIEWPORT_INSET = 12
// 40px drag header + enough room for one compact section/row and its bottom padding.
export const PINNED_SUMMARY_PANEL_MIN_HEIGHT = 180

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

export function resolvePinnedSummaryInitialPosition({
  anchorRect,
  fallbackRect,
  targetSize,
}: ResolvePinnedSummaryInitialPositionInput): PinnedSummaryPosition {
  if (!anchorRect) {
    return {
      x: finiteOr(fallbackRect.right, 0) - Math.max(0, finiteOr(targetSize.width, 0)),
      y: finiteOr(fallbackRect.y, 0),
    }
  }

  return {
    x: finiteOr(anchorRect.right, fallbackRect.right) - Math.max(0, finiteOr(targetSize.width, 0)) - PINNED_SUMMARY_INITIAL_RIGHT_INSET,
    y: Math.ceil(finiteOr(anchorRect.bottom, fallbackRect.y)) + PINNED_SUMMARY_INITIAL_GAP,
  }
}

export function clampPinnedSummaryPosition(
  position: PinnedSummaryPosition,
  size: PinnedSummarySize,
  viewport: PinnedSummarySize,
  margin = PINNED_SUMMARY_VIEWPORT_INSET,
): PinnedSummaryPosition {
  const safeMargin = Math.max(0, finiteOr(margin, PINNED_SUMMARY_VIEWPORT_INSET))
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

export function resolvePinnedSummaryLayout(
  position: PinnedSummaryPosition,
  targetSize: PinnedSummarySize,
  viewport: PinnedSummarySize,
  mode: PinnedSummaryLayoutMode,
  inset = PINNED_SUMMARY_VIEWPORT_INSET,
): PinnedSummaryLayout {
  const safeInset = Math.max(0, finiteOr(inset, PINNED_SUMMARY_VIEWPORT_INSET))
  const width = Math.max(0, finiteOr(targetSize.width, 0))
  const height = Math.max(0, finiteOr(targetSize.height, 0))
  const viewportWidth = Math.max(0, finiteOr(viewport.width, 0))
  const viewportHeight = Math.max(0, finiteOr(viewport.height, 0))
  const verticalInset = Math.min(safeInset, viewportHeight / 2)
  const topBoundary = verticalInset
  const bottomBoundary = Math.max(topBoundary, viewportHeight - verticalInset)
  const maxX = Math.max(safeInset, viewportWidth - width - safeInset)
  const x = Math.min(Math.max(safeInset, finiteOr(position.x, safeInset)), maxX)
  const requestedY = Math.min(Math.max(topBoundary, finiteOr(position.y, topBoundary)), bottomBoundary)

  let y: number
  if (mode === 'panel') {
    const viewportPanelHeight = Math.max(0, bottomBoundary - topBoundary)
    const minimumPanelHeight = Math.min(PINNED_SUMMARY_PANEL_MIN_HEIGHT, viewportPanelHeight)
    const availableBelow = Math.max(0, bottomBoundary - requestedY)
    y = availableBelow < minimumPanelHeight
      ? Math.max(topBoundary, bottomBoundary - minimumPanelHeight)
      : requestedY
  } else {
    const maxY = Math.max(topBoundary, bottomBoundary - height)
    y = Math.min(requestedY, maxY)
  }

  return {
    position: { x, y },
    panelMaxHeight: Math.max(0, bottomBoundary - y),
  }
}

export type PinnedSummaryOutsideAction = 'stay' | 'close'

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

export function getPinnedSummaryOutsideAction(desktopDraggable: boolean): PinnedSummaryOutsideAction {
  return desktopDraggable ? 'stay' : 'close'
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
