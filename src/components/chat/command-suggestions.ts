/**
 * Slash menu for the chat composer.
 *
 * Manages the dropdown that appears when the user types "/" in the composer.
 * Three groups in order: commands (built-in /init, /plan, /review, /summary,
 * /compact, /clear, /help plus project-level custom commands), skills, and
 * subagents. Skills/subagents are lazy-loaded on first trigger via
 * loadSlashCatalog and degrade silently to a commands-only menu when the
 * catalog is unavailable.
 *
 * Selecting a skill/subagent (Tab / click) additionally engages the slash
 * invocation chip (see slash-invocation-chip.ts, design-mockups
 * slash-menu-expansion.html 方案 A): the composer keeps the raw
 * "/skill <name> " prefix while an inline chip overlay mirrors it visually;
 * the chip suppresses the menu while active and self-destructs when the
 * prefix stops matching.
 */

import type {
  CommandSuggestionElement,
  CommandTextareaElement,
  CustomCommandSummary,
  MessageEditorElement,
  ComposerDraft,
} from './chat-utils'
import { capabilityIcons } from './capability-icons'
import {
  createSlashInvocationChip,
  parseSlashInvocationPrefix,
  slashAgentIcon,
  slashInvocationPrefixMatches,
  type SlashInvocation,
} from './slash-invocation-chip'
import type { SlashCatalog } from '@/lib/slash-catalog'
import { t } from '@/lib/i18n'

type CommandSuggestionsOptions = {
  panel: HTMLElement
  getCustomCommands: () => CustomCommandSummary[]
  getComposerDrafts: () => Map<string, ComposerDraft>
  sessionId: string
  setComposerDrafts: (drafts: Map<string, ComposerDraft>) => void
  restoreDraftIntoComposer: (draft: ComposerDraft) => void
  loadSlashCatalog?: () => Promise<SlashCatalog | null>
}

type SlashEntryKind = 'command' | 'skill' | 'agent'

type SlashEntry = {
  kind: SlashEntryKind
  name: string
  /** Full usage text, e.g. "/plan [task]" or "/skill patch-release". */
  usage: string
  /** Trailing argument hint rendered as a muted span (commands only). */
  hint: string
  description: string
  /** Text inserted when the row is chosen (always with a trailing space). */
  insertText: string
}

type SlashRowElement = HTMLButtonElement & {
  __quickforgeSlashEntry?: SlashEntry
}

const kindIcon = (kind: SlashEntryKind) => (kind === 'agent' ? slashAgentIcon : capabilityIcons[kind])

export function createCommandSuggestions({
  panel,
  getCustomCommands,
  restoreDraftIntoComposer,
  loadSlashCatalog,
}: CommandSuggestionsOptions) {
  // Catalog state machine: idle → loading → ready on resolve (even with a
  // null catalog), or error on reject. Error allows exactly one retry the
  // next time the menu transitions from closed to open.
  let catalogState: 'idle' | 'loading' | 'ready' | 'error' = 'idle'
  let catalog: SlashCatalog | null = null
  let menuOpenAtLastUpdate = false

  // Slash 选中态 chip 子系统（方案 A）：选中技能/子智能体后输入框内联 chip 覆盖层。
  const chip = createSlashInvocationChip({ panel })

  const builtinCommands = (): CustomCommandSummary[] => [
    { name: 'init', description: t('initCommandDescription'), argumentHint: '' },
    { name: 'plan', description: t('planCommandDescription'), argumentHint: '[task]' },
    { name: 'review', description: t('reviewCommandDescription'), argumentHint: '[scope]' },
    { name: 'summary', description: t('summaryCommandDescription'), argumentHint: '' },
    { name: 'compact', description: t('compactCommandDescription'), argumentHint: '' },
    { name: 'clear', description: t('clearCommandDescription'), argumentHint: '' },
    { name: 'help', description: t('helpCommandDescription'), argumentHint: '' },
  ]

  const suggestionsElement = (): CommandSuggestionElement | null =>
    panel.querySelector<CommandSuggestionElement>('.quickforge-command-suggestions')

  const readComposerText = () => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    return editor?.value ?? textarea?.value ?? ''
  }

  const visibleRows = (): SlashRowElement[] => {
    const suggestions = suggestionsElement()
    if (!suggestions) return []
    return Array.from(suggestions.querySelectorAll<HTMLElement>('.quickforge-command-suggestion-item'))
      .filter((row) => row.tagName === 'BUTTON') as SlashRowElement[]
  }

  const activeRowIndex = () => {
    const rows = visibleRows()
    const index = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true')
    return index >= 0 ? index : 0
  }

  const setActiveRow = (rows: SlashRowElement[], index: number) => {
    rows.forEach((row, i) => {
      if (i === index) row.setAttribute('aria-selected', 'true')
      else row.removeAttribute('aria-selected')
    })
    rows[index]?.scrollIntoView?.({ block: 'nearest' })
  }

  const remove = () => {
    const suggestions = suggestionsElement()
    if (suggestions?.__quickforgeDismissHandler) {
      document.removeEventListener('pointerdown', suggestions.__quickforgeDismissHandler, true)
      suggestions.__quickforgeDismissHandler = undefined
    }
    suggestions?.remove()
    menuOpenAtLastUpdate = false
  }

  const insertEntryIntoComposer = (entry: SlashEntry) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const text = entry.insertText
    restoreDraftIntoComposer({
      text,
      attachments: editor?.attachments ? [...editor.attachments] : [],
      contextReferences: editor?.contextReferences ? [...editor.contextReferences] : [],
      selectedCapabilities: editor?.selectedCapabilities ? [...editor.selectedCapabilities] : [],
    })
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    textarea?.focus()
    if (textarea) {
      textarea.selectionStart = text.length
      textarea.selectionEnd = text.length
    }
    remove()
    // 选中技能/子智能体进入 chip 选中态；指令维持纯文本（不 engage）。
    if (entry.kind === 'skill' || entry.kind === 'agent') {
      chip.engage({ kind: entry.kind, name: entry.name, cmd: `/${entry.kind} ${entry.name}` })
    }
  }

  const rerenderIfOpen = () => {
    if (readComposerText().startsWith('/')) update()
  }

  const startCatalogLoad = () => {
    if (!loadSlashCatalog) {
      catalogState = 'error'
      return
    }
    catalogState = 'loading'
    loadSlashCatalog()
      .then((result) => {
        catalog = result
        catalogState = 'ready'
        rerenderIfOpen()
      })
      .catch(() => {
        catalogState = 'error'
        rerenderIfOpen()
      })
  }

  const entryHaystack = (entry: SlashEntry) =>
    `${entry.usage.replace(/^\//, '')} ${entry.description}`
      .replace(/\s+/g, ' ')
      .toLowerCase()

  const filterEntries = (entries: SlashEntry[], query: string) =>
    query ? entries.filter((entry) => entryHaystack(entry).includes(query)) : entries

  const commandEntries = (): SlashEntry[] =>
    [...builtinCommands(), ...getCustomCommands()].map((command) => ({
      kind: 'command' as const,
      name: command.name,
      usage: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`,
      hint: command.argumentHint ?? '',
      description: command.description ?? '',
      insertText: `/${command.name} `,
    }))

  const skillEntries = (): SlashEntry[] =>
    (catalog?.skills ?? []).map((skill) => ({
      kind: 'skill' as const,
      name: skill.name,
      usage: `/skill ${skill.name}`,
      hint: '',
      description: skill.description ?? '',
      insertText: `/skill ${skill.name} `,
    }))

  const agentEntries = (): SlashEntry[] =>
    (catalog?.agents ?? []).map((agent) => ({
      kind: 'agent' as const,
      name: agent.name,
      usage: `/agent ${agent.name}`,
      hint: '',
      description: agent.label && agent.description
        ? `${agent.label} · ${agent.description}`
        : (agent.label ?? agent.description ?? ''),
      insertText: `/agent ${agent.name} `,
    }))

  const appendGroupHead = (suggestions: CommandSuggestionElement, label: string, count: string) => {
    const head = document.createElement('div')
    head.className = 'quickforge-command-suggestion-group-head'
    head.setAttribute('role', 'presentation')
    const labelSpan = document.createElement('span')
    labelSpan.textContent = label
    const countSpan = document.createElement('span')
    countSpan.className = 'quickforge-command-suggestion-count'
    countSpan.textContent = count
    head.append(labelSpan, countSpan)
    suggestions.append(head)
  }

  const appendSkeletonRows = (suggestions: CommandSuggestionElement, kind: SlashEntryKind) => {
    for (let i = 0; i < 2; i++) {
      const row = document.createElement('div')
      row.className = 'quickforge-command-suggestion-item quickforge-command-suggestion-item-skeleton'
      row.setAttribute('role', 'presentation')
      row.dataset.skeleton = ''
      row.innerHTML = `
          <span class="quickforge-command-suggestion-icon quickforge-command-suggestion-icon-${kind}">${kindIcon(kind)}</span>
          <span class="quickforge-command-suggestion-name">loading</span>
          <span class="quickforge-command-suggestion-description">loading</span>
        `
      suggestions.append(row)
    }
  }

  const appendUsageText = (name: HTMLElement, entry: SlashEntry, query: string) => {
    const plain = entry.hint
      ? entry.usage.slice(0, entry.usage.length - entry.hint.length).trimEnd()
      : entry.usage
    if (query && !query.includes(' ')) {
      const at = plain.toLowerCase().indexOf(query)
      if (at >= 0) {
        const bold = document.createElement('b')
        bold.textContent = plain.slice(at, at + query.length)
        name.append(
          document.createTextNode(plain.slice(0, at)),
          bold,
          document.createTextNode(plain.slice(at + query.length)),
        )
      } else {
        name.textContent = plain
      }
    } else {
      name.textContent = plain
    }
    if (entry.hint) {
      const hint = document.createElement('span')
      hint.className = 'quickforge-command-suggestion-hint'
      hint.textContent = ` ${entry.hint}`
      name.append(hint)
    }
  }

  const appendEntryRow = (suggestions: CommandSuggestionElement, entry: SlashEntry, query: string) => {
    const item = document.createElement('button') as SlashRowElement
    item.type = 'button'
    item.className = 'quickforge-command-suggestion-item'
    item.dataset.quickforgeCommandName = entry.name
    item.dataset.quickforgeInsert = entry.insertText
    item.setAttribute('role', 'option')
    item.__quickforgeSlashEntry = entry
    item.innerHTML = `
          <span class="quickforge-command-suggestion-icon quickforge-command-suggestion-icon-${entry.kind}">${kindIcon(entry.kind)}</span>
          <span class="quickforge-command-suggestion-name"></span>
          <span class="quickforge-command-suggestion-description"></span>
        `
    appendUsageText(item.querySelector<HTMLElement>('.quickforge-command-suggestion-name')!, entry, query)
    item.querySelector<HTMLElement>('.quickforge-command-suggestion-description')!.textContent = entry.description
    item.onpointerdown = (event) => {
      event.preventDefault()
      event.stopPropagation()
      insertEntryIntoComposer(entry)
    }
    suggestions.append(item)
  }

  const appendFoot = (suggestions: CommandSuggestionElement) => {
    const foot = document.createElement('div')
    foot.className = 'quickforge-command-suggestions-foot'
    foot.setAttribute('role', 'presentation')
    const segments: Array<{ keys: string[]; label: string }> = [
      { keys: ['↑', '↓'], label: t('slashHintNavigate') },
      { keys: ['Tab'], label: t('slashHintComplete') },
      { keys: ['Enter'], label: t('slashHintSend') },
      { keys: ['Esc'], label: t('slashHintClose') },
    ]
    for (const { keys, label } of segments) {
      const segment = document.createElement('span')
      for (const key of keys) {
        const kbd = document.createElement('kbd')
        kbd.textContent = key
        segment.append(kbd)
      }
      segment.append(document.createTextNode(label))
      foot.append(segment)
    }
    suggestions.append(foot)
  }

  /** 在目录中按 name 精确查找（skill 名规范化小写比较）。 */
  const invocationInCatalog = (invocation: SlashInvocation): boolean =>
    invocation.kind === 'skill'
      ? (catalog?.skills ?? []).some((skill) => skill.name.toLowerCase() === invocation.name.toLowerCase())
      : (catalog?.agents ?? []).some((agent) => agent.name === invocation.name)

  const update = (value?: string) => {
    const editor = panel.querySelector<MessageEditorElement>('message-editor')
    const textarea = editor?.querySelector<HTMLTextAreaElement>('textarea')
    const text = value ?? readComposerText()
    const existing = suggestionsElement()

    // Slash 选中态 chip 优先于菜单：先同步覆盖层（前缀失配自毁、文本不动），再尝试
    // 自动 engage（草稿恢复 / 手输完整命令也生效），激活时菜单不再弹出。
    chip.update(text)
    if (
      !chip.isActive() &&
      catalogState === 'ready' &&
      catalog &&
      (catalog.skills.length > 0 || catalog.agents.length > 0)
    ) {
      const parsed = parseSlashInvocationPrefix(text)
      if (parsed && !chip.isDismissed(parsed.cmd) && invocationInCatalog(parsed)) chip.engage(parsed)
    }
    if (chip.isActive()) {
      existing?.remove()
      menuOpenAtLastUpdate = false
      return
    }

    if (!editor || !textarea || !text.startsWith('/')) {
      existing?.remove()
      menuOpenAtLastUpdate = false
      return
    }

    // A fresh open (the menu was closed at the previous update) re-arms a
    // failed catalog load for exactly one retry.
    if (!menuOpenAtLastUpdate && catalogState === 'error') catalogState = 'idle'
    menuOpenAtLastUpdate = true

    if (catalogState === 'idle') startCatalogLoad()

    const query = text.slice(1).trim().toLowerCase()
    const loading = catalogState === 'loading'
    const groups = [
      { key: 'command' as const, label: t('slashGroupCommands'), entries: filterEntries(commandEntries(), query) },
      { key: 'skill' as const, label: t('slashGroupSkills'), entries: filterEntries(skillEntries(), query) },
      { key: 'agent' as const, label: t('slashGroupAgents'), entries: filterEntries(agentEntries(), query) },
    ]

    if (groups.every((group) => group.entries.length === 0 && !(loading && group.key !== 'command'))) {
      existing?.remove()
      menuOpenAtLastUpdate = false
      return
    }

    const suggestions = existing ?? document.createElement('div') as CommandSuggestionElement
    suggestions.className = 'quickforge-command-suggestions'
    suggestions.setAttribute('role', 'listbox')
    if (loading) suggestions.setAttribute('aria-busy', 'true')
    else suggestions.removeAttribute('aria-busy')
    suggestions.innerHTML = ''

    for (const group of groups) {
      if (group.key !== 'command' && loading) {
        appendGroupHead(suggestions, group.label, '…')
        appendSkeletonRows(suggestions, group.key)
        continue
      }
      if (group.entries.length === 0) continue
      appendGroupHead(suggestions, group.label, String(group.entries.length))
      for (const entry of group.entries) appendEntryRow(suggestions, entry, query)
    }

    appendFoot(suggestions)

    if (!existing) {
      editor.parentElement?.insertBefore(suggestions, editor)
    }

    setActiveRow(visibleRows(), 0)

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
      const menuOpen = Boolean(suggestionsElement())
      const currentText = editor?.value ?? commandTextarea.value ?? ''
      if (event.key === 'Escape') {
        if (menuOpen) remove()
        // Esc 退出 chip 选中态（保留文本，前缀在变化前不再自动 engage）。
        if (chip.isActive()) chip.clear()
        return
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && menuOpen && currentText.startsWith('/')) {
        event.preventDefault()
        const rows = visibleRows()
        if (rows.length === 0) return
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const next = (activeRowIndex() + delta + rows.length) % rows.length
        setActiveRow(rows, next)
        return
      }
      if (event.key === 'Backspace') {
        // 退格到 chip 右边界：一次删除整段命令前缀（等效移除标签）。
        const invocation = chip.getInvocation()
        if (!invocation || !slashInvocationPrefixMatches(currentText, invocation.cmd)) return
        const caret = commandTextarea.selectionStart
        if (caret !== invocation.cmd.length || commandTextarea.selectionEnd !== caret) return
        event.preventDefault()
        event.stopPropagation()
        chip.removePrefix()
        return
      }
      if (event.key !== 'Tab') return
      if (!currentText.startsWith('/') || event.shiftKey) return
      if (!menuOpen) return
      const active = visibleRows()[activeRowIndex()]
      const entry = active?.__quickforgeSlashEntry
      if (!entry) return
      event.preventDefault()
      event.stopPropagation()
      insertEntryIntoComposer(entry)
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
