import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSlashInvocationChip,
  parseSlashInvocationPrefix,
  planSlashChipText,
  slashChipSpacerWidth,
  slashInvocationPrefixMatches,
  type SlashChipEnv,
  type SlashInvocation,
} from '../../src/components/chat/slash-invocation-chip'

// The real i18n module pulls in pi-web-ui which requires a browser DOM;
// slash-invocation-chip only needs t() for the chip aria-label.
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}))

// ---------------------------------------------------------------------------
// Minimal fake DOM (node environment, no jsdom — same conventions as
// command-suggestions.test.ts). Only the surface used by the chip controller:
// classList, style, dataset, closest, listeners, dispatchEvent, tree helpers.
// ---------------------------------------------------------------------------

type FakeEvent = { type?: string; preventDefault?: () => void }

type FakeClassList = {
  add: (...classes: string[]) => void
  remove: (...classes: string[]) => void
  contains: (cls: string) => boolean
}

type FakeNode = {
  tagName: string
  className: string
  textContent: string
  innerHTML: string
  dataset: Record<string, string>
  attributes: Record<string, string>
  style: Record<string, string>
  children: FakeNode[]
  parentElement: FakeNode | null
  value?: string
  selectionStart?: number
  selectionEnd?: number
  offsetWidth?: number
  clientWidth?: number
  clientHeight?: number
  scrollTop?: number
  listeners: Record<string, Array<(event: unknown) => void>>
  focus: ReturnType<typeof vi.fn>
  classList: FakeClassList
  append: (...nodes: FakeNode[]) => void
  insertBefore: (child: FakeNode, reference: FakeNode | null) => FakeNode
  setAttribute: (name: string, value: string) => void
  getAttribute: (name: string) => string | null
  remove: () => void
  closest: (selector: string) => FakeNode | null
  querySelector: (selector: string) => FakeNode | null
  addEventListener: (type: string, handler: (event: unknown) => void) => void
  removeEventListener: (type: string, handler: (event: unknown) => void) => void
  dispatchEvent: (event: FakeEvent | string) => void
}

const hasClass = (node: FakeNode, cls: string) => node.className.split(/\s+/).includes(cls)

function collectByClass(node: FakeNode, cls: string, acc: FakeNode[] = []): FakeNode[] {
  for (const child of node.children) {
    if (hasClass(child, cls)) acc.push(child)
    collectByClass(child, cls, acc)
  }
  return acc
}

function createFakeElement(tagName: string): FakeNode {
  let html = ''
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    get innerHTML() {
      return html
    },
    set innerHTML(value: string) {
      html = value
      if (value === '') {
        for (const child of node.children.splice(0)) child.parentElement = null
      }
    },
    dataset: {},
    attributes: {},
    style: {},
    children: [],
    parentElement: null,
    listeners: {},
    focus: vi.fn(),
    classList: {
      add: (...classes) => {
        const present = node.className.split(/\s+/).filter(Boolean)
        for (const cls of classes) if (!present.includes(cls)) present.push(cls)
        node.className = present.join(' ')
      },
      remove: (...classes) => {
        node.className = node.className
          .split(/\s+/)
          .filter((cls) => cls && !classes.includes(cls))
          .join(' ')
      },
      contains: (cls) => hasClass(node, cls),
    },
    append(...children) {
      for (const child of children) {
        child.parentElement = node
        node.children.push(child)
      }
    },
    insertBefore(child, reference) {
      child.parentElement = node
      const index = reference ? node.children.indexOf(reference) : -1
      if (index >= 0) node.children.splice(index, 0, child)
      else node.children.push(child)
      return child
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value)
    },
    getAttribute(name) {
      return node.attributes[name] ?? null
    },
    remove() {
      const parent = node.parentElement
      if (!parent) return
      const index = parent.children.indexOf(node)
      if (index >= 0) parent.children.splice(index, 1)
      node.parentElement = null
    },
    closest(selector) {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1)
        let current: FakeNode | null = node
        while (current) {
          if (hasClass(current, cls)) return current
          current = current.parentElement
        }
        return null
      }
      let current: FakeNode | null = node
      while (current) {
        if (current.tagName === selector.toUpperCase()) return current
        current = current.parentElement
      }
      return null
    },
    querySelector(selector) {
      if (selector.startsWith('.')) return collectByClass(node, selector.slice(1))[0] ?? null
      const byTag = (current: FakeNode): FakeNode | null => {
        for (const child of current.children) {
          if (child.tagName === selector.toUpperCase()) return child
          const nested = byTag(child)
          if (nested) return nested
        }
        return null
      }
      return byTag(node)
    },
    addEventListener(type, handler) {
      node.listeners[type] = [...(node.listeners[type] ?? []), handler]
    },
    removeEventListener(type, handler) {
      node.listeners[type] = (node.listeners[type] ?? []).filter((h) => h !== handler)
    },
    dispatchEvent(event) {
      const type = typeof event === 'string' ? event : (event?.type ?? '')
      for (const handler of [...(node.listeners[type] ?? [])]) handler(event)
    },
  }
  return node
}

const fire = (node: FakeNode, type: string, payload: Record<string, unknown> = {}) => {
  for (const handler of [...(node.listeners[type] ?? [])]) handler({ type, ...payload })
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type DocumentStub = {
  createElement: typeof createFakeElement
  createTextNode: (text: string) => FakeNode
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  documentListeners: Record<string, Array<(event: unknown) => void>>
}

const agentInvocation: SlashInvocation = { kind: 'agent', name: 'explore', cmd: '/agent explore' }

type Harness = {
  panel: FakeNode
  shell: FakeNode
  editor: FakeNode
  textarea: FakeNode
  documentStub: DocumentStub
  env: SlashChipEnv
  chip: ReturnType<typeof createSlashInvocationChip>
  overlay: () => FakeNode | null
  ghostText: () => string
  setText: (text: string) => void
}

function createHarness(envOverrides: Partial<SlashChipEnv> = {}): Harness {
  const textarea = createFakeElement('textarea')
  textarea.value = ''
  textarea.selectionStart = 0
  textarea.selectionEnd = 0

  const editor = createFakeElement('message-editor')
  editor.value = ''
  editor.append(textarea)

  const shell = createFakeElement('div')
  shell.className = 'quickforge-composer-shell'
  shell.append(editor)

  const panel = createFakeElement('div')
  panel.append(shell)

  const documentListeners: DocumentStub['documentListeners'] = {}
  const documentStub: DocumentStub = {
    createElement: createFakeElement,
    createTextNode: (text: string) => {
      const node = createFakeElement('#text')
      node.textContent = text
      return node
    },
    addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      documentListeners[type] = [...(documentListeners[type] ?? []), handler]
    }),
    removeEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      documentListeners[type] = (documentListeners[type] ?? []).filter((h) => h !== handler)
    }),
    documentListeners,
  }

  const env: SlashChipEnv = {
    getFont: () => ({
      fontFamily: 'mono',
      fontSize: '14px',
      fontWeight: '400',
      letterSpacing: '0px',
      lineHeight: '20px',
      tabSize: '4',
      paddingTop: '4px',
      paddingRight: '8px',
      paddingBottom: '4px',
      paddingLeft: '8px',
    }),
    measure: vi.fn((text: string) => text.length * 10),
    measureElementWidth: vi.fn(() => 40),
    observeResize: vi.fn(() => () => {}),
    ...envOverrides,
  }

  const chip = createSlashInvocationChip({ panel: panel as unknown as HTMLElement, env })

  return {
    panel,
    shell,
    editor,
    textarea,
    documentStub,
    env,
    chip,
    overlay: () => collectByClass(panel, 'quickforge-slash-overlay')[0] ?? null,
    ghostText: () => {
      const overlayNode = collectByClass(panel, 'quickforge-slash-overlay')[0]
      const ghost = overlayNode ? collectByClass(overlayNode, 'quickforge-slash-ghost')[0] : null
      if (!ghost) return ''
      const textNode = ghost.children.find((child) => child.tagName === '#TEXT')
      return textNode?.textContent ?? ''
    },
    setText(text: string) {
      editor.value = text
      textarea.value = text
      textarea.selectionStart = text.length
      textarea.selectionEnd = text.length
    },
  }
}

describe('slash invocation prefix parsing (pure logic)', () => {
  it('parses skill/agent invocations with a trailing space or end of line', () => {
    expect(parseSlashInvocationPrefix('/agent explore fix the bug')).toEqual({
      kind: 'agent',
      name: 'explore',
      cmd: '/agent explore',
    })
    expect(parseSlashInvocationPrefix('/skill skill-creator')).toEqual({
      kind: 'skill',
      name: 'skill-creator',
      cmd: '/skill skill-creator',
    })
    // Multiple spaces between kind and name are tolerated.
    expect(parseSlashInvocationPrefix('/agent  explore  task')).toEqual({
      kind: 'agent',
      name: 'explore',
      cmd: '/agent explore',
    })
  })

  it('keeps the typed casing in cmd (length matches the raw prefix)', () => {
    expect(parseSlashInvocationPrefix('/Skill Skill-Creator task')).toEqual({
      kind: 'skill',
      name: 'Skill-Creator',
      cmd: '/Skill Skill-Creator',
    })
  })

  it('rejects non-invocations, mid-word kinds, and non-leading slashes', () => {
    expect(parseSlashInvocationPrefix('/plan do stuff')).toBeNull()
    expect(parseSlashInvocationPrefix('/agentx explore task')).toBeNull() // kind must be a whole word
    expect(parseSlashInvocationPrefix('/agent')).toBeNull() // no name yet
    expect(parseSlashInvocationPrefix('/agents ')).toBeNull()
    expect(parseSlashInvocationPrefix('hello /agent explore task')).toBeNull()
    expect(parseSlashInvocationPrefix('')).toBeNull()
  })

  it('validates active prefixes case-insensitively with a word boundary', () => {
    expect(slashInvocationPrefixMatches('/agent explore task', '/agent explore')).toBe(true)
    expect(slashInvocationPrefixMatches('/agent explore', '/agent explore')).toBe(true)
    expect(slashInvocationPrefixMatches('/AGENT EXPLORE task', '/agent explore')).toBe(true)
    // A longer name sharing the prefix must invalidate the chip (no mid-name engage).
    expect(slashInvocationPrefixMatches('/agent explore-deep task', '/agent explore')).toBe(false)
    expect(slashInvocationPrefixMatches('/agentexplore', '/agent explore')).toBe(false)
    expect(slashInvocationPrefixMatches('plain text', '/agent explore')).toBe(false)
  })

  it('plans the first-text-node strip/restore for message decoration', () => {
    expect(planSlashChipText('/agent explore do it')).toEqual({
      invocation: { kind: 'agent', name: 'explore', cmd: '/agent explore' },
      prefix: '/agent explore ',
      rest: 'do it',
    })
    // End-of-line invocation: no trailing space to strip.
    expect(planSlashChipText('/skill skill-creator')).toEqual({
      invocation: { kind: 'skill', name: 'skill-creator', cmd: '/skill skill-creator' },
      prefix: '/skill skill-creator',
      rest: '',
    })
    expect(planSlashChipText('just a task')).toBeNull()
  })

  it('clamps the spacer width at zero when the chip is wider than the prefix', () => {
    expect(slashChipSpacerWidth(140, 40)).toBe(100)
    expect(slashChipSpacerWidth(40, 140)).toBe(0)
    expect(slashChipSpacerWidth(Number.NaN, 40)).toBe(0)
  })
})

describe('slash invocation chip controller', () => {
  beforeEach(() => {
    vi.stubGlobal('document', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const installDocument = () => {
    const harness = createHarness()
    vi.stubGlobal('document', harness.documentStub)
    return harness
  }

  it('engages: mounts the overlay under the composer shell and mirrors the task text', () => {
    const h = installDocument()
    h.setText('/agent explore fix the bug')
    h.chip.engage(agentInvocation)

    expect(h.chip.isActive()).toBe(true)
    expect(h.chip.getInvocation()).toEqual(agentInvocation)
    const overlay = h.overlay()
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(h.shell)
    expect(overlay!.getAttribute('aria-hidden')).toBe('true')
    // Ghost renders chip + spacer + the task text verbatim (leading space included).
    expect(h.ghostText()).toBe(' fix the bug')
    const spacer = collectByClass(overlay!, 'quickforge-slash-spacer')[0]
    expect(spacer).toBeDefined()
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(true)
  })

  it('update: self-destructs on prefix mismatch and keeps the text untouched', () => {
    const h = installDocument()
    h.setText('/agent explore fix the bug')
    h.chip.engage(agentInvocation)

    h.setText('/agxnt explore fix the bug')
    h.chip.update('/agxnt explore fix the bug')

    expect(h.chip.isActive()).toBe(false)
    expect(h.overlay()).toBeNull()
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(false)
    expect(h.textarea.value).toBe('/agxnt explore fix the bug')
  })

  it('update: re-renders the ghost when the task text grows', () => {
    const h = installDocument()
    h.setText('/agent explore ')
    h.chip.engage(agentInvocation)
    expect(h.ghostText()).toBe(' ')

    h.setText('/agent explore do things')
    h.chip.update('/agent explore do things')
    expect(h.chip.isActive()).toBe(true)
    expect(h.ghostText()).toBe(' do things')
  })

  it('removePrefix: deletes the cmd plus one space and keeps the task text', () => {
    const h = installDocument()
    h.setText('/agent explore do things')
    h.chip.engage(agentInvocation)

    const inputListener = vi.fn()
    h.textarea.addEventListener('input', inputListener)
    h.chip.removePrefix()

    expect(h.chip.isActive()).toBe(false)
    expect(h.textarea.value).toBe('do things')
    expect(h.editor.value).toBe('do things')
    expect(inputListener).toHaveBeenCalledTimes(1)
    expect(h.textarea.focus).toHaveBeenCalled()
    expect(h.textarea.selectionStart).toBe(0)
    expect(h.textarea.selectionEnd).toBe(0)
    expect(h.overlay()).toBeNull()
  })

  it('removePrefix: strips nothing extra when the text ends right after the cmd', () => {
    const h = installDocument()
    h.setText('/agent explore')
    h.chip.engage(agentInvocation)
    h.chip.removePrefix()
    expect(h.textarea.value).toBe('')
  })

  it('clear: exits the selected state, keeps the text, and remembers the dismissed prefix', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)

    h.chip.clear()

    expect(h.chip.isActive()).toBe(false)
    expect(h.overlay()).toBeNull()
    expect(h.textarea.value).toBe('/agent explore task')
    expect(h.chip.isDismissed('/agent explore')).toBe(true)
    expect(h.chip.isDismissed('/AGENT EXPLORE')).toBe(true)
    expect(h.chip.isDismissed('/skill other')).toBe(false)
    // Re-engaging resets the dismissal.
    h.chip.engage(agentInvocation)
    expect(h.chip.isDismissed('/agent explore')).toBe(false)
  })

  it('composition: keeps the chip visible during IME and mirrors the pre-edit into the ghost', () => {
    const h = installDocument()
    h.setText('/agent explore ')
    h.chip.engage(agentInvocation)
    const overlay = h.overlay()!

    fire(h.textarea, 'compositionstart')
    // chip 不消失：覆盖层保持显示，透明 class 保留。
    expect(overlay.style.display ?? '').not.toBe('none')
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(true)

    // Chromium：预编辑已写入 value；compositionupdate 携带拼音串。
    h.setText('/agent explore renw')
    fire(h.textarea, 'compositionupdate', { data: 'renw' })
    expect(h.chip.isActive()).toBe(true)
    // 幽灵层：已提交任务文本 + 预编辑镜像（含下划线 span）。
    expect(h.ghostText()).toBe(' ')
    const preedit = overlay.querySelector('.quickforge-slash-preedit') as { textContent?: string } | null
    expect(preedit?.textContent).toBe('renw')

    // update（onInput 链路）期间持续镜像。
    h.chip.update('/agent explore renw')
    expect(h.ghostText()).toBe(' ')
    expect(preedit?.textContent).toBe('renw')

    // WebKit 兼容：end 先于 value 同步时按 event.data 手动拼接一次。
    h.setText('/agent explore ')
    fire(h.textarea, 'compositionend', { data: '任务' })
    expect(h.ghostText()).toBe(' 任务')

    // 正常路径：end 前 value 已含最终文本 → 直接 update。
    fire(h.textarea, 'compositionstart')
    h.setText('/agent explore 任务2')
    fire(h.textarea, 'compositionupdate', { data: '任务2' })
    fire(h.textarea, 'compositionend')
    expect(h.ghostText()).toBe(' 任务2')
    const preeditAfter = overlay.querySelector('.quickforge-slash-preedit') as { textContent?: string } | null
    expect(preeditAfter?.textContent ?? '').toBe('')
  })

  it('selectionchange: degrades to raw text when the caret enters the prefix region and self-heals on return', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)

    h.textarea.selectionStart = 3
    h.textarea.selectionEnd = 3
    for (const handler of [...h.documentStub.documentListeners.selectionchange ?? []]) handler({})

    // 降级而非销毁：选中态保留，原文显示，等待光标回尾部自愈。
    expect(h.chip.isActive()).toBe(true)
    expect(h.overlay()).not.toBeNull()
    expect(h.overlay()?.style.display).toBe('none')
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(false)

    h.textarea.selectionStart = 18
    h.textarea.selectionEnd = 18
    for (const handler of [...h.documentStub.documentListeners.selectionchange ?? []]) handler({})

    expect(h.overlay()?.style.display).toBe('')
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(true)
    // Not recorded as dismissed.
    expect(h.chip.isDismissed('/agent explore')).toBe(false)
  })

  it('update: rebuilds the overlay when it was removed externally', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)
    const first = h.overlay()
    expect(first).not.toBeNull()
    first?.remove()
    expect(h.overlay()).toBeNull()

    h.setText('/agent explore task two')
    h.chip.update('/agent explore task two')

    // 自愈：文本仍匹配时重建挂载，选中态不丢。
    expect(h.chip.isActive()).toBe(true)
    expect(h.overlay()).not.toBeNull()
    expect(h.overlay() === first).toBe(false)
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(true)
    expect(h.ghostText()).toBe(' task two')
  })

  it('update: re-resolves the textarea when Lit rebuilt the editor internals', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)

    const oldTextarea = h.textarea
    oldTextarea.isConnected = false
    const replacement = createFakeElement('textarea')
    replacement.value = '/agent explore reborn'
    replacement.selectionStart = 20
    replacement.selectionEnd = 20
    h.editor.append(replacement)

    h.chip.update('/agent explore reborn')

    expect(h.chip.isActive()).toBe(true)
    expect(h.overlay()).not.toBeNull()
    expect(h.ghostText()).toBe(' reborn')
  })

  it('cleanup: removes the overlay, the textarea class, and the document listener', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)
    expect(h.documentStub.documentListeners.selectionchange?.length).toBe(1)

    h.chip.cleanup()

    expect(h.overlay()).toBeNull()
    expect(h.chip.isActive()).toBe(false)
    expect(h.textarea.classList.contains('quickforge-slash-source-text')).toBe(false)
    expect(h.documentStub.documentListeners.selectionchange?.length ?? 0).toBe(0)
    expect(h.documentStub.removeEventListener).toHaveBeenCalled()
  })

  it('spacer width: measured as prefix width minus chip width, clamped at zero', () => {
    const h = installDocument()
    h.setText('/agent explore task')
    h.chip.engage(agentInvocation)
    const spacer = collectByClass(h.overlay()!, 'quickforge-slash-spacer')[0]

    // measure: 14 chars * 10px = 140; chip width 40 → spacer 100px.
    expect(spacer.style.width).toBe('100px')

    // A chip wider than the prefix clamps to zero (documented visual trade-off).
    const wide = createHarness({ measureElementWidth: vi.fn(() => 300) })
    vi.stubGlobal('document', wide.documentStub)
    wide.setText('/agent explore task')
    wide.chip.engage(agentInvocation)
    const wideSpacer = collectByClass(wide.overlay()!, 'quickforge-slash-spacer')[0]
    expect(wideSpacer.style.width).toBe('0px')
  })

  it('engage without a composer shell or textarea is a safe no-op', () => {
    const textarea = createFakeElement('textarea')
    const editor = createFakeElement('message-editor')
    editor.append(textarea)
    const panel = createFakeElement('div')
    panel.append(editor) // no .quickforge-composer-shell ancestor

    const documentStub = {
      createElement: createFakeElement,
      createTextNode: (text: string) => {
        const node = createFakeElement('#text')
        node.textContent = text
        return node
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      documentListeners: {},
    }
    vi.stubGlobal('document', documentStub)

    const chip = createSlashInvocationChip({ panel: panel as unknown as HTMLElement })
    chip.engage(agentInvocation)
    expect(chip.isActive()).toBe(false)
    expect(collectByClass(panel, 'quickforge-slash-overlay')).toHaveLength(0)
  })
})
