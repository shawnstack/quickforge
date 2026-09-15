import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HookLifecycle } from './helpers/hook-lifecycle'
import { originalInspectorDomain } from './helpers/inspector-domain-fixture'
import * as tabs from '../../src/components/workspace/workspace-inspector-tabs'
import { findBrowserTabToReuse } from '../../src/components/workspace/workspace-tab-file-path'
import type { WorkspacePanelTab, WorkspacePanelPrimaryTabKind } from '../../src/components/workspace/workspace-inspector-tabs'
import type { SubagentRunPayload } from '../../src/lib/subagent-run-detail'

const { listeners, subagentRunStore } = vi.hoisted(() => {
  const listeners = new Set<(payload: SubagentRunPayload) => void>()
  return { listeners, subagentRunStore: { subscribe: (callback: (payload: SubagentRunPayload) => void) => { listeners.add(callback); return () => listeners.delete(callback) } } }
})
vi.mock('react', async () => (await import('./helpers/hook-lifecycle')).hookRuntime)
vi.mock('@/lib/subagent-run-detail', () => ({ subagentRunStore }))

import { useInspectorTabsState, useInspectorTabsEffects, useInspectorTabsActions } from '../../src/components/workspace/useInspectorTabs'

function useCurrentTabs(props: ReturnType<typeof inputs>) {
  const state = useInspectorTabsState(props)
  useInspectorTabsEffects({ ...state, ...props, projectId: props.project.id })
  // The tab updater remains owned by Inspector and is injected into actions.
  const updatePanelTab = (id: string, updater: (tab: WorkspacePanelTab) => WorkspacePanelTab) => state.setPanelTabs((prev) => prev.map((tab) => tab.id === id ? updater(tab) : tab))
  return { ...state, ...useInspectorTabsActions({ ...state, ...props, updatePanelTab }) }
}
const useTabs = (process.env.QF_INSPECTOR_BASELINE_TEST === '1'
  ? originalInspectorDomain(readFileSync('.goal-runtime-refactor-baseline/Inspector-before-split.tsx', 'utf8'),
    [[715, 726], [730, 730], [751, 753], [798, 798], [1342, 1359], [1432, 1541]], [[172, 174]], { ...tabs, findBrowserTabToReuse, subagentRunStore })
  : useCurrentTabs) as (props: ReturnType<typeof inputs>) => TabResult
type TabResult = {
  panelTabs: WorkspacePanelTab[]; activePanelTabId?: string; readerNavigationVisible: boolean
  openPanelTab: (kind: WorkspacePanelPrimaryTabKind, view?: 'review' | 'changes' | 'browser', options?: { url?: string }) => WorkspacePanelTab
  setPanelTabs: (tabs: WorkspacePanelTab[]) => void; setReaderNavigationVisible: (visible: boolean) => void
  closePanelTab: (id: string) => void; closeOtherPanelTabs: () => void; closeAllPanelTabs: () => void
  activatePanelTab: (tab: WorkspacePanelTab) => void
  handlePanelTabDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void
}
function inputs() { return { project: { id: 'p' }, sessionId: 's' as string | undefined, canUseTerminal: true, onOpenChange: vi.fn(), onClearSideChat: vi.fn() } }
let lifecycle: HookLifecycle
let storage: Map<string, string>
beforeEach(() => { lifecycle = new HookLifecycle(); storage = new Map(); listeners.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }) })
afterEach(() => { lifecycle.unmount(); vi.unstubAllGlobals() })

it('reuses review and browser tabs, updates review view and reload nonce, but allows multiple files tabs', () => {
  const props = inputs(); const render = () => lifecycle.render(() => useTabs(props))
  const review = render().openPanelTab('review', 'review')
  expect(render().openPanelTab('review', 'changes').id).toBe(review.id)
  expect(render().panelTabs[0].reviewView).toBe('changes')
  const browser = render().openPanelTab('browser', 'browser', { url: 'https://example.com/a' })
  expect(render().openPanelTab('browser', 'browser', { url: 'https://example.com/a' }).id).toBe(browser.id)
  expect(render().panelTabs[1].reloadNonce).toBe(1)
  render().openPanelTab('files'); render().openPanelTab('files')
  expect(render().panelTabs.map((tab) => tab.kind)).toEqual(['review', 'browser', 'files', 'files'])
})
it('reorders and selects the adjacent tab on close, clearing side chat only when removed', () => {
  const props = inputs(); const render = () => lifecycle.render(() => useTabs(props))
  const first = render().openPanelTab('files'); const second = render().openPanelTab('files'); const side = render().openPanelTab('side-chat')
  render().handlePanelTabDragEnd({ active: { id: side.id }, over: { id: first.id } })
  expect(render().panelTabs.map((tab) => tab.id)).toEqual([side.id, first.id, second.id])
  render().closePanelTab(side.id)
  expect(render().activePanelTabId).toBe(first.id)
  expect(props.onClearSideChat).toHaveBeenCalledOnce()
  render().closeOtherPanelTabs(); expect(render().panelTabs).toHaveLength(1)
  render().closePanelTab(first.id); expect(render().activePanelTabId).toBeUndefined()
  expect(props.onOpenChange).toHaveBeenLastCalledWith(false)
})
it('restores isolated session tabs once, filters unavailable terminal and persists reader navigation', () => {
  const key = tabs.workspaceInspectorTabsStorageKey('p', 's')
  storage.set(key, JSON.stringify({ tabs: [{ id: 'files-5', kind: 'files' }, { id: 'terminal-8', kind: 'terminal' }], activePanelTabId: 'files-5', readerNavigationVisible: false }))
  const props = { ...inputs(), canUseTerminal: false }; const render = () => lifecycle.render(() => useTabs(props))
  expect(render().panelTabs.map((tab) => tab.id)).toEqual(['files-5'])
  expect(render().readerNavigationVisible).toBe(false)
  expect(render().openPanelTab('files').id).toBe('files-9')
  render().setReaderNavigationVisible(true); render()
  expect(JSON.parse(storage.get(key)!).readerNavigationVisible).toBe(true)
  lifecycle.unmount(); lifecycle = new HookLifecycle(); props.sessionId = 'other'
  expect(render().panelTabs).toEqual([])
  expect(JSON.parse(storage.get(key)!).tabs).toHaveLength(2)
})
it('does not persist deferred tabs until session promotion, and does not persist runtime Goal/subagent tabs', () => {
  const props = inputs(); props.sessionId = undefined
  const render = () => lifecycle.render(() => useTabs(props))
  const browser = render().openPanelTab('browser', 'browser', { url: 'https://example.com' }); render()
  expect(storage.size).toBe(0)
  props.sessionId = 'promoted'; render()
  expect(render().panelTabs[0].id).toBe(browser.id)
  render().setPanelTabs([...render().panelTabs, { id: 'goal-1', kind: 'goal', goal: { sessionId: 'promoted', goalId: 'g', view: 'progress' } }, { id: 'subagent-1', kind: 'subagent' }]); render()
  const saved = JSON.parse(storage.get(tabs.workspaceInspectorTabsStorageKey('p', 'promoted'))!)
  expect(saved.tabs.map((tab: WorkspacePanelTab) => tab.kind)).toEqual(['browser'])
  expect(listeners.size).toBe(1)
  lifecycle.unmount(); expect(listeners.size).toBe(0)
})
it('close all clears side chat and closes Inspector without leaving an active tab', () => {
  const props = inputs(); const render = () => lifecycle.render(() => useTabs(props))
  render().openPanelTab('side-chat'); render().openPanelTab('files'); render().closeAllPanelTabs()
  expect(render().panelTabs).toEqual([]); expect(render().activePanelTabId).toBeUndefined()
  expect(props.onClearSideChat).toHaveBeenCalledOnce(); expect(props.onOpenChange).toHaveBeenCalledWith(false)
})
