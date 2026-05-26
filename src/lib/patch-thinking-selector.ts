import { icon } from '@mariozechner/mini-lit'
import { Select, type SelectOption } from '@mariozechner/mini-lit/dist/Select.js'
import { Brain } from 'lucide'
import { render } from 'lit'
import { i18n } from '@mariozechner/pi-web-ui'
import { getAppLanguage } from '@/lib/i18n'

const THINKING_LEVELS = new Set(['off', 'low', 'medium', 'high', 'xhigh'])
const THINKING_OPTIONS = [
  { value: 'off', label: () => i18n('Off') },
  { value: 'low', label: () => i18n('Low') },
  { value: 'medium', label: () => i18n('Medium') },
  { value: 'high', label: () => i18n('High') },
  { value: 'xhigh', label: () => getAppLanguage() === 'zh' ? '极高' : 'XHigh' },
] as const

type QuickForgeThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh'

function isThinkingLevel(value: unknown): value is QuickForgeThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.has(value)
}

function findSelectContainer(editor: HTMLElement) {
  return Array.from(editor.querySelectorAll<HTMLElement>('.flex.gap-2.items-center'))
    .find((row) => row.querySelector('button[role="combobox"]') || row.querySelector('[data-quickforge-thinking-selector]'))
}

function renderThinkingSelector(wrapper: HTMLElement, editor: HTMLElement & {
  thinkingLevel?: string
  onThinkingChange?: (level: QuickForgeThinkingLevel) => void
  requestUpdate?: () => void
}) {
  const level = isThinkingLevel(editor.thinkingLevel) ? editor.thinkingLevel : 'off'
  render(
    Select({
      value: level,
      placeholder: i18n('Off'),
      options: THINKING_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label(),
        icon: icon(Brain, 'sm'),
      })) as SelectOption[],
      onChange: (value: string) => {
        const nextLevel = isThinkingLevel(value) ? value : 'off'
        editor.thinkingLevel = nextLevel
        editor.onThinkingChange?.(nextLevel)
        editor.requestUpdate?.()
      },
      width: '80px',
      size: 'sm',
      variant: 'ghost',
      fitContent: true,
    }),
    wrapper,
  )
}

function patchEditorInstance(editor: HTMLElement) {
  const editorWithState = editor as HTMLElement & {
    thinkingLevel?: string
    onThinkingChange?: (level: QuickForgeThinkingLevel) => void
    requestUpdate?: () => void
  }

  if (!isThinkingLevel(editorWithState.thinkingLevel)) {
    editorWithState.thinkingLevel = 'off'
    editorWithState.onThinkingChange?.('off')
  }

  const selectContainer = findSelectContainer(editor)
  if (!selectContainer) return

  const existingWrapper = selectContainer.querySelector<HTMLElement>('[data-quickforge-thinking-selector]')
  if (existingWrapper) {
    renderThinkingSelector(existingWrapper, editorWithState)
    return
  }

  const existingSelect = selectContainer.querySelector<HTMLElement>('button[role="combobox"]')
  if (!existingSelect) return

  // Hide the Lit-managed select instead of removing it from DOM — removing it
  // would orphan Lit's internal marker nodes and cause "ChildPart has no
  // parentNode" errors when the message-editor re-renders.
  existingSelect.style.display = 'none'
  existingSelect.setAttribute('aria-hidden', 'true')

  const wrapper = document.createElement('span')
  wrapper.dataset.quickforgeThinkingSelector = 'true'
  existingSelect.insertAdjacentElement('afterend', wrapper)
  renderThinkingSelector(wrapper, editorWithState)
}

export function patchThinkingSelector(options: { hideSelector?: boolean } = {}) {
  const { hideSelector = false } = options
  const tryPatch = () => {
    const MessageEditor = customElements.get('message-editor') as (CustomElementConstructor & {
      prototype: { render?: () => unknown }
    }) | undefined

    if (!MessageEditor?.prototype.render) {
      setTimeout(tryPatch, 0)
      return
    }

    if ((MessageEditor.prototype.render as { __quickforgePatched?: boolean }).__quickforgePatched) return

    const originalRender = MessageEditor.prototype.render
    MessageEditor.prototype.render = function patchedRender(this: HTMLElement) {
      const result = originalRender.call(this)
      queueMicrotask(() => {
        if (hideSelector) {
          const editor = this as HTMLElement & { showThinkingSelector?: boolean; requestUpdate?: () => void }
          if (editor.showThinkingSelector !== false) {
            editor.showThinkingSelector = false
            editor.requestUpdate?.()
          }
          return
        }
        patchEditorInstance(this)
      })
      return result
    }
    ;(MessageEditor.prototype.render as { __quickforgePatched?: boolean }).__quickforgePatched = true
  }

  tryPatch()
}
