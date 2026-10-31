/**
 * Decoration scheduling subsystem for `ChatPanelHost`.
 *
 * Owns everything that decides *when* a decoration pass runs: the rAF
 * scheduler, the single-flight guard, the MutationObserver over the message
 * area, the streaming fast path, the process-handoff double pass, and the
 * observer-suppression window that keeps decoration's own DOM writes from
 * feeding back into the observer.
 *
 * It is a plain setup function (no React hooks): the host calls it once per
 * main effect and disposes it from the effect cleanup, so the host's effect
 * count and ordering stay unchanged.
 */

import { logger } from '@/lib/logger'
import { recordFirstDecorateTiming } from '@/lib/session-open-timing'
import { isInsideHiddenView } from '@/lib/session-view-activity'
import { createChatDecorateScheduler, type ChatDecorateMode } from '../panel-decoration/decorate-scheduler'

export type DecoratePipelineDeps = {
  panel: HTMLElement
  host: HTMLElement
  sessionId: string
  /** Full decoration body (messages, editor, approvals, scroll). */
  decorate: () => void
  /** Streaming fast path: process folding + scroll-button threshold. */
  decorateStreaming: () => void
  decorateFnRef: { current: (() => void) | null }
  decorateInFlightRef: { current: boolean }
  isDisposed: () => boolean
  syncProcessStreamingState: () => void
  isScrollFollowing: () => boolean
  scheduleScrollToBottom: () => void
}

export type DecoratePipeline = {
  schedule: (mode?: ChatDecorateMode) => void
  runDecorate: () => void
  /** A new run started / a new assistant message began: void the pending handoff generation. */
  resetProcessHandoff: () => void
  scheduleToolInterfaceUpdate: (mode?: ChatDecorateMode) => void
  /** Two-frame re-fold around the end of an assistant message. */
  scheduleProcessHandoff: () => void
  /** Called from panel initialization, once the surface should be observed. */
  startObserver: () => MutationObserver
  cleanup: () => void
}

export function setupDecoratePipeline(deps: DecoratePipelineDeps): DecoratePipeline {
  const { panel, host } = deps
  let suppressObserverMutations = false
  let clearSuppressObserverFrame: number | undefined
  let toolUpdateScheduled = false
  let processHandoffGeneration = 0

  const clearObserverSuppression = () => {
    if (clearSuppressObserverFrame !== undefined) return
    clearSuppressObserverFrame = window.requestAnimationFrame(() => {
      clearSuppressObserverFrame = undefined
      suppressObserverMutations = false
    })
  }

  const runDecorate = () => {
    if (deps.isDisposed()) return
    // A kept (hidden) view must not decorate: its layout box is `display:none`,
    // so every `getBoundingClientRect`/`offsetHeight` it reads is 0 and the
    // results it would write back (compact class, fold state, scroll position)
    // are meaningless. It also has no user to serve. Decoration resumes from
    // the activity subscription in the host when the view becomes visible again.
    // Judged from the DOM rather than the activity signal: the signal is
    // published in a layout effect, so on the commit that reveals this view the
    // signal may still name the previous one and the first (authoritative) pass
    // would be skipped.
    if (isInsideHiddenView(host)) return
    // Single-flight: `decorate` moves nodes around, so a nested pass must not
    // interleave with the one that owns the DOM (same guard as SubagentTrace).
    if (deps.decorateInFlightRef.current) return
    deps.decorateInFlightRef.current = true
    suppressObserverMutations = true
    const decorateStartedAt = performance.now()
    try {
      deps.decorate()
    } finally {
      clearObserverSuppression()
      deps.decorateInFlightRef.current = false
      // 第一轮装饰在 ready 之后才跑（它在 `scheduleAfterPaint` 之后由 rAF 触发），
      // 但它决定按钮/折叠何时可用，属于用户感知成本，单独记一次。
      recordFirstDecorateTiming(deps.sessionId, performance.now() - decorateStartedAt)
    }
  }

  // A pure `message_update` cannot change committed rows, actions, artifact
  // cards or composer bindings; only process folding (and its streaming
  // hints) must be reconciled before the next paint. Full passes still run on
  // every structural event and DOM mutation.
  const runStreamingDecorate = () => {
    if (deps.isDisposed()) return
    if (isInsideHiddenView(host)) return
    if (deps.decorateInFlightRef.current) return
    deps.decorateInFlightRef.current = true
    suppressObserverMutations = true
    try {
      deps.decorateStreaming()
    } catch (error) {
      logger.warn('Failed to decorate streaming chat messages:', error)
    } finally {
      clearObserverSuppression()
      deps.decorateInFlightRef.current = false
    }
  }

  const decorateScheduler = createChatDecorateScheduler(
    (mode) => {
      if (mode === 'streaming') runStreamingDecorate()
      else runDecorate()
    },
    (callback) => window.requestAnimationFrame(callback),
    (handle) => window.cancelAnimationFrame(handle),
  )
  const scheduleDecorate = decorateScheduler.schedule
  // Expose for the decoration trigger effect
  deps.decorateFnRef.current = runDecorate

  const scheduleToolInterfaceUpdate = (mode: ChatDecorateMode = 'full') => {
    if (toolUpdateScheduled) return
    toolUpdateScheduled = true
    window.requestAnimationFrame(() => {
      toolUpdateScheduled = false
      if (deps.isDisposed()) return
      deps.syncProcessStreamingState()
      // The React surface re-renders from agent snapshots on its own; the
      // rAF gives that commit time to land before decoration re-aligns.
      //
      // 走同一个 scheduler，而不是在这里直接 `runDecorate()`：旧实现先同步跑
      // 一遍 full pass，调用方再 `scheduleDecorate()` 排一遍，同一次工具事件
      // 在一帧里做了两遍完整装饰（querySelectorAll + 折叠对账 + 强制布局）。
      scheduleDecorate(mode)
      if (deps.isScrollFollowing()) deps.scheduleScrollToBottom()
    })
  }

  const resetProcessHandoff = () => {
    processHandoffGeneration += 1
    delete panel.dataset.quickforgeProcessHandoff
  }

  const scheduleProcessHandoff = () => {
    const generation = ++processHandoffGeneration
    panel.dataset.quickforgeProcessHandoff = String(generation)
    scheduleDecorate()
    window.requestAnimationFrame(() => {
      if (!deps.isDisposed() && processHandoffGeneration === generation) scheduleDecorate()
    })
    const finishProcessHandoff = () => {
      if (deps.isDisposed() || processHandoffGeneration !== generation) return
      delete panel.dataset.quickforgeProcessHandoff
      scheduleDecorate()
      window.requestAnimationFrame(() => {
        if (!deps.isDisposed() && processHandoffGeneration === generation) scheduleDecorate()
      })
    }
    window.requestAnimationFrame(finishProcessHandoff)
  }

  // Observe DOM changes for re-decoration — scoped to the MESSAGE AREA, not
  // the whole panel.
  //
  // A panel-wide `{childList, subtree}` observer treats every composer-side
  // node change as a reason to re-run the full decoration pass: the
  // suggestion menu rebuilding its rows (`innerHTML = ''` + re-create), a
  // slash chip mounting, an attachment tile appearing. That coupling is what
  // made typing feed the O(messages) decorate pass
  // (`readMessageRows` + `decorateMessages` + `artifactsInputKey` walk the
  // whole conversation). The composer is React-owned now
  // (`composer-store.ts` + the `MessageEditor` leaves), so it publishes its
  // own re-decoration requests through `scheduleDecorate` on the few state
  // flips that matter (capability/plan/attachment gates) instead of relying
  // on node churn.
  //
  // The observer still targets `panel` (the message list may not be mounted
  // yet when this runs) but only schedules a pass when at least one record
  // lands inside the scroll container, so late mounting and message-area
  // replacement keep working without composer churn paying for it.
  const isMessageAreaNode = (node: Node | null): boolean => {
    if (!node) return false
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement
    return Boolean(element?.closest('.qf-scroll-container'))
  }

  const startObserver = () => {
    const observer = new MutationObserver((records) => {
      if (suppressObserverMutations) return
      // `added`/`removed` cover nodes re-parented by process folding (the group
      // itself may be the added node while the original parent is gone).
      const relevant = records.some((record) => isMessageAreaNode(record.target)
        || Array.from(record.addedNodes).some(isMessageAreaNode)
        || Array.from(record.removedNodes).some(isMessageAreaNode))
      if (!relevant) return
      scheduleDecorate()
    })
    observer.observe(panel, { childList: true, subtree: true })
    return observer
  }

  return {
    schedule: scheduleDecorate,
    runDecorate,
    resetProcessHandoff,
    scheduleToolInterfaceUpdate,
    scheduleProcessHandoff,
    startObserver,
    cleanup() {
      decorateScheduler.cancel()
      if (clearSuppressObserverFrame !== undefined) {
        window.cancelAnimationFrame(clearSuppressObserverFrame)
      }
      deps.decorateFnRef.current = null
    },
  }
}
