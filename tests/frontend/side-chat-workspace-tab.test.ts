import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  normalizePersistedPanelTabs,
  serializePanelTabs,
  type WorkspacePanelTab,
} from '../../src/components/workspace/workspace-inspector-tabs'
import {
  QUICKFORGE_CHAT_CAPABILITIES,
  SIDE_CHAT_CAPABILITIES,
  SIDE_CHAT_UI_CAPABILITIES,
} from '../../src/lib/chat-capabilities'

const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const inspectorSource = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const tabSource = readFileSync(new URL('../../src/components/workspace/useInspectorTabs.ts', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const clientSource = readFileSync(new URL('../../src/components/workspace/side-chat-client.ts', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const decorationSource = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const messageActionsSource = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
const surfaceSource = readFileSync(new URL('../../src/components/chat/ChatConversationSurface.tsx', import.meta.url), 'utf8')
const sideChatContentSource = readFileSync(new URL('../../src/components/workspace/SideChatTabContent.tsx', import.meta.url), 'utf8')
const chatSurfaceSource = readFileSync(new URL('../../src/components/chat/surface/ChatSurface.tsx', import.meta.url), 'utf8')
const codeBlockSource = readFileSync(new URL('../../src/components/chat/surface/CodeBlock.tsx', import.meta.url), 'utf8')

const allDisabledCapabilities = Object.fromEntries(
  Object.keys(QUICKFORGE_CHAT_CAPABILITIES).map((key) => [key, false]),
)

describe('Workspace side chat tab', () => {
  it('keeps the Inspector toolbar reachable without a project on all viewport sizes', () => {
    expect(appSource).toContain('disabled={needsModelSetup}\n        aria-label={workspaceInspectorOpen')
    expect(appSource).not.toContain('disabled={!agentManager.currentToolProject?.id || needsModelSetup}\n        aria-label={workspaceInspectorOpen')
    expect(appSource).toContain('agentManager.currentToolProject?.id || agentManager.currentSessionId || workspaceInspectorOpen')
    expect(appSource).toContain("'rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40 inline-flex'")
    expect(appSource).not.toContain('lg:inline-flex')
  })

  it('is a single runtime-only tab excluded from persistence', () => {
    const tabs: WorkspacePanelTab[] = [
      { id: 'files-1', kind: 'files' },
      { id: 'side-chat-2', kind: 'side-chat' },
    ]
    expect(serializePanelTabs(tabs, 'side-chat-2').tabs).toEqual([{ id: 'files-1', kind: 'files' }])
    expect(normalizePersistedPanelTabs([{ id: 'side-chat-1', kind: 'side-chat' }])).toEqual([])
    expect(tabSource).toContain("kind === 'review' || kind === 'side-chat'")
  })

  it('keeps stable agent/text memory and clears both on destructive lifecycles', () => {
    expect(appSource).toContain('useState(() => new SideChatAgent(')
    expect(appSource).toContain("const sideChatDraftRef = useRef('')")
    expect(appSource).toContain('set: (text: string) =>')
    expect(appSource).toContain("sideChatDraftRef.current = ''")
    expect(appSource).toContain('sideChatAgent.reset()')
    expect(appSource).toContain('sideChatAgent.setContext({ sessionId: agentManager.currentSessionId, model })')
    expect(appSource).toContain('sideChatEnabled={Boolean(agentManager.currentSessionId) && !needsModelSetup}')
    expect(tabSource).toContain("if (closingTab?.kind === 'side-chat') clearSideChat()")
    expect(tabSource).toContain("if (activeTab.kind !== 'side-chat' && panelTabs.some((tab) => tab.kind === 'side-chat')) clearSideChat()")
    expect(tabSource).toContain("if (panelTabs.some((tab) => tab.kind === 'side-chat')) clearSideChat()")
    expect(appSource).not.toContain('useSideChatModelActions')
    expect(appSource).not.toContain('onOpenSideChatModelSelector')
    expect(inspectorSource).not.toContain('onSideChatRevisionChange')
    expect(inspectorSource).not.toContain('onOpenSideChatModelSelector')
  })

  it('removes the App title entry while keeping Inspector side chat entries single-instance', () => {
    expect(appSource).not.toContain('sideChatTabOpen')
    expect(appSource).not.toContain('openWorkspaceSideChat')
    expect(appSource).not.toContain("t('sideChatOpen')")
    expect(appSource).not.toContain('onSideChatPresenceChange')
    expect(i18nSource).not.toMatch(/^\s*sideChatOpen:/m)
    expect(inspectorSource).toContain("{ kind: 'side-chat', label: t('sideChatTitle')")
    expect(inspectorSource).toContain("&& (sideChatEnabled || item.kind !== 'side-chat')")
    expect(inspectorSource).toContain('{availablePanelTabItems.map((item) => {')
    expect(inspectorSource).toContain('onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}')
    expect(tabSource).toContain("const existing = kind === 'review' || kind === 'side-chat'")
    expect(tabSource).toContain('? panelTabs.find((tab) => tab.kind === kind)')
    expect(inspectorSource).toContain("activePanelTab?.kind !== 'side-chat'")
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
    expect(QUICKFORGE_CHAT_CAPABILITIES).toMatchObject({
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

  it('drops the package artifacts panel: no renderer isolation, artifact role never renders', () => {
    // QuickForge never produces package artifact-role messages (tools execute
    // server-side; no sandboxUrlProvider), so the React surface keeps only
    // the artifact-role skip in MessageList and the old renderer-isolation dance
    // (withPreservedArtifactsRenderer + panel.artifactsPanel removal) is gone.
    expect(hostSource).not.toContain('withPreservedArtifactsRenderer')
    expect(hostSource).not.toContain('artifactsPanel')
    expect(chatSurfaceSource).not.toContain('ArtifactsPanel')
  })

  it('keeps native main controls visible but disabled without disabling send or stop', () => {
    expect(hostSource).toContain('disabledControls: sideChatMode')
    expect(hostSource).toContain('allowModelControls: sideChatMode ||')
    // The React surface renders the model trigger; the shared decoration then
    // disables it (the decoration's allowModelControls OR is HEAD semantics).
    expect(hostSource).toContain('enableModelSelector={sideChatMode || (allowModelControls && effectiveCapabilities.modelSelection)}')
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
    expect(hostSource).toContain('getLocalWorkspaceTools(agent.state.tools)')
    expect(hostSource).toContain('renderModelRing: !sideChatMode')
    expect(hostSource).toContain('onModelSelect={sideChatMode ? undefined')
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

  it('hides code-block terminal command actions in side chat and read-only panels', () => {
    // Legacy gate: enableTerminalCommandActions = !sideChat && !readOnly.
    // The React surface receives it as a prop and hands it to CodeBlock via
    // context — the old composer-DOM probe wrongly showed the button in side
    // chat (which also renders a composer).
    expect(hostSource).toContain('commandActionsEnabled={!sideChatMode && !readOnly}')
    expect(hostSource).not.toMatch(/enableTerminalCommandActions\s*:/)
    expect(messageActionsSource).not.toContain('enableTerminalCommandActions')
    expect(chatSurfaceSource).toContain('commandActionsEnabled = true')
    expect(chatSurfaceSource).toContain('CommandActionsEnabledContext.Provider value={commandActionsEnabled}')
    expect(codeBlockSource).toContain('useCommandActionsEnabled()')
    expect(codeBlockSource).not.toContain("querySelector('.qf-message-editor')")
  })

  it('keeps the independent NDJSON client with abort support', () => {
    expect(clientSource).toContain("fetch('/api/side-chat/stream'")
    expect(clientSource).toContain('response.body.getReader()')
    expect(clientSource).toContain("event.type === 'delta'")
    expect(clientSource).toContain('signal: options.signal')
  })
})
