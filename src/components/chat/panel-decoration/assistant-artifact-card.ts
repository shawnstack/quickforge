import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { extractCurrentTurnArtifacts, type AiTurnArtifact, type AiTurnArtifactKind } from '@/lib/tool-artifacts'
import { t } from '@/lib/i18n'
import type { MessageWithUsage } from '../chat-utils'

export const ASSISTANT_ARTIFACT_CARD_CLASS = 'quickforge-assistant-artifact-card'

const INCLUDED_SOURCES = new Set<AiTurnArtifact['source']>(['write_file', 'edit_file', 'present_files'])

const ARTIFACT_KIND_LABELS: Record<AiTurnArtifactKind, string> = {
  html: 'HTML',
  image: 'IMG',
  markdown: 'MD',
  code: 'CODE',
  pdf: 'PDF',
  docx: 'DOCX',
  excel: 'XLSX',
  unknown: 'FILE',
}

type ArtifactCardDeps = {
  panel: HTMLElement
  displayEntries: Array<{ message: MessageWithUsage }>
  messageElements: HTMLElement[]
  messages: MessageWithUsage[]
  streaming: boolean
  onOpenFilePreview?: (relativePath: string) => void
}

function fileName(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

function fileDirectory(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : '.'
}

function artifactKindLabel(artifact: AiTurnArtifact) {
  return ARTIFACT_KIND_LABELS[artifact.kind ?? 'unknown']
}

function artifactType(artifact: AiTurnArtifact) {
  if (artifact.source === 'present_files') return t('assistantArtifactPresented')
  if (artifact.source === 'edit_file') return t('assistantArtifactEdited')
  return t('assistantArtifactCreated')
}

function diffParts(artifact: AiTurnArtifact) {
  if (artifact.source === 'present_files') return []
  return [
    typeof artifact.addedLines === 'number' ? { className: 'quickforge-assistant-artifact-card-added', text: `+${artifact.addedLines}` } : null,
    typeof artifact.removedLines === 'number' ? { className: 'quickforge-assistant-artifact-card-removed', text: `-${artifact.removedLines}` } : null,
  ].filter((part): part is { className: string; text: string } => Boolean(part))
}

function diffTotal(artifacts: AiTurnArtifact[]) {
  return artifacts.reduce((total, artifact) => ({
    added: total.added + (typeof artifact.addedLines === 'number' ? artifact.addedLines : 0),
    removed: total.removed + (typeof artifact.removedLines === 'number' ? artifact.removedLines : 0),
  }), { added: 0, removed: 0 })
}

function appendDiffStats(container: HTMLElement, artifact: AiTurnArtifact) {
  diffParts(artifact).forEach((part) => {
    const diffElement = document.createElement('span')
    diffElement.className = `quickforge-assistant-artifact-card-diff ${part.className}`
    diffElement.textContent = part.text
    container.append(diffElement)
  })
}

function createDiffStat(className: string, text: string) {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

function createArtifactCard(artifacts: AiTurnArtifact[], onOpenFilePreview?: (relativePath: string) => void) {
  const card = document.createElement('section')
  card.className = ASSISTANT_ARTIFACT_CARD_CLASS
  card.dataset.quickforgeArtifactCard = 'true'
  card.dataset.expanded = 'false'
  card.setAttribute('aria-label', t('assistantArtifactsTitle'))

  const total = diffTotal(artifacts)
  const previewArtifact = artifacts.find((artifact) => artifact.preview && artifact.path)

  const header = document.createElement('div')
  header.className = 'quickforge-assistant-artifact-card-header'

  const icon = document.createElement('span')
  icon.className = 'quickforge-assistant-artifact-card-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6.8A1.8 1.8 0 0 0 5 3.8v16.4A1.8 1.8 0 0 0 6.8 22h10.4a1.8 1.8 0 0 0 1.8-1.8V7z"/><path d="M14 2v5h5M8.5 12h7M8.5 16h5"/></svg>'

  const heading = document.createElement('div')
  heading.className = 'quickforge-assistant-artifact-card-heading'
  const title = document.createElement('h3')
  title.className = 'quickforge-assistant-artifact-card-title'
  title.textContent = t('assistantArtifactsTitle', { count: artifacts.length })
  const description = document.createElement('p')
  description.className = 'quickforge-assistant-artifact-card-description'
  description.textContent = t('assistantArtifactsDescription')
  const totals = document.createElement('div')
  totals.className = 'quickforge-assistant-artifact-card-total'
  const hasDiff = artifacts.some((artifact) => artifact.source !== 'present_files' && (
    typeof artifact.addedLines === 'number' || typeof artifact.removedLines === 'number'
  ))
  if (hasDiff) {
    totals.append(
      createDiffStat('quickforge-assistant-artifact-card-added', `+${total.added}`),
      createDiffStat('quickforge-assistant-artifact-card-removed', `-${total.removed}`),
    )
  }
  heading.append(title, description, totals)

  header.append(icon, heading)
  if (previewArtifact && onOpenFilePreview) {
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'quickforge-assistant-artifact-card-open'
    open.textContent = t('assistantArtifactOpen')
    open.title = t('assistantArtifactOpen')
    open.setAttribute('aria-label', t('assistantArtifactOpen'))
    open.addEventListener('click', (event) => {
      event.stopPropagation()
      onOpenFilePreview(previewArtifact.path ?? '')
    })
    header.append(open)
  }

  const details = document.createElement('div')
  details.className = 'quickforge-assistant-artifact-card-details'
  details.hidden = false
  artifacts.forEach((artifact) => {
    const path = artifact.path ?? ''
    const row = document.createElement('div')
    row.className = 'quickforge-assistant-artifact-card-file'

    const badge = document.createElement('span')
    badge.className = 'quickforge-assistant-artifact-card-type'
    badge.textContent = artifactKindLabel(artifact)
    badge.title = artifact.kind ?? 'unknown'

    const info = document.createElement('div')
    info.className = 'quickforge-assistant-artifact-card-file-info'
    const name = document.createElement('div')
    name.className = 'quickforge-assistant-artifact-card-file-name'
    name.textContent = fileName(path)
    name.title = path
    const meta = document.createElement('div')
    meta.className = 'quickforge-assistant-artifact-card-meta'
    meta.textContent = `${fileDirectory(path)} · ${artifact.description || artifactType(artifact)}`
    info.append(name, meta)

    const stats = document.createElement('div')
    stats.className = 'quickforge-assistant-artifact-card-file-stats'
    appendDiffStats(stats, artifact)
    row.append(badge, info, stats)
    details.append(row)
  })

  const detailBody = document.createElement('div')
  detailBody.className = 'quickforge-assistant-artifact-card-detail-body'
  detailBody.textContent = artifacts.map((artifact) => `${artifactType(artifact)} · ${artifact.path ?? ''}`).join('\n')
  detailBody.hidden = true

  const footer = document.createElement('div')
  footer.className = 'quickforge-assistant-artifact-card-footer'
  const scope = document.createElement('span')
  scope.className = 'quickforge-assistant-artifact-card-scope'
  scope.textContent = t('assistantArtifactScope')
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'quickforge-assistant-artifact-card-toggle'
  toggle.textContent = t('assistantArtifactDetailsExpand')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.addEventListener('click', (event) => {
    event.stopPropagation()
    const expanded = card.dataset.expanded === 'true'
    card.dataset.expanded = String(!expanded)
    detailBody.hidden = expanded
    toggle.setAttribute('aria-expanded', String(!expanded))
    toggle.textContent = expanded ? t('assistantArtifactDetailsExpand') : t('assistantArtifactDetailsCollapse')
  })
  footer.append(scope, toggle)

  card.append(header, details, detailBody, footer)
  return card
}

function removeArtifactCards(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>(`[data-quickforge-artifact-card="true"]`).forEach((card) => card.remove())
}

/** Sync the current-turn artifact card. Only the final rendered assistant receives it. */
export function syncAssistantArtifactCard(deps: ArtifactCardDeps) {
  const { panel, displayEntries, messageElements, messages, streaming, onOpenFilePreview } = deps
  removeArtifactCards(panel)
  if (streaming) return

  const lastAssistantIndex = (() => {
    for (let index = displayEntries.length - 1; index >= 0; index -= 1) {
      if (displayEntries[index].message.role === 'assistant') return index
    }
    return -1
  })()
  if (lastAssistantIndex < 0) return
  const lastAssistant = displayEntries[lastAssistantIndex]
  const lastAssistantElement = messageElements[lastAssistantIndex]
  if (!lastAssistantElement || lastAssistant.message.role !== 'assistant') return

  const artifacts = extractCurrentTurnArtifacts(messages as unknown as AgentMessage[])
    .filter((artifact) => Boolean(artifact.path) && INCLUDED_SOURCES.has(artifact.source))
  if (artifacts.length === 0) return

  const card = createArtifactCard(artifacts, onOpenFilePreview)
  const actions = Array.from(lastAssistantElement.querySelectorAll<HTMLElement>('.quickforge-message-actions'))
    .find((candidate) => candidate.parentElement === lastAssistantElement)
  if (actions) lastAssistantElement.insertBefore(card, actions)
  else lastAssistantElement.append(card)
}

export function decorateAssistantArtifactCard(deps: ArtifactCardDeps) {
  syncAssistantArtifactCard(deps)
}
