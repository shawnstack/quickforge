type RequestFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (frameId: number) => void

/**
 * Run work after the browser has had one full paint opportunity.
 *
 * A callback queued in the first animation frame still runs before that frame
 * is painted. Queueing it from a second frame lets the first frame reach the
 * screen before potentially expensive work starts.
 */
export function scheduleAfterPaint(
  callback: () => void,
  requestFrame: RequestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame: CancelFrame = window.cancelAnimationFrame.bind(window),
): () => void {
  let cancelled = false
  let frameId = requestFrame(() => {
    if (cancelled) return
    frameId = requestFrame(() => {
      if (!cancelled) callback()
    })
  })

  return () => {
    cancelled = true
    cancelFrame(frameId)
  }
}
