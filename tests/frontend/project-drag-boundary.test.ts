import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { clampProjectDragTransform } from '../../src/lib/project-drag-boundary'

const draggingRect = { top: 120, bottom: 160 }
const viewportRect = { top: 100, bottom: 300 }

describe('clampProjectDragTransform', () => {
  it('locks horizontal movement while preserving an internal vertical transform', () => {
    expect(clampProjectDragTransform(
      { x: 48, y: 60, scaleX: 1, scaleY: 1 },
      draggingRect,
      viewportRect,
    )).toEqual({ x: 0, y: 60, scaleX: 1, scaleY: 1 })
  })

  it('clamps the dragged preview to the top of the Projects viewport', () => {
    expect(clampProjectDragTransform(
      { x: -24, y: -80, scaleX: 1, scaleY: 1 },
      draggingRect,
      viewportRect,
    ).y).toBe(-20)
  })

  it('clamps the dragged preview to the bottom of the Projects viewport', () => {
    expect(clampProjectDragTransform(
      { x: 12, y: 200, scaleX: 1, scaleY: 1 },
      draggingRect,
      viewportRect,
    ).y).toBe(140)
  })

  it('accounts for container scrolling that dnd-kit applies after modifiers', () => {
    expect(clampProjectDragTransform(
      { x: 0, y: 120, scaleX: 1, scaleY: 1 },
      draggingRect,
      viewportRect,
      40,
    ).y).toBe(100)
  })

  it('safely falls back to horizontal locking when a rectangle is missing', () => {
    const transform = { x: 32, y: 75, scaleX: 0.9, scaleY: 1.1 }

    expect(clampProjectDragTransform(transform, null, viewportRect)).toEqual({
      x: 0,
      y: 75,
      scaleX: 0.9,
      scaleY: 1.1,
    })
    expect(clampProjectDragTransform(transform, draggingRect, null)).toEqual({
      x: 0,
      y: 75,
      scaleX: 0.9,
      scaleY: 1.1,
    })
  })
})

describe('ChatSidebar project drag wiring', () => {
  const source = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

  it('uses the Projects viewport for both the modifier boundary and auto-scroll allowlist', () => {
    expect(source).toContain('ref={projectsScrollViewportRef}')
    expect(source).toContain('projectDragStartScrollTopRef.current = projectsScrollViewportRef.current?.scrollTop ?? 0')
    expect(source).toContain('(viewport?.scrollTop ?? 0) - projectDragStartScrollTopRef.current')
    expect(source).toContain('autoScroll={{ canScroll: canAutoScrollProjectsViewport }}')
    expect(source).toContain('element === projectsScrollViewportRef.current')
  })

  it('preserves the existing sorting and measuring contracts', () => {
    expect(source).toContain('collisionDetection={closestCenter}')
    expect(source).toContain('strategy={verticalListSortingStrategy}')
    expect(source).toContain('strategy: MeasuringStrategy.Always')
    expect(source).toContain("const expanded = !isProjectDragging && expandedProjectIds.has(item.id)")
    expect(source).toContain('onReorderProjects(reordered)')
  })
})
