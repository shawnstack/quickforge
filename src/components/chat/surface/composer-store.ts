import { useSyncExternalStore } from 'react'

import type { Attachment } from './ChatTypes'

/**
 * Composer hot-path state, kept OUTSIDE React's render tree.
 *
 * Why an external store: the composer text used to live in `ChatSurface`'s
 * top-level `useState`, so every keystroke re-rendered the whole surface. The
 * message list was fenced off with `memo` (`MessageArea`), but everything that
 * neighbours the editor still re-ran per keystroke — `UsageBar`'s
 * `aggregateUsage` (a full `filter`/`reduce` over every assistant message) and
 * `TodoWriteSummary`'s backwards scan being the O(messages) ones. Cost grew
 * with the conversation, which is exactly the "typing gets slower the longer
 * the chat is" report.
 *
 * The split follows the render cost of each slice, and each slice notifies
 * independently so a keystroke cannot wake an attachments subscriber:
 * - `text`        — changes on every keystroke. Subscribed by `ComposerIsland`
 *                   only (textarea value, send-button disabled state).
 * - `attachments` — changes on file add/remove/paste. Same island, still a
 *                   separate listener set so text edits never re-run the tile
 *                   list.
 *
 * Deliberately NOT here: `contextReferences` / `selectedCapabilities`. They are
 * plain data slots owned by the host + decoration layer on the
 * `.qf-message-editor` bridge node and are never read per keystroke, so moving
 * them would add churn without removing any render cost.
 *
 * `useSyncExternalStore` requires stable snapshot identities: `getText` returns
 * a primitive and `getAttachments` returns the array reference that was last
 * *set* (never a copy), so React can compare both with `Object.is`.
 */
export type ComposerStore = {
  getText(): string
  /** Replace the text. No-op when unchanged (keeps the snapshot identity). */
  setText(text: string): void
  subscribeText(listener: () => void): () => void
  getAttachments(): Attachment[]
  /** Replace the attachment list. No-op when the same array is passed back. */
  setAttachments(attachments: Attachment[]): void
  subscribeAttachments(listener: () => void): () => void
}

export type ComposerStoreInit = {
  text?: string
  attachments?: Attachment[]
}

export function createComposerStore(init: ComposerStoreInit = {}): ComposerStore {
  let text = String(init.text ?? '')
  // Stable identity: this exact array is handed out until a write replaces it.
  let attachments: Attachment[] = init.attachments ? [...init.attachments] : []
  const textListeners = new Set<() => void>()
  const attachmentListeners = new Set<() => void>()

  const notify = (listeners: Set<() => void>) => {
    // Copy first: a listener may unsubscribe (or subscribe) while notifying.
    for (const listener of [...listeners]) listener()
  }

  return {
    getText: () => text,
    setText(next: string) {
      const value = String(next ?? '')
      if (value === text) return
      text = value
      notify(textListeners)
    },
    subscribeText(listener) {
      textListeners.add(listener)
      return () => { textListeners.delete(listener) }
    },
    getAttachments: () => attachments,
    setAttachments(next: Attachment[]) {
      if (next === attachments) return
      attachments = next
      notify(attachmentListeners)
    },
    subscribeAttachments(listener) {
      attachmentListeners.add(listener)
      return () => { attachmentListeners.delete(listener) }
    },
  }
}

/** Subscribe to the text slice only (re-renders on every keystroke by design). */
export function useComposerText(store: ComposerStore): string {
  return useSyncExternalStore(store.subscribeText, store.getText, store.getText)
}

/** Subscribe to the attachment slice only (never re-renders on typing). */
export function useComposerAttachments(store: ComposerStore): Attachment[] {
  return useSyncExternalStore(store.subscribeAttachments, store.getAttachments, store.getAttachments)
}
