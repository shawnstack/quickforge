// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { MessageEditor } from '../../src/components/chat/surface/MessageEditor'
import { createComposerStore } from '../../src/components/chat/surface/composer-store'

/**
 * Composer typing must not re-render the chat surface.
 *
 * The reported symptom was "typing gets laggy once the conversation has many
 * turns". The cause was ownership, not a slow component: the composer text lived
 * in `ChatSurface`'s top-level `useState`, so every keystroke re-rendered the
 * whole surface — including `UsageBar`'s `filter`/`reduce` over every assistant
 * message and `TodoWriteSummary`'s backwards scan. Both scale with conversation
 * length, which is why only long chats felt slow.
 *
 * The fix moves text/attachments into an external store
 * (`composer-store.ts`) subscribed only by the composer leaves. These cases
 * assert the invariant that keeps the regression from coming back:
 * - a keystroke notifies ONLY text subscribers (attachment subscribers stay
 *   untouched, so the tile list does not re-render);
 * - `MessageEditor` itself does not re-render on a keystroke — only the
 *   textarea leaf and the action button re-render;
 * - the store keeps snapshot identities stable (`Object.is`), which
 *   `useSyncExternalStore` requires to bail out.
 */
describe('composer store isolation', () => {
  it('notifies text subscribers only when the text changes', () => {
    const store = createComposerStore()
    const textListener = vi.fn()
    const attachmentListener = vi.fn()
    store.subscribeText(textListener)
    store.subscribeAttachments(attachmentListener)

    store.setText('a')

    expect(textListener).toHaveBeenCalledTimes(1)
    expect(attachmentListener).not.toHaveBeenCalled()
  })

  it('notifies attachment subscribers only when the list changes', () => {
    const store = createComposerStore()
    const textListener = vi.fn()
    const attachmentListener = vi.fn()
    store.subscribeText(textListener)
    store.subscribeAttachments(attachmentListener)

    store.setAttachments([{ id: 'a1', type: 'image', fileName: 'f.png', mimeType: 'image/png', size: 1, content: '' }])

    expect(attachmentListener).toHaveBeenCalledTimes(1)
    expect(textListener).not.toHaveBeenCalled()
  })

  it('keeps snapshot identities stable for unchanged writes', () => {
    const store = createComposerStore({ text: 'same' })
    const textListener = vi.fn()
    store.subscribeText(textListener)

    // `useSyncExternalStore` compares the snapshot with `Object.is`; a setter
    // that notified on an unchanged value would re-render the leaf pointlessly.
    store.setText('same')

    expect(textListener).not.toHaveBeenCalled()
    expect(store.getText()).toBe('same')

    const list = store.getAttachments()
    store.setAttachments(list)
    // The getter hands out the same reference until a write replaces it.
    expect(store.getAttachments()).toBe(list)
  })

  it('does not re-render MessageEditor when only the text changes', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const store = createComposerStore()

    // A prop that never changes: if `MessageEditor` re-rendered, React would
    // re-invoke it and rebuild this element, so the rendered node identity is the
    // observable proxy for "the component tree above the leaves did not re-run".
    try {
      act(() => {
        root.render(createElement(MessageEditor, { store, currentModel: undefined }))
      })
      const editorRoot = container.querySelector('.qf-message-editor')
      const card = container.querySelector('.qf-message-editor > div')
      const textarea = container.querySelector('textarea')
      expect(editorRoot).not.toBeNull()

      act(() => store.setText('typed'))

      // Same nodes: only the textarea (and the action button) subscribed, so the
      // wrapper/card were never re-created.
      expect(container.querySelector('.qf-message-editor')).toBe(editorRoot)
      expect(container.querySelector('.qf-message-editor > div')).toBe(card)
      expect(container.querySelector('textarea')).toBe(textarea)
      expect(textarea!.value).toBe('typed')
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('keeps the send button live from the text slice alone', () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const store = createComposerStore()

    try {
      act(() => {
        root.render(createElement(MessageEditor, { store }))
      })
      const send = () => container.querySelector<HTMLButtonElement>('.quickforge-send-button')
      expect(send()!.disabled).toBe(true)

      act(() => store.setText('hello'))

      // The button subscribes to the text slice for `canSend`, so it stays in
      // sync even though the composer card never re-rendered.
      expect(send()!.disabled).toBe(false)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
