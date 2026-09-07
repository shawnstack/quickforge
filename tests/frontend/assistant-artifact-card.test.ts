import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/components/chat/panel-decoration/assistant-artifact-card.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

describe('assistant artifact card contract', () => {
  it('exports an idempotent final-assistant sync entry point and filters supported sources', () => {
    expect(source).toContain('export function syncAssistantArtifactCard')
    expect(source).toContain('extractCurrentTurnArtifacts(messages')
    expect(source).toContain("['write_file', 'edit_file', 'present_files']")
    expect(source).toContain('removeArtifactCards(panel)')
    expect(source).toContain('if (streaming) return')
  })

  it('keeps the card before message actions and preserves the preview callback chain', () => {
    expect(source).toContain("find((candidate) => candidate.parentElement === lastAssistantElement)")
    expect(source).toContain('lastAssistantElement.insertBefore(card, actions)')
    expect(source).toContain('onOpenFilePreview(previewArtifact.path ?? \'\')')
  })

  it('renders the design-mockup card structure without rollback controls', () => {
    for (const className of [
      'quickforge-assistant-artifact-card-icon',
      'quickforge-assistant-artifact-card-heading',
      'quickforge-assistant-artifact-card-description',
      'quickforge-assistant-artifact-card-total',
      'quickforge-assistant-artifact-card-type',
      'quickforge-assistant-artifact-card-file-name',
      'quickforge-assistant-artifact-card-meta',
      'quickforge-assistant-artifact-card-file-stats',
      'quickforge-assistant-artifact-card-open',
      'quickforge-assistant-artifact-card-footer',
      'quickforge-assistant-artifact-card-scope',
      'quickforge-assistant-artifact-card-detail-body',
    ]) expect(source).toContain(className)
    expect(source).not.toContain('rollback')
  })

  it('keeps card surfaces and flex layouts explicit and motion tokenized', () => {
    const card = css.match(/\.quickforge-assistant-artifact-card\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(card).toMatch(/border:\s*1px\s+solid/)
    expect(card).toMatch(/background:\s*var\(--card\)/)
    expect(card).toMatch(/box-shadow:/)
    expect(card).toMatch(/border-radius:/)
    for (const selector of ['header', 'file', 'footer']) {
      expect(css).toMatch(new RegExp(`\\.quickforge-assistant-artifact-card-${selector}\\s*\\{[^}]*display:\\s*flex`))
    }
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-details\s*\{[^}]*display:\s*flex/)
    expect(css).toContain('var(--quickforge-dur-fast) var(--quickforge-ease-out)')
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-open:hover\s*\{[^}]*background:/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-open:active\s*\{[^}]*transform:/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-toggle:hover\s*\{[^}]*color:/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-toggle:active\s*\{[^}]*transform:/)
  })

  it('keeps file list visible by default and toggles details with accessible semantics', () => {
    expect(source).toContain('details.hidden = false')
    expect(source).toContain('detailBody.hidden = true')
    expect(source).toContain("toggle.setAttribute('aria-expanded', 'false')")
    expect(source).toContain('detailBody.hidden = expanded')
    expect(source).toContain("toggle.textContent = expanded ? t('assistantArtifactDetailsExpand') : t('assistantArtifactDetailsCollapse')")
    expect(css).toContain('.quickforge-assistant-artifact-card-details[hidden]')
    expect(css).toContain('.quickforge-assistant-artifact-card-detail-body[hidden]')
  })

  it('wires preview through message-actions, ChatPanelHost, App, and CSS', () => {
    const actions = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
    const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
    const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    expect(actions).toContain('onOpenFilePreview?: (relativePath: string) => void')
    expect(actions).toContain('onOpenFilePreview,')
    expect(host).toContain('onOpenFilePreview: props.onOpenFilePreview')
    expect(app).toContain('openFilePreviewFromArtifactCard')
    expect(app).toContain('onOpenFilePreview={openFilePreviewFromArtifactCard}')
    expect(css).toContain('.quickforge-assistant-artifact-card')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('removes the old summary strip surface while keeping server rollback references', () => {
    const panelDecoration = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
    const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
    const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
    expect(panelDecoration).not.toContain('change-summary-strip')
    expect(host).not.toContain('changeSummaryStrip')
    expect(css).not.toContain('quickforge-change-summary')
    expect(i18n).not.toContain('changeSummary')
    expect(i18n).toContain('assistantArtifactsDescription')
  })
})
