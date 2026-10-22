// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { createCommandSuggestions } from '../../src/components/chat/command-suggestions'
import type { MessageEditorElement } from '../../src/components/chat/chat-utils'

/**
 * The slash menu must not rebuild its DOM on every keystroke.
 *
 * `update()` runs per character while the composer starts with "/". The original
 * implementation did `innerHTML = ''` and re-created every group head, row, icon,
 * highlight `<b>` and footer `<kbd>`, then re-queried all rows to set the active
 * one — for input that usually produces the same visible list. That churn also
 * fed the panel decoration observer a `{childList, subtree}` burst per keystroke.
 *
 * These cases pin the reconcile contract: an unchanged (query, matched entries,
 * loading) signature keeps the SAME nodes on screen, and a closed menu cannot
 * reuse a stale signature when it reopens.
 */
describe('slash menu render reconciliation', () => {
  let panel: HTMLElement
  let editor: MessageEditorElement
  let textarea: HTMLTextAreaElement

  beforeEach(() => {
    document.body.innerHTML = ''
    panel = document.createElement('div')
    panel.className = 'qf-chat-panel'
    editor = document.createElement('div') as MessageEditorElement
    editor.className = 'qf-message-editor'
    textarea = document.createElement('textarea')
    editor.append(textarea)
    panel.append(editor)
    document.body.append(panel)
    editor.value = ''
  })

  function makeController() {
    return createCommandSuggestions({
      panel,
      getCustomCommands: () => [],
      getComposerDrafts: () => new Map(),
      sessionId: 's1',
      setComposerDrafts: () => {},
      restoreDraftIntoComposer: () => {},
      // Never resolves: keeps the catalog in `loading` so the entry list is
      // stable and the assertions below isolate the signature logic.
      loadSlashCatalog: () => new Promise(() => {}),
    })
  }

  const menu = () => panel.querySelector<HTMLElement>('.quickforge-command-suggestions')
  const rows = () => Array.from(panel.querySelectorAll<HTMLElement>('.quickforge-command-suggestion-item'))

  it('keeps the same row nodes when the signature is unchanged', () => {
    const controller = makeController()
    controller.update('/')
    const first = rows()
    expect(first.length).toBeGreaterThan(0)

    // `update()` is re-entered by many callers (the decoration pass, the other
    // suggestion controllers, re-entrant input events). With the same query and
    // the same entry list nothing visible changed, so the nodes must survive —
    // re-creating them restarted the skeleton animation and burst the observer.
    controller.update('/')
    expect(rows()).toEqual(first)
    expect(menu()!.contains(first[0])).toBe(true)

    controller.remove()
  })

  it('re-renders when the query changes', () => {
    const controller = makeController()
    controller.update('/')
    const before = rows()

    controller.update('/comp')

    const after = rows()
    expect(after).not.toEqual(before)
    // The matched query substring is wrapped in <b> inside the name span.
    const bold = after
      .flatMap((row) => Array.from(row.querySelectorAll('b')))
      .map((node) => node.textContent)
    expect(bold).toContain('comp')

    controller.remove()
  })

  it('renders fresh nodes when the menu reopens after being closed', () => {
    const controller = makeController()
    controller.update('/')
    const firstRow = rows()[0]
    expect(firstRow).toBeDefined()
    expect(firstRow.isConnected).toBe(true)

    // Closing clears the signature along with the DOM, so a reopen cannot
    // short-circuit onto nodes that were removed from the document.
    controller.remove()
    expect(menu()).toBeNull()
    expect(firstRow.isConnected).toBe(false)

    controller.update('/')
    const reopened = rows()
    expect(menu()).not.toBeNull()
    // A brand-new node: the stale one was detached by `remove()`.
    expect(reopened[0]).not.toBe(firstRow)
    expect(reopened[0].isConnected).toBe(true)

    controller.remove()
  })
})
