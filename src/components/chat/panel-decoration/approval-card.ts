import { t } from '@/lib/i18n'
import type { MessageWithUsage } from '../chat-utils'
import { buildInlineDiff, buildInlinePreview, escapeHtml } from './html'

export type ApprovalCardTone = 'warning' | 'info'

export type ApprovalCardCopy = {
  status?: string
  title?: string
  risk?: string
  approve?: string
  reject?: string
}

export type ApprovalCardDeps = {
  panel: HTMLElement
  onApprove: () => Promise<void> | void
  onReject: () => Promise<void> | void
  tone?: ApprovalCardTone
  copy?: ApprovalCardCopy
  disabled?: boolean
  disabledReason?: string
  /**
   * Messages aligned with the rendered DOM (the windowed view when windowing
   * is active). Only needed for auto-compact approvals.
   */
  getMessages?: () => MessageWithUsage[]
  /**
   * Number of recent turns the compaction would keep. When set, the card is
   * inserted at the boundary of the kept turns instead of the list bottom.
   */
  keepRecentTurns?: number
}

export type ToolApprovalSource = {
  type?: string
  subagent?: string
  label?: string
  sessionId?: string
}

type Translate = typeof t

type ApprovalCardModelInput = {
  toolName: string
  args: Record<string, unknown>
  source?: ToolApprovalSource
  tone?: ApprovalCardTone
  copy?: ApprovalCardCopy
  disabled?: boolean
  disabledReason?: string
  translate?: Translate
}

export type ApprovalCardDisplayModel = {
  tone: ApprovalCardTone
  status: string
  title: string
  risk: string
  approveLabel: string
  rejectLabel: string
  toolDisplayName: string
  badges: string[]
  criticalParameters: Array<{ label: string; value: string }>
  keySummary: string
  details: string
  disabled: boolean
  disabledReason: string
  integration: 'mcp' | 'plugin' | null
}

export function buildApprovalCardDisplaySignature(model: ApprovalCardDisplayModel) {
  return JSON.stringify({
    tone: model.tone,
    disabled: model.disabled,
    disabledReason: model.disabledReason,
    copy: {
      status: model.status,
      title: model.title,
      risk: model.risk,
      approve: model.approveLabel,
      reject: model.rejectLabel,
    },
    toolDisplayName: model.toolDisplayName,
    badges: model.badges,
    criticalParameters: model.criticalParameters,
    keySummary: model.keySummary,
    details: model.details,
    integration: model.integration,
  })
}

const APPROVAL_CARD_SELECTOR = '.quickforge-approval-card'

const BUILTIN_TOOL_LABELS = {
  manage_global_memory: 'manageGlobalMemory',
  read_file: 'readFile',
  grep_files: 'searchFiles',
  write_file: 'writeFile',
  edit_file: 'editFile',
  run_command: 'runCommand',
  present_files: 'presentFiles',
  activate_skill: 'activateSkill',
  read_skill_resource: 'readSkillResource',
  run_subagent: 'runSubagent',
  generate_image: 'generateImage',
} as const satisfies Record<string, Parameters<Translate>[0]>

export function parseMcpToolName(toolName: string) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

export function parsePluginToolName(toolName: string) {
  if (typeof toolName !== 'string' || !toolName.startsWith('plugin__')) return null
  const rest = toolName.slice('plugin__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    pluginName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

export function getToolApprovalDisplayName(toolName: string, translate: Translate = t) {
  const builtinKey = BUILTIN_TOOL_LABELS[toolName as keyof typeof BUILTIN_TOOL_LABELS]
  if (builtinKey) return translate(builtinKey)
  const mcpTool = parseMcpToolName(toolName)
  if (mcpTool) return `MCP · ${mcpTool.serverName} · ${mcpTool.toolName}`
  const pluginTool = parsePluginToolName(toolName)
  if (pluginTool) return `Plugin · ${pluginTool.pluginName} · ${pluginTool.toolName}`
  return toolName
}

export function summarizeToolArgs(toolName: string, args: Record<string, unknown>) {
  if (typeof args.summary === 'string') return args.summary
  if (toolName === 'run_command' && typeof args.command === 'string') return args.command
  if (toolName === 'activate_skill' && typeof args.name === 'string') return args.name
  if (toolName === 'read_skill_resource' && typeof args.path === 'string') return args.path
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return args.query
  if (typeof args.name === 'string') return args.name
  return ''
}

function stringifyArgs(args: Record<string, unknown>) {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

export function buildApprovalCardDisplayModel({
  toolName,
  args,
  source,
  tone = 'warning',
  copy,
  disabled = false,
  disabledReason = '',
  translate = t,
}: ApprovalCardModelInput): ApprovalCardDisplayModel {
  const mcpTool = parseMcpToolName(toolName)
  const pluginTool = parsePluginToolName(toolName)
  const toolDisplayName = getToolApprovalDisplayName(toolName, translate)
  const criticalParameters: Array<{ label: string; value: string }> = []

  if (mcpTool) {
    criticalParameters.push(
      { label: translate('toolApprovalSource'), value: 'MCP' },
      { label: translate('toolApprovalServer'), value: mcpTool.serverName },
      { label: translate('toolApprovalTool'), value: mcpTool.toolName },
    )
  } else if (pluginTool) {
    criticalParameters.push(
      { label: translate('toolApprovalSource'), value: 'Plugin' },
      { label: translate('toolApprovalPlugin'), value: pluginTool.pluginName },
      { label: translate('toolApprovalTool'), value: pluginTool.toolName },
    )
  }

  if (typeof args.path === 'string' && args.path) {
    criticalParameters.push({ label: translate('toolApprovalPath'), value: args.path })
  }
  if (typeof args.command === 'string' && args.command) {
    criticalParameters.push({ label: translate('toolApprovalCommand'), value: args.command })
  }

  const sourceLabel = source?.type === 'subagent'
    ? (source.label || source.subagent || 'Subagent')
    : ''
  const badges = [
    ...(mcpTool ? ['MCP'] : []),
    ...(pluginTool ? ['Plugin'] : []),
    ...(sourceLabel ? [sourceLabel] : []),
  ]
  const keepRecentTurns = typeof args.keepRecentTurns === 'number' ? args.keepRecentTurns : 0
  const risk = tone === 'info'
    ? translate('autoCompactApprovalRisk', { keepRecentTurns })
    : toolName === 'run_command'
      ? translate('toolApprovalRiskCommand')
      : toolName === 'write_file' || toolName === 'edit_file'
        ? translate('toolApprovalRiskFileChange')
        : mcpTool || pluginTool
          ? translate('toolApprovalRiskExternal')
          : translate('toolApprovalRiskGeneric')

  return {
    tone,
    status: copy?.status ?? (tone === 'info' ? translate('autoCompactApprovalStatus') : translate('toolApprovalNeedsConfirmation')),
    title: copy?.title ?? (tone === 'info' ? translate('autoCompactApprovalTitle') : toolDisplayName),
    risk: copy?.risk ?? risk,
    approveLabel: copy?.approve ?? (tone === 'info' ? translate('autoCompactApprovalAccept') : translate('toolApprovalAccept')),
    rejectLabel: copy?.reject ?? (tone === 'info' ? translate('autoCompactApprovalReject') : translate('toolApprovalReject')),
    toolDisplayName,
    badges,
    criticalParameters,
    keySummary: summarizeToolArgs(toolName, args),
    details: stringifyArgs(args),
    disabled,
    disabledReason: disabled ? (disabledReason || translate('toolApprovalDisabled')) : '',
    integration: mcpTool ? 'mcp' : pluginTool ? 'plugin' : null,
  }
}

function isDisplayMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments' || message.role === 'assistant'
}

function isUserMessage(message: MessageWithUsage) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

/**
 * Locate the DOM element before which the auto-compact approval card should
 * be inserted: the first message of the last `keepRecentTurns` user turns —
 * the boundary between context that would be compacted away and the recent
 * turns that are kept. `messages` must be aligned with the rendered DOM
 * (i.e. the windowed view when windowing is active). Returns null when no
 * sensible boundary exists.
 */
function findKeepBoundaryTarget(panel: HTMLElement, messages: MessageWithUsage[], keepRecentTurns: number) {
  if (keepRecentTurns <= 0 || messages.length === 0) return null

  const userTurnStarts: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (isUserMessage(messages[i])) userTurnStarts.push(i)
  }
  if (userTurnStarts.length === 0) return null

  const keep = Math.min(keepRecentTurns, userTurnStarts.length)
  const boundaryIndex = userTurnStarts[userTurnStarts.length - keep]

  const messageList = panel.querySelector('message-list')
  if (!messageList) return null
  const elements = Array.from(messageList.querySelectorAll<HTMLElement>('user-message, assistant-message'))
    .filter((element) => element.closest('message-list') === messageList)

  let displayIndex = 0
  for (let i = 0; i <= boundaryIndex; i++) {
    if (!isDisplayMessage(messages[i])) continue
    if (i === boundaryIndex) return elements[displayIndex] ?? null
    displayIndex += 1
  }
  return null
}

function statusIcon(tone: ApprovalCardTone) {
  if (tone === 'info') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>'
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
}

function buildImpactHtml(toolName: string, args: Record<string, unknown>, model: ApprovalCardDisplayModel) {
  const rows = model.criticalParameters.map(({ label, value }) => {
    if (toolName === 'run_command' && value === args.command) return ''
    return `<div class="quickforge-approval-impact-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  }).join('')

  let preview = ''
  if (toolName === 'run_command' && typeof args.command === 'string') {
    preview = `<pre class="quickforge-approval-code"><span class="quickforge-approval-prompt">$</span> ${escapeHtml(args.command)}</pre>`
  } else if (toolName === 'edit_file') {
    preview = `<pre class="quickforge-approval-code">${buildInlineDiff(String(args.oldText ?? ''), String(args.newText ?? ''))}</pre>`
  } else if (toolName === 'write_file' && typeof args.content === 'string') {
    const truncated = args.content.length > 800
    preview = `<pre class="quickforge-approval-code">${buildInlinePreview(args.content.slice(0, 800))}${truncated ? `\n${escapeHtml(t('toolApprovalTruncated'))}` : ''}</pre>`
  } else if (model.keySummary && !model.criticalParameters.some(({ value }) => value === model.keySummary)) {
    preview = `<pre class="quickforge-approval-code">${escapeHtml(model.keySummary)}</pre>`
  }

  return rows || preview ? `<div class="quickforge-approval-impact">${rows}${preview}</div>` : ''
}

export function injectApprovalCard(
  deps: ApprovalCardDeps,
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  source?: ToolApprovalSource,
) {
  const { panel, onApprove, onReject } = deps

  const model = buildApprovalCardDisplayModel({
    toolName,
    args,
    source,
    tone: deps.tone,
    copy: deps.copy,
    disabled: deps.disabled,
    disabledReason: deps.disabledReason,
  })
  const displaySignature = buildApprovalCardDisplaySignature(model)

  // Prevent the MutationObserver decoration loop from recreating an unchanged card.
  const existingCard = panel.querySelector<HTMLElement>(`.quickforge-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
  if (existingCard?.dataset.displaySignature === displaySignature) return

  removeApprovalCard(panel)

  const card = document.createElement('section')
  card.className = `quickforge-approval-card quickforge-approval-card--${model.tone}`
  card.dataset.toolCallId = toolCallId
  card.dataset.displaySignature = displaySignature

  const body = document.createElement('div')
  body.className = 'quickforge-approval-body'
  body.innerHTML = `
    <div class="quickforge-approval-status-row">
      <div class="quickforge-approval-status">${statusIcon(model.tone)}<span>${escapeHtml(model.status)}</span></div>
      ${model.badges.length ? `<div class="quickforge-approval-badges">${model.badges.map((badge) => `<span class="quickforge-approval-badge">${escapeHtml(badge)}</span>`).join('')}</div>` : ''}
    </div>
    <h3 class="quickforge-approval-title">${escapeHtml(model.title)}</h3>
    <p class="quickforge-approval-risk">${escapeHtml(model.risk)}</p>
    ${buildImpactHtml(toolName, args, model)}
  `
  card.append(body)

  const details = document.createElement('div')
  details.className = 'quickforge-approval-details'
  const detailsToggle = document.createElement('button')
  detailsToggle.type = 'button'
  detailsToggle.className = 'quickforge-approval-details-toggle'
  detailsToggle.setAttribute('aria-expanded', 'false')
  detailsToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  const detailsLabel = document.createElement('span')
  detailsLabel.textContent = t('toolApprovalViewDetails')
  detailsToggle.append(detailsLabel)
  const detailsContent = document.createElement('div')
  detailsContent.className = 'quickforge-approval-details-content'
  detailsContent.innerHTML = `<pre class="quickforge-approval-code">${escapeHtml(model.details)}</pre>`
  detailsToggle.addEventListener('click', (event) => {
    event.stopPropagation()
    const open = details.classList.toggle('quickforge-approval-details--open')
    detailsToggle.setAttribute('aria-expanded', String(open))
    detailsLabel.textContent = open ? t('toolApprovalHideDetails') : t('toolApprovalViewDetails')
  })
  details.append(detailsToggle, detailsContent)
  body.append(details)

  const message = document.createElement('div')
  message.className = 'quickforge-approval-message'
  if (model.disabledReason) {
    message.textContent = model.disabledReason
    message.classList.add('quickforge-approval-message--disabled')
  } else {
    message.hidden = true
  }
  body.append(message)

  const actions = document.createElement('div')
  actions.className = 'quickforge-approval-actions'
  const acceptBtn = document.createElement('button')
  const rejectBtn = document.createElement('button')

  acceptBtn.type = 'button'
  acceptBtn.className = 'quickforge-approval-button quickforge-approval-button--primary'
  acceptBtn.textContent = model.approveLabel
  rejectBtn.type = 'button'
  rejectBtn.className = 'quickforge-approval-button quickforge-approval-button--reject'
  rejectBtn.textContent = model.rejectLabel

  const setSubmitting = (submitting: boolean, activeButton?: HTMLButtonElement) => {
    acceptBtn.disabled = submitting || model.disabled
    rejectBtn.disabled = submitting || model.disabled
    acceptBtn.classList.toggle('quickforge-approval-button--loading', submitting && activeButton === acceptBtn)
    rejectBtn.classList.toggle('quickforge-approval-button--loading', submitting && activeButton === rejectBtn)
    if (submitting && activeButton) activeButton.textContent = t('toolApprovalSubmitting')
  }

  const submitDecision = async (action: () => Promise<void> | void, activeButton: HTMLButtonElement, defaultLabel: string) => {
    message.hidden = true
    message.textContent = ''
    message.classList.remove('quickforge-approval-message--disabled')
    setSubmitting(true, activeButton)
    try {
      await action()
    } catch (error) {
      message.textContent = error instanceof Error && error.message ? error.message : t('toolApprovalFailed')
      message.hidden = false
      activeButton.textContent = t('toolApprovalRetry')
      const otherButton = activeButton === acceptBtn ? rejectBtn : acceptBtn
      otherButton.textContent = activeButton === acceptBtn ? model.rejectLabel : model.approveLabel
      setSubmitting(false)
      activeButton.textContent = t('toolApprovalRetry')
      return
    }
    activeButton.textContent = defaultLabel
  }

  acceptBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    void submitDecision(onApprove, acceptBtn, model.approveLabel)
  })
  rejectBtn.addEventListener('click', (event) => {
    event.stopPropagation()
    event.preventDefault()
    void submitDecision(onReject, rejectBtn, model.rejectLabel)
  })
  setSubmitting(false)

  actions.append(rejectBtn, acceptBtn)
  body.append(actions)

  // Auto-compact approvals remain at the boundary of the kept recent turns.
  const keepBoundaryTarget = deps.keepRecentTurns
    ? findKeepBoundaryTarget(panel, deps.getMessages?.() ?? [], deps.keepRecentTurns)
    : null
  const messageList = panel.querySelector('message-list')
  if (keepBoundaryTarget) {
    keepBoundaryTarget.before(card)
  } else if (messageList) {
    messageList.append(card)
  } else {
    panel.querySelector('agent-interface')?.append(card)
  }

  if (!keepBoundaryTarget) card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

export function removeApprovalCard(panel: HTMLElement) {
  panel.querySelectorAll(APPROVAL_CARD_SELECTOR).forEach((element) => element.remove())
}
