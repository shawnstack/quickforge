/* eslint-disable react-refresh/only-export-components */
import { lazy, Suspense } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsTab } from '@earendil-works/pi-web-ui'
import { html, type TemplateResult } from 'lit'
import { t } from '@/lib/i18n'

const AgentProfilesPage = lazy(() =>
  import('@/components/agent-profiles/AgentProfilesPage').then((module) => ({ default: module.AgentProfilesPage })),
)
const McpServersPanel = lazy(() =>
  import('@/components/mcp-servers-dialog').then((module) => ({ default: module.McpServersPanel })),
)
const SkillsManagerPanel = lazy(() =>
  import('@/components/skills-dialog').then((module) => ({ default: module.SkillsManagerPanel })),
)
const PluginsPage = lazy(() =>
  import('@/components/plugins/PluginsPage').then((module) => ({ default: module.PluginsPage })),
)
const ScheduledTasksPage = lazy(() =>
  import('@/components/scheduled-tasks/ScheduledTasksPage').then((module) => ({ default: module.ScheduledTasksPage })),
)
const ShareLinksSettingsPage = lazy(() =>
  import('@/components/share/ShareLinksSettingsPage').then((module) => ({ default: module.ShareLinksSettingsPage })),
)
const CloudAccountSettingsPage = lazy(() =>
  import('@/components/cloud/CloudAccountSettingsPage').then((module) => ({ default: module.CloudAccountSettingsPage })),
)

type ReactSettingsTabRender = () => React.ReactNode

class ReactSettingsTab extends SettingsTab {
  tabName = ''
  renderReact?: ReactSettingsTabRender
  private root?: Root

  override getTabName(): string {
    return this.tabName
  }

  override connectedCallback() {
    super.connectedCallback()
    void this.updateComplete.then(() => this.mountReact())
  }

  override disconnectedCallback() {
    this.root?.unmount()
    this.root = undefined
    super.disconnectedCallback()
  }

  override render(): TemplateResult {
    return html`<div class="quickforge-react-settings-tab h-full min-h-0"></div>`
  }

  private mountReact() {
    const container = this.querySelector<HTMLElement>('.quickforge-react-settings-tab')
    if (!container || !this.renderReact) return
    this.root ??= createRoot(container)
    this.root.render(this.renderReact())
  }
}

const tagName = 'quickforge-react-settings-tab'

if (!customElements.get(tagName)) {
  customElements.define(tagName, ReactSettingsTab)
}

function createReactSettingsTab(tabName: string, renderReact: ReactSettingsTabRender) {
  const element = document.createElement(tagName) as ReactSettingsTab
  element.tabName = tabName
  element.renderReact = renderReact
  return element
}

function SettingsPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="quickforge-settings-stack h-full min-h-[30rem]">
      <Suspense fallback={<div className="quickforge-settings-note">{t('loading')}</div>}>
        {children}
      </Suspense>
    </div>
  )
}

function openScheduledTaskSession(sessionId: string) {
  window.dispatchEvent(new CustomEvent('quickforge:open-session-from-settings', { detail: { sessionId } }))
}

export function createAgentProfilesSettingsTab() {
  return createReactSettingsTab(t('agentsTab'), () => (
    <SettingsPanel>
      <AgentProfilesPage />
    </SettingsPanel>
  ))
}

export function createSkillsSettingsTab() {
  return createReactSettingsTab(t('skills'), () => (
    <SettingsPanel>
      <SkillsManagerPanel active scope="global" embedded onSaved={() => undefined} />
    </SettingsPanel>
  ))
}

export function createMcpSettingsTab() {
  return createReactSettingsTab(t('mcpServers'), () => (
    <SettingsPanel>
      <McpServersPanel active />
    </SettingsPanel>
  ))
}

export function createPluginsSettingsTab() {
  return createReactSettingsTab(t('plugins'), () => (
    <SettingsPanel>
      <PluginsPage />
    </SettingsPanel>
  ))
}

export function createScheduledTasksSettingsTab() {
  return createReactSettingsTab(t('scheduledTasks'), () => (
    <SettingsPanel>
      <ScheduledTasksPage onOpenSession={openScheduledTaskSession} />
    </SettingsPanel>
  ))
}

export function createCloudAccountSettingsTab() {
  return createReactSettingsTab(t('cloudAccount'), () => (
    <SettingsPanel>
      <CloudAccountSettingsPage />
    </SettingsPanel>
  ))
}

export function createShareLinksSettingsTab() {
  return createReactSettingsTab(t('shareLinks'), () => (
    <SettingsPanel>
      <ShareLinksSettingsPage />
    </SettingsPanel>
  ))
}
