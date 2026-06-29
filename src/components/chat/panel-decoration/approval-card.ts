import { t } from '@/lib/i18n'
import { getCachedToolDisplaySettings } from '@/lib/tool-display-settings'
import { buildInlineDiff, buildInlinePreview, escapeHtml } from './html'

export type ApprovalCardDeps = {
  panel: HTMLElement
  onApprove: () => Promise<void> | void
  onReject: () => Promise<void> | void
}

export type ToolApprovalSource = {
  type?: string
  subagent?: string
  label?: string
  sessionId?: string
}

const APPROVAL_CARD_SELECTOR = '.quickforge-approval-card'

function parseMcpToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>) {
  if (typeof args.summary === 'string') return args.summary
  if (toolName === 'run_command' && typeof args.command === 'string') return args.command
  if (toolName === 'activate_skill' && typeof args.name === 'string') return args.name
  if (toolName === 'read_skill_resource' && typeof args.path === 'string') return args.path
  if (typeof args.path === 'string') return args.path
  if (typeof args.query === 'string') return args.query
  if (typeof args.name === 'string') return args.name
  return ''
}

function hiddenToolArgsPreview(toolName: string, args: Record<string, unknown>) {
  const summary = summarizeToolArgs(toolName, args)
  return `
    ${summary ? `<div class="text-xs text-muted-foreground mb-1">${escapeHtml(t('toolArgsSummary'))}: ${escapeHtml(summary)}</div>` : ''}
    <div class="text-xs bg-background border rounded p-2 text-muted-foreground">${escapeHtml(t('toolDetailsHidden'))}</div>
  `
}

export function injectApprovalCard(
  deps: ApprovalCardDeps,
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown>,
  source?: ToolApprovalSource,
) {
  const { panel, onApprove, onReject } = deps

  // If a card for the same tool call already exists, skip recreation.
  // This prevents the MutationObserver → decorate() → injectApprovalCard
  // loop from destroying and recreating the card every animation frame,
  // which would make the Accept/Reject buttons unclickable.
  const existingCard = panel.querySelector(`.quickforge-approval-card[data-tool-call-id="${CSS.escape(toolCallId)}"]`)
  if (existingCard) return

  // Remove any card for a different tool call (shouldn't normally happen)
  removeApprovalCard(panel)

  const card = document.createElement('div')
  card.className = 'quickforge-approval-card pointer-events-auto mb-4 mx-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-4'
  card.dataset.toolCallId = toolCallId

  const mcpTool = parseMcpToolName(toolName)
  const displayToolName = mcpTool ? `MCP · ${mcpTool.serverName} · ${mcpTool.toolName}` : toolName

  const sourceLabel = source?.type === 'subagent'
    ? (source.label || source.subagent || 'Subagent')
    : ''

  // Header
  const header = document.createElement('div')
  header.className = 'flex items-center gap-2 mb-3 text-sm font-medium text-amber-800 dark:text-amber-300'
  header.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  header.append(` ${sourceLabel ? t('subagentToolApprovalWaiting', { source: sourceLabel, toolName: displayToolName }) : t('toolApprovalWaiting', { toolName: displayToolName })}`)
  card.append(header)

  if (sourceLabel) {
    const sourceNote = document.createElement('div')
    sourceNote.className = 'mb-3 rounded-md border border-amber-200/80 bg-background/65 px-2.5 py-1.5 text-xs text-amber-800/85 dark:border-amber-800/70 dark:text-amber-200/85'
    sourceNote.textContent = t('toolApprovalSourceSubagent', { source: sourceLabel })
    card.append(sourceNote)
  }

  // Preview
  const preview = document.createElement('div')
  preview.className = 'quickforge-approval-preview mb-3'

  const showToolDetails = getCachedToolDisplaySettings().showToolDetails

  if (mcpTool) {
    preview.innerHTML = `
      <div class="rounded-md border bg-background/70 p-2 text-xs text-muted-foreground">
        <div><span class="font-medium text-foreground">Source:</span> MCP</div>
        <div><span class="font-medium text-foreground">Server:</span> ${escapeHtml(mcpTool.serverName)}</div>
        <div><span class="font-medium text-foreground">Tool:</span> ${escapeHtml(mcpTool.toolName)}</div>
      </div>
      ${showToolDetails
        ? `<pre class="mt-2 text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(JSON.stringify(args, null, 2))}</pre>`
        : hiddenToolArgsPreview(toolName, args)}
    `
  } else if (toolName === 'write_file') {
    const filePath = String(args.path ?? '')
    const content = String(args.content ?? '')
    const truncated = content.length > 800
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">📁 ${escapeHtml(filePath)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${buildInlinePreview(content.slice(0, 800))}${truncated ? `\n${escapeHtml(t('toolApprovalTruncated'))}` : ''}</pre>
    `
  } else if (toolName === 'edit_file') {
    const filePath = String(args.path ?? '')
    const oldText = String(args.oldText ?? '')
    const newText = String(args.newText ?? '')
    const diffLines = buildInlineDiff(oldText, newText)
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">📁 ${escapeHtml(filePath)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${diffLines}</pre>
    `
  } else if (toolName === 'run_command') {
    const command = String(args.command ?? '')
    const timeout = '30m'
    preview.innerHTML = `
      <div class="text-xs text-muted-foreground mb-1">⏱️ ${t('toolApprovalTimeout')}: ${escapeHtml(timeout)}</div>
      <pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">$ ${escapeHtml(command)}</pre>
    `
  } else if (typeof args.description === 'string') {
    preview.innerHTML = `<div class="text-xs bg-background border rounded p-2 text-muted-foreground">${escapeHtml(args.description)}</div>`
  } else {
    preview.innerHTML = showToolDetails
      ? `<pre class="text-xs bg-background border rounded p-2 max-h-40 overflow-auto font-mono whitespace-pre-wrap">${escapeHtml(JSON.stringify(args, null, 2))}</pre>`
      : hiddenToolArgsPreview(toolName, args)
  }
  card.append(preview)

  // Buttons
  const errorMessage = document.createElement('div')
  errorMessage.className = 'mb-2 hidden text-xs text-red-700 dark:text-red-400'
  card.append(errorMessage)

  const actions = document.createElement('div')
  actions.className = 'flex items-center gap-2'

  const setSubmitting = (submitting: boolean) => {
    acceptBtn.disabled = submitting
    rejectBtn.disabled = submitting
    acceptBtn.classList.toggle('opacity-60', submitting)
    rejectBtn.classList.toggle('opacity-60', submitting)
    acceptBtn.textContent = submitting ? t('toolApprovalSubmitting') : t('toolApprovalAccept')
  }

  const submitDecision = async (action: () => Promise<void> | void) => {
    errorMessage.classList.add('hidden')
    errorMessage.textContent = ''
    setSubmitting(true)
    try {
      await action()
    } catch (error) {
      errorMessage.textContent = error instanceof Error ? error.message : t('toolApprovalFailed')
      errorMessage.classList.remove('hidden')
      setSubmitting(false)
    }
  }

  const acceptBtn = document.createElement('button')
  acceptBtn.type = 'button'
  acceptBtn.className = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:cursor-not-allowed'
  acceptBtn.textContent = t('toolApprovalAccept')
  acceptBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); void submitDecision(onApprove) })

  const rejectBtn = document.createElement('button')
  rejectBtn.type = 'button'
  rejectBtn.className = 'inline-flex items-center gap-1.5 rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer disabled:cursor-not-allowed'
  rejectBtn.textContent = t('toolApprovalReject')
  rejectBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); void submitDecision(onReject) })

  actions.append(acceptBtn, rejectBtn)
  card.append(actions)

  // Insert at the bottom of the message list
  const messageList = panel.querySelector('message-list')
  if (messageList) {
    messageList.append(card)
  } else {
    // Fallback: append to agent-interface
    const agentInterface = panel.querySelector('agent-interface')
    agentInterface?.append(card)
  }

  // Scroll into view
  card.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

export function removeApprovalCard(panel: HTMLElement) {
  panel.querySelectorAll(APPROVAL_CARD_SELECTOR).forEach((el) => el.remove())
}
