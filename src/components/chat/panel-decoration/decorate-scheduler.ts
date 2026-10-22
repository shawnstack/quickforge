/**
 * Animation-frame scheduler for chat decoration.
 *
 * Streaming frames only need process folding; structural events need the full
 * pass. Coalescing keeps at most one pass per frame (the screen paints once per
 * frame anyway), and a pending full pass always wins over a streaming one.
 */

export type ChatDecorateMode = 'streaming' | 'full'

export type ChatDecorateScheduler = {
  schedule: (mode?: ChatDecorateMode) => void
  cancel: () => void
}

export function createChatDecorateScheduler(
  run: (mode: ChatDecorateMode) => void,
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
): ChatDecorateScheduler {
  let frame: number | undefined
  let pending: ChatDecorateMode | null = null

  const schedule = (mode: ChatDecorateMode = 'full') => {
    if (pending === null || mode === 'full') pending = mode
    if (frame !== undefined) return
    frame = requestFrame(() => {
      frame = undefined
      const next = pending ?? 'full'
      pending = null
      run(next)
    })
  }

  return {
    schedule,
    cancel() {
      if (frame !== undefined) cancelFrame(frame)
      frame = undefined
      pending = null
    },
  }
}
