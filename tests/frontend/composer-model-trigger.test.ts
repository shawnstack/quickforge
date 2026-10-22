// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MessageEditor } from '../../src/components/chat/surface/MessageEditor'
import { createComposerStore } from '../../src/components/chat/surface/composer-store'

/**
 * The composer's model button used to be tagged by `decorateModelButtonLabel`,
 * which ran on every decoration pass: it located the button by scanning the
 * right-hand control row for the button whose text contained the current model
 * id, added `quickforge-model-trigger`, set `aria-haspopup`, and derived
 * `aria-expanded` from a document-wide `.quickforge-model-menu` lookup.
 *
 * React owns the tag now, so these cases assert the rendered contract instead of
 * the injection:
 * - the trigger class and `aria-haspopup` exist on the button itself;
 * - `aria-expanded` is NOT declared by React (the custom model menu owns that
 *   attribute: it sets "true" on open and "false" on close, and a
 *   React-declared value would be re-applied on every surface re-render,
 *   wiping the open highlight);
 * - the trigger is absent when the model selector is disabled or no model is
 *   set, matching the previous "no model button found" branch.
 */
describe('composer model trigger', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: Record<string, unknown>) {
    // Text/attachments now live in a ComposerStore rather than in props; a
    // fresh store per render matches how each case starts from an empty
    // composer.
    act(() => {
      root.render(createElement(MessageEditor, { store: createComposerStore(), ...props }))
    })
  }

  const model = { id: 'model-1', name: 'Model 1', provider: 'test', reasoning: false } as never

  function trigger() {
    return container.querySelector<HTMLButtonElement>('.quickforge-model-trigger')
  }

  it('tags the model button as the composer model trigger', () => {
    render({ currentModel: model })

    const button = trigger()
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-haspopup')).toBe('menu')
    expect(button!.textContent).toContain('model-1')
  })

  it('leaves aria-expanded to the model menu', () => {
    render({ currentModel: model })

    // React must not declare the attribute at all: `Button` renders no
    // aria-expanded, so the first open can set it without a re-render fight.
    expect(trigger()!.hasAttribute('aria-expanded')).toBe(false)

    // The menu writes it, and a re-render must not reset it back.
    trigger()!.setAttribute('aria-expanded', 'true')
    render({ currentModel: model })
    expect(trigger()!.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders the model trigger disabled for inert composer controls', () => {
    // Side Chat: visible but not pressable (the decoration set `disabled`).
    render({ currentModel: model, composerControlsDisabled: true })

    expect(trigger()!.disabled).toBe(true)
  })

  it('omits the trigger when the model selector is disabled', () => {
    render({ currentModel: model, showModelSelector: false })

    expect(trigger()).toBeNull()
  })

  it('omits the trigger when no model is set', () => {
    render({})

    expect(trigger()).toBeNull()
  })
})
