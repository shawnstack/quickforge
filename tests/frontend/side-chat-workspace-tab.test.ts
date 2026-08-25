import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizePersistedPanelTabs,
  serializePanelTabs,
  type WorkspacePanelTab,
} from '../../src/components/workspace/workspace-inspector-tabs'
import {
  QUICKFORGE_CHAT_HARNESS_CAPABILITIES,
  SIDE_CHAT_CAPABILITIES,
  SIDE_CHAT_UI_CAPABILITIES,
} from '../../src/lib/chat-harness-capabilities'

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const inspectorSource = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../../src/components/workspace/side-chat-client.ts', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const decorationSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const messageActionsSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
const surfaceSource = readFileSync(new URL('../../src/components/chat/ChatConversationSurface.tsx', import.meta.url), 'utf8')
const sideChatContentSource = readFileSync(new URL('../../src/components/workspace/SideChatTabContent.tsx', import.meta.url), 'utf8')
const rendererIsolationSource = readFileSync(new URL('../../src/components/chat/side-chat-renderer-isolation.ts', import.meta.url), 'utf8')

const allDisabledCapabilities = Object.fromEntries(
  Object.keys(QUICKFORGE_CHAT_HARNESS_CAPABILITIES).map((key) => [key, false]),
)

describe('Workspace side chat tab', () => {
  it('is a single runtime-only tab excluded from persistence', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'files-1', kind: 'files' },
      { id: 'side-chat-2', kind: 'side-chat' },
    ]
    expect(serializePanelTabs(tabs, 'side-chat-2').tabs).toEqual([{ id: 'files-1', kind: 'files' }])
    expect(normalizePersistedPanelTabs([{ id: 'side-chat-1', kind: 'side-chat' }])).toEqual([])
    expect(inspectorSource).toContain("kind === 'review' || kind === 'side-chat'")
  })

  it('holds stable agent/text memory and clears both on destructive lifecycles', () => {
    expect(appSource).toContain('useState(() => new SideChatAgent(')
    expect(appSource).toContain("const sideChatDraftRef = useRef('')")
    expect(appSource).toContain('set: (text: string) =>')
    expect(appSource).toContain("sideChatDraftRef.current = ''")
    expect(appSource).toContain('sideChatAgent.reset()')
    expect(appSource).toContain('setSideChatTabOpen(false)')
    expect(appSource).toContain('sideChatAgent.setContext({ sessionId: agentManager.currentSessionId, model })')
    expect(appSource).toContain('if (!agentManager.currentSessionId || needsModelSetup) return')
    expect(appSource).toContain('disabled={!agentManager.currentSessionId || needsModelSetup}')
    expect(appSource).toContain('sideChatEnabled={Boolean(agentManager.currentSessionId) && !needsModelSetup}')
    expect(appSource).not.toContain('useSideChatModelActions')
    expect(appSource).not.toContain('onOpenSideChatModelSelector')
    expect(inspectorSource).not.toContain('onSideChatRevisionChange')
    expect(inspectorSource).not.toContain('onOpenSideChatModelSelector')
  })

  it('reuses the same conversation surface and ChatPanelHost with a thin wrapper', () => {
    expect(surfaceSource).toContain('relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--quickforge-main-bg)]')
    expect(sideChatContentSource).toContain('<ChatConversationSurface>')
    expect(sideChatContentSource).toContain('<ChatPanelHost')
    expect(sideChatContentSource).toContain('mode="side-chat"')
    expect(sideChatContentSource).toContain('workspaceToolsEnabled={false}')
    expect(sideChatContentSource).toContain('onCopyAnswer={copyAnswer}')
    expect(sideChatContentSource).toContain('onRollbackFromMessage={noop}')
    expect(sideChatContentSource).toContain('onRetryFromMessage={noop}')
    expect(sideChatContentSource).toContain('onForkFromMessage={noop}')
    expect(sideChatContentSource).not.toContain('onModelSelect')
    expect(sideChatContentSource).not.toContain('<textarea')
    expect(sideChatContentSource).not.toContain('<button')
  })

  it('uses all-false executable capabilities while keeping QuickForge unchanged', () => {
    expect(SIDE_CHAT_CAPABILITIES).toBe(SIDE_CHAT_UI_CAPABILITIES)
    expect(SIDE_CHAT_UI_CAPABILITIES).toEqual(allDisabledCapabilities)
    expect(QUICKFORGE_CHAT_HARNESS_CAPABILITIES).toMatchObject({
      modelSelection: true,
      planMode: true,
      accessMode: true,
      commands: true,
      capabilitySuggestions: true,
      rollback: true,
      retry: true,
      forkFromMessage: true,
      attachments: true,
    })
  })

  it('preserves the main artifacts renderer around Side Chat panel initialization', () => {
    expect(hostSource).toContain('withPreservedArtifactsRenderer(setPanelAgent)')
    expect(rendererIsolationSource).toContain("getToolRenderer('artifacts')")
    expect(rendererIsolationSource).toContain("registerToolRenderer('artifacts', existingRenderer")
    expect(rendererIsolationSource).toContain('finally')
    expect(hostSource).toContain('panel.artifactsPanel?.remove()')
    expect(hostSource).toContain('panel.artifactsPanel = undefined')
  })

  it('keeps native main controls visible but disabled without disabling send or stop', () => {
    expect(hostSource).toContain('disabledControls: sideChatMode')
    expect(hostSource).toContain('allowModelControls: sideChatMode ||')
    expect(decorationSource).toContain('export function disableComposerControls')
    expect(decorationSource).toContain("panel.querySelector<HTMLButtonElement>('.quickforge-plus-inline')")
    expect(decorationSource).toContain("panel.querySelector<HTMLButtonElement>('.quickforge-model-trigger')")
    expect(decorationSource).toContain("panel.querySelector<HTMLButtonElement>('.quickforge-agent-access-inline')")
    expect(decorationSource).toContain("panel.querySelector<HTMLButtonElement>('.quickforge-plan-inline')")
    expect(decorationSource).toContain("editor?.querySelectorAll<HTMLInputElement>('input[type=\"file\"]')")
    expect(decorationSource).toContain('removeAgentAccessMenu(panel, true)')
    expect(decorationSource).toContain("closeComposerModelMenu(panel.querySelector<HTMLElement>('.quickforge-model-trigger'), true)")
    expect(decorationSource).toContain('button.disabled = true')
    expect(decorationSource).toContain("button.setAttribute('aria-expanded', 'false')")
    expect(decorationSource).not.toMatch(/quickforge-(?:send|stop)[^\n]*disabled\s*=\s*true/)
  })

  it('does not enable slash, plugins, file refs, plan shortcut, attachments, models or tools', () => {
    expect(hostSource).toContain('commandSuggestionsEnabled: props.capabilities.commands')
    expect(hostSource).toContain('capabilitySuggestionsEnabled: props.capabilities.capabilitySuggestions')
    expect(hostSource).toContain('fileReferenceSuggestionsEnabled: !sideChatMode')
    expect(hostSource).toContain('enabled: !sideChatMode && canUseFileReferenceSuggestions')
    expect(hostSource).toContain('if (sideChatMode) return')
    expect(hostSource).toContain("sideChatInputMemory?.set('')")
    expect(hostSource).toContain('toolsFactory: () => sideChatMode ? []')
    expect(hostSource).toContain('renderModelRing: !sideChatMode')
    expect(hostSource).toContain('onModelSelect: sideChatMode ? undefined')
    expect(decorationSource).toContain('if (fileReferenceSuggestionsEnabled) setupFileReferenceTextareaHandler(editor)')
    expect(decorationSource).toContain('if (planModeEnabled) setupPlanModeControls(editor, planMode, onTogglePlanMode)')
    expect(decorationSource).toContain('removePlanModeControls(editor)')
  })

  it('renders disabled history actions while copy remains enabled', () => {
    expect(hostSource).toContain('historyActionsDisabled: sideChatMode')
    expect(messageActionsSource).toContain('historyActionsDisabled?: boolean')
    expect(messageActionsSource).toContain('forkButton.disabled = historyActionsDisabled || isStreaming()')
    expect(messageActionsSource).toContain('isDisabled: historyActionsDisabled || isStreaming()')
    expect(messageActionsSource).toContain('retryButton.disabled = historyActionsDisabled || isStreaming()')
    expect(messageActionsSource).toContain('actions.append(copyBtn)')
    expect(messageActionsSource).not.toMatch(/copyBtn\.disabled\s*=/)
  })

  it('keeps the independent NDJSON client with abort support', () => {
    expect(clientSource).toContain("fetch('/api/side-chat/stream'")
    expect(clientSource).toContain('response.body.getReader()')
    expect(clientSource).toContain("event.type === 'delta'")
    expect(clientSource).toContain('signal: options.signal')
  })
})
