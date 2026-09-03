import type { Transform } from '@dnd-kit/utilities'

export type ProjectDragRect = {
  top: number
  bottom: number
}

export function visibleProjectDragBoundary(
  boundaryRect: ProjectDragRect | null | undefined,
  scrollViewportRect: ProjectDragRect | null | undefined,
): ProjectDragRect | undefined {
  if (!boundaryRect || !scrollViewportRect) return undefined
  const top = Math.max(boundaryRect.top, scrollViewportRect.top)
  const bottom = Math.min(boundaryRect.bottom, scrollViewportRect.bottom)
  return top <= bottom ? { top, bottom } : undefined
}

export function clampProjectDragTransform(
  transform: Transform,
  draggingRect: ProjectDragRect | null | undefined,
  viewportRect: ProjectDragRect | null | undefined,
  scrollDeltaY = 0,
): Transform {
  if (!draggingRect || !viewportRect) {
    return { ...transform, x: 0, y: 0 }
  }

  const minY = viewportRect.top - draggingRect.top - scrollDeltaY
  const maxY = viewportRect.bottom - draggingRect.bottom - scrollDeltaY
  if (minY > maxY) return { ...transform, x: 0, y: 0 }

  return {
    ...transform,
    x: 0,
    y: Math.min(maxY, Math.max(minY, transform.y)),
  }
}
