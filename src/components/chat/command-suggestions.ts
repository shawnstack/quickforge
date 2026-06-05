/**
 * Command suggestion UI for the chat composer.
 *
 * Manages the dropdown that appears when the user types "/" in the composer,
 * showing built-in commands (/plan, /review, /compact, /clear) and project-level custom commands.
 */

import type {
  CommandSuggestionElement,
  CommandTextareaElement,
  CustomCommandSummary,
  MessageEditorElement,
  ComposerDraft,
} from './chat-utils'
import { t } from '@/lib/i18n'

type CommandSuggestionsOptions = {
  panel: HTMLElement
  getCustomCommands: () => CustomCommandSummary[]
  getComposerDrafts: () => Map<string, ComposerDraft>
  sessionId: string
  setComposerDrafts: (drafts: Map<string, ComposerDraft>) => void
  restoreDraftIntoComposer: (draft: ComposerDraft) => void
}

export function createCommandSuggestions({
  panel,
  getCustomCommands,
  restoreDraftIntoComposer,
}: CommandSuggestionsOptions) {
  const commandUsage = (command: CustomCommandSummary) =>
    `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`

  const builtinCommands = (): CustomCommandSummary[] => [
    { name: 'plan', description: t('planCommandDescription'), argumentHint: '[task]' },
    { name: 'review', description: t('reviewCommandDescription'), argumentHint: '[scope]' },
    { name: 'compact', description: t('compactCommandDescription'), argumentHint: '' },
    { name: 'clear', description: t('clearCommandDescription'), argumentHint: '' },
  ]

  const selectedCommandFromSuggestions = (): CustomCommandSummary | undefined => {
    const suggestions = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')
    const firstItem = suggestions?.querySelector<HTMLButtonElement>('.quickforge-command-suggestion-item')
    const commandName = firstItem?.dataset.quickforgeCommandName
    if (!commandName) return undefined
    return [...builtinCommands(), ...getCustomCommands()].find((command) => command.name === commandName)
  }

  const remove = () => {
    const suggestions = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')
    if (suggestions?.__quickforgeDismissHandler) {
      document.removeEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
      suggestions.__quickforgeDismissHandler = undefined
    }
    suggestions?.remove()
  }

  const insertCommandIntoComposer = (command: CustomCommandSummary) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const text = `/${command.name}${command.argumentHint ? ' ' : ''}`
    // Build a minimal draft to restore — caller's draft map is updated externally
    restoreDraftIntoComposer({ text, attachments: [] })
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    textarea?.focus()
    if (textarea) {
      textarea.selectionStart = text.length
      textarea.selectionEnd = text.length
    }
    remove()
  }

  const update = (value?: string) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const text = value ?? editor?.value ?? editor?.querySelector<HTMLTextAreaElement>('textarea')?.value ?? ''
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    const existing = panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')

    if (!editor || !textarea || !text.startsWith('/')) {
      existing?.remove()
      return
    }

    const query = text.slice(1).trim().toLowerCase()
    const projectCommands = getCustomCommands()
    const commands = [...builtinCommands(), ...projectCommands]
      .filter((command) => command.name.includes(query) || command.description?.toLowerCase().includes(query))

    if (commands.length === 0) {
      existing?.remove()
      return
    }

    const suggestions = existing ?? document.createElement('div') as CommandSuggestionElement
    suggestions.className = 'quickforge-command-suggestions'
    suggestions.setAttribute('role', 'listbox')
    suggestions.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'quickforge-command-suggestions-header'
    header.textContent = t(projectCommands.length ? 'customCommandsHint' : 'customCommandsEmptyHint')
    suggestions.append(header)

    for (const command of commands) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'quickforge-command-suggestion-item'
      item.dataset.quickforgeCommandName = command.name
      item.setAttribute('role', 'option')
      item.innerHTML = `
          <span class="quickforge-command-suggestion-name"></span>
          <span class="quickforge-command-suggestion-description"></span>
        `
      item.querySelector<HTMLElement>('.quickforge-command-suggestion-name')!.textContent = commandUsage(command)
      item.querySelector<HTMLElement>('.quickforge-command-suggestion-description')!.textContent = command.description ?? ''
      item.onpointerdown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        insertCommandIntoComposer(command)
      }
      suggestions.append(item)
    }

    if (!existing) {
      editor.parentElement?.insertBefore(suggestions, editor)
    }

    if (!suggestions.__quickforgeDismissHandler) {
      suggestions.__quickforgeDismissHandler = (event: Event) => {
        if (suggestions.contains(event.target as Node)) return
        if (editor.contains(event.target as Node)) return
        remove()
      }
      document.addEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
    }
  }

  const setupTextareaHandler = (editor: MessageEditorElement | null) => {
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    if (!textarea) return
    const commandTextarea = textarea as CommandTextareaElement
    if (commandTextarea.__quickforgeCommandCompleteHandler) {
      commandTextarea.removeEventListener('keydown', commandTextarea.__quickforgeCommandCompleteHandler, true)
    }
    commandTextarea.__quickforgeCommandCompleteHandler = (event: KeyboardEvent) => {
      if (event.isComposing || event.key === 'Process') return
      if (event.key === 'Enter' && event.shiftKey) {
        event.stopImmediatePropagation()
        return
      }
      if (event.key !== 'Tab') return
      const currentText = editor?.value ?? commandTextarea.value ?? ''
      if (!currentText.startsWith('/') || event.shiftKey) return
      const command = selectedCommandFromSuggestions()
      if (!command) return
      event.preventDefault()
      event.stopPropagation()
      insertCommandIntoComposer(command)
    }
    commandTextarea.addEventListener('keydown', commandTextarea.__quickforgeCommandCompleteHandler, true)
  }

  const cleanupTextareaHandler = () => {
    const completeTextarea = panel.querySelector<CommandTextareaElement>('message-editor textarea')
    if (completeTextarea?.__quickforgeCommandCompleteHandler) {
      completeTextarea.removeEventListener('keydown', completeTextarea.__quickforgeCommandCompleteHandler, true)
    }
  }

  return {
    update,
    remove,
    setupTextareaHandler,
    cleanupTextareaHandler,
  }
}
