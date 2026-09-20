import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import type { Attachment } from '../../src/components/chat/surface/ChatTypes'
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_SIZE,
  filterFilesByLimits,
  MessageEditor,
  resolveEditorKeyDown,
} from '../../src/components/chat/surface/MessageEditor'

// The surface reads its copy from i18n and the language falls back to
// navigator.language, so pin it: assertions below must not depend on the host
// locale. The zh/localization coverage lives in its own test.
beforeEach(() => {
  applyAppLanguageFromSnapshot('en')
})
afterEach(() => {
  applyAppLanguageFromSnapshot('en')
})

describe('chat surface MessageEditor keyboard behavior', () => {
  const sendable = { isStreaming: false, processingFiles: false, canSend: true }

  it('Enter without Shift sends and prevents the default newline', () => {
    expect(resolveEditorKeyDown({ key: 'Enter', shiftKey: false }, sendable)).toEqual({
      action: 'send',
      preventDefault: true,
    })
  })

  it('Shift+Enter neither sends nor prevents the newline', () => {
    expect(resolveEditorKeyDown({ key: 'Enter', shiftKey: true }, sendable)).toEqual({
      action: 'none',
      preventDefault: false,
    })
  })

  it('never triggers while IME is composing (isComposing or Process key)', () => {
    expect(resolveEditorKeyDown({ key: 'Enter', isComposing: true }, sendable)).toEqual({
      action: 'none',
      preventDefault: false,
    })
    expect(resolveEditorKeyDown({ key: 'Process' }, sendable)).toEqual({
      action: 'none',
      preventDefault: false,
    })
  })

  it('Enter is prevented but does not send while streaming or processing files or empty', () => {
    expect(resolveEditorKeyDown({ key: 'Enter' }, { ...sendable, isStreaming: true })).toEqual({
      action: 'none',
      preventDefault: true,
    })
    expect(resolveEditorKeyDown({ key: 'Enter' }, { ...sendable, processingFiles: true })).toEqual({
      action: 'none',
      preventDefault: true,
    })
    expect(resolveEditorKeyDown({ key: 'Enter' }, { ...sendable, canSend: false })).toEqual({
      action: 'none',
      preventDefault: true,
    })
  })

  it('Escape aborts only while streaming', () => {
    expect(resolveEditorKeyDown({ key: 'Escape' }, { ...sendable, isStreaming: true })).toEqual({
      action: 'abort',
      preventDefault: true,
    })
    expect(resolveEditorKeyDown({ key: 'Escape' }, sendable)).toEqual({
      action: 'none',
      preventDefault: false,
    })
  })
})

describe('chat surface attachment limits', () => {
  const file = (name: string, size: number) => ({ name, size })
  const oneMb = 1024 * 1024

  it('rejects the whole batch when it would exceed maxFiles', () => {
    const decision = filterFilesByLimits([file('a', 1), file('b', 1)], DEFAULT_MAX_FILES - 1, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE)
    expect(decision.countExceeded).toBe(true)
    expect(decision.accepted).toEqual([])
    expect(decision.oversized).toEqual([])
  })

  it('rejects oversized files individually while accepting the rest', () => {
    const oversized = file('huge.png', DEFAULT_MAX_FILE_SIZE + 1)
    const fine = file('fine.png', oneMb)
    const decision = filterFilesByLimits([oversized, fine], 0, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE)

    expect(decision.countExceeded).toBe(false)
    expect(decision.accepted).toEqual([fine])
    expect(decision.oversized).toEqual([oversized])
  })

  it('accepts everything within both limits', () => {
    const files = [file('a.png', oneMb), file('b.png', 2 * oneMb)]
    const decision = filterFilesByLimits(files, 8, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE)

    expect(decision.countExceeded).toBe(false)
    expect(decision.oversized).toEqual([])
    expect(decision.accepted).toEqual(files)
  })

  it('empty batches never exceed the limit', () => {
    const decision = filterFilesByLimits([], DEFAULT_MAX_FILES, DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE)
    expect(decision).toEqual({ accepted: [], countExceeded: false, oversized: [] })
  })
})

describe('chat surface MessageEditor rendering', () => {
  it('renders the controlled value and disables send when empty', () => {
    const markup = renderToStaticMarkup(
      createElement(MessageEditor, { value: '', isStreaming: false }),
    )
    expect(markup).toContain('qf-message-editor')
    // The composer placeholder comes from i18n (`composerPlaceholder`), which is
    // also what the panel decoration writes onto the textarea.
    expect(markup).toContain('Describe what you want to do')
    expect(markup).toContain('disabled')

    const filled = renderToStaticMarkup(
      createElement(MessageEditor, { value: 'draft text', isStreaming: false }),
    )
    expect(filled).toContain('draft text')
  })

  it('renders React-owned arrow-up / stop-square icons with the base classes', () => {
    // Ownership contract: the icon svgs and the quickforge-*-button base
    // classes live in React. The panel decoration must stay status-only —
    // grafting a foreign svg here used to crash React's commit with
    // NotFoundError when isStreaming flipped.
    const send = renderToStaticMarkup(
      createElement(MessageEditor, { value: 'hi', isStreaming: false }),
    )
    expect(send).toContain('quickforge-send-button')
    expect(send).toContain('<path d="M12 19V5"></path>')
    expect(send).toContain('<path d="m5 12 7-7 7 7"></path>')
    expect(send).toContain('stroke-width="2.4"')

    const stop = renderToStaticMarkup(
      createElement(MessageEditor, { value: 'hi', isStreaming: true }),
    )
    expect(stop).toContain('quickforge-stop-button')
    expect(stop).toContain('<rect x="6" y="6" width="12" height="12" rx="2"></rect>')
    expect(stop).not.toContain('quickforge-send-button')
  })

  it('renders attachment tiles for pending attachments', () => {
    const markup = renderToStaticMarkup(
      createElement(MessageEditor, {
        value: 'see attachment',
        attachments: [
          {
            id: 'att-1',
            type: 'image',
            fileName: 'photo.png',
            mimeType: 'image/png',
            size: 8,
            content: 'aGk=',
            preview: 'aGk=',
          },
        ],
      }),
    )

    expect(markup).toContain('qf-attachment-tile')
    expect(markup).toContain('photo.png')
  })

  it('shows the thinking selector only for reasoning models', () => {
    const reasoningModel = { id: 'reasoner', reasoning: true } as never
    const plainModel = { id: 'plain', reasoning: false } as never

    const withThinking = renderToStaticMarkup(
      createElement(MessageEditor, { value: 'x', currentModel: reasoningModel, thinkingLevel: 'low' }),
    )
    expect(withThinking).toContain('value="xhigh"')
    expect(withThinking).toContain('XHigh')
    // Application-wide vocabulary is off/low/medium/high/xhigh.
    expect(withThinking).not.toContain('Minimal')

    const withoutThinking = renderToStaticMarkup(
      createElement(MessageEditor, { value: 'x', currentModel: plainModel }),
    )
    expect(withoutThinking).not.toContain('XHigh')
  })
})

describe('chat surface composer localization', () => {
  const attachment: Attachment = {
    id: 'att-1',
    type: 'image',
    fileName: 'photo.png',
    mimeType: 'image/png',
    size: 8,
    content: 'aGk=',
    preview: 'aGk=',
  }

  it('follows the active language for composer controls', () => {
    const english = renderToStaticMarkup(createElement(MessageEditor, { value: '', attachments: [attachment] }))
    expect(english).toContain('placeholder="Describe what you want to do"')
    expect(english).toContain('title="Attach files"')
    expect(english).toContain('title="Send"')
    expect(english).toContain('title="Remove"')

    applyAppLanguageFromSnapshot('zh')
    const chinese = renderToStaticMarkup(createElement(MessageEditor, { value: '', attachments: [attachment] }))
    expect(chinese).toContain('placeholder="描述你想做的事"')
    expect(chinese).toContain('title="添加附件"')
    expect(chinese).toContain('title="发送"')
    expect(chinese).toContain('title="移除"')
  })

  it('renders the thinking levels with the application vocabulary in both languages', () => {
    const reasoningModel = { id: 'reasoner', reasoning: true } as never

    const english = renderToStaticMarkup(createElement(MessageEditor, { value: 'x', currentModel: reasoningModel }))
    expect(english).toContain('<option value="xhigh">XHigh</option>')
    expect(english).not.toContain('Minimal')

    applyAppLanguageFromSnapshot('zh')
    const chinese = renderToStaticMarkup(createElement(MessageEditor, { value: 'x', currentModel: reasoningModel }))
    expect(chinese).toContain('<option value="xhigh">超高</option>')
    expect(chinese).not.toContain('Minimal')
  })
})

/**
 * The composer visual contract lives in src/index.css and is anchored on the
 * wrapper's structure:
 *   `.quickforge-composer > div:first-child`            → the card
 *   `.quickforge-composer > div:first-child > .px-2.pb-2` → the control row
 * `quickforge-composer` is added to `.qf-message-editor` by the panel
 * decoration, so these tests walk the rendered div tree and assert the shape.
 */
describe('chat surface composer DOM contract', () => {
  function divLevels(markup: string): Array<{ depth: number; classes: string[] }> {
    const levels: Array<{ depth: number; classes: string[] }> = []
    let depth = 0
    // Divs only: div nesting is well-formed, so counting open/close tags
    // yields the nesting depth of each element.
    for (const token of markup.matchAll(/<(\/?)div\b([^>]*)>/g)) {
      if (token[1] === '/') {
        depth -= 1
        continue
      }
      depth += 1
      const className = /\bclass="([^"]*)"/.exec(token[2])
      levels.push({ depth, classes: className ? className[1].split(/\s+/).filter(Boolean) : [] })
    }
    return levels
  }

  function composerLevels(markup: string) {
    const levels = divLevels(markup)
    expect(levels[0].classes).toContain('qf-message-editor')
    // Exactly one direct child div of the wrapper: the card.
    expect(levels.filter((entry) => entry.depth === 2)).toHaveLength(1)
    return levels
  }

  it('keeps the card as the wrapper first child and the control row inside it', () => {
    const levels = composerLevels(renderToStaticMarkup(createElement(MessageEditor, { value: 'hi' })))

    const card = levels.find((entry) => entry.depth === 2)
    expect(card?.classes).toEqual(expect.arrayContaining(['relative', 'border', 'bg-card', 'shadow-sm']))

    const controlRows = levels.filter(
      (entry) => entry.depth === 3 && entry.classes.includes('px-2') && entry.classes.includes('pb-2'),
    )
    expect(controlRows).toHaveLength(1)
  })

  it('keeps the attachment row inside the card (it must not become the card)', () => {
    const levels = composerLevels(renderToStaticMarkup(
      createElement(MessageEditor, {
        value: 'see attachment',
        attachments: [
          { id: 'att-1', type: 'image', fileName: 'photo.png', mimeType: 'image/png', size: 8, content: 'aGk=', preview: 'aGk=' },
        ],
      }),
    ))

    const attachmentRows = levels.filter((entry) => entry.depth === 3 && entry.classes.includes('pt-3'))
    expect(attachmentRows).toHaveLength(1)
    const tiles = levels.filter((entry) => entry.classes.includes('qf-attachment-tile'))
    expect(tiles).toHaveLength(1)
    expect(tiles[0].depth).toBe(4)
  })
})
