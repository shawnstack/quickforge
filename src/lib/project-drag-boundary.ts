import type { Transform } from '@dnd-kit/utilities'

export type ProjectDragRect = {
  top: number
  bottom: number
}

export function clampProjectDragTransform(
  transform: Transform,
  draggingRect: ProjectDragRect | null | undefined,
  viewportRect: ProjectDragRect | null | undefined,
  scrollDeltaY = 0,
): Transform {
  if (!draggingRect || !viewportRect) {
    return { ...transform, x: 0 }
  }

  const minY = viewportRect.top - draggingRect.top - scrollDeltaY
  const maxY = viewportRect.bottom - draggingRect.bottom - scrollDeltaY

  return {
    ...transform,
    x: 0,
    y: Math.min(maxY, Math.max(minY, transform.y)),
  }
}
