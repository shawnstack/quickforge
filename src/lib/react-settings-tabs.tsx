import { lazy, Suspense, type ReactNode } from 'react'
import { t } from '@/lib/i18n'

const AppearanceSettingsTab = lazy(() => import('@/components/settings/tabs/AppearanceSettingsTab').then((m) => ({ default: m.AppearanceSettingsTab })))
const DefaultOptionsSettingsTab = lazy(() => import('@/components/settings/tabs/DefaultOptionsSettingsTab').then((m) => ({ default: m.DefaultOptionsSettingsTab })))
const MemorySettingsTab = lazy(() => import('@/components/settings/tabs/MemorySettingsTab').then((m) => ({ default: m.MemorySettingsTab })))
const CustomProvidersSettingsTab = lazy(() => import('@/components/settings/tabs/CustomProvidersSettingsTab').then((m) => ({ default: m.CustomProvidersSettingsTab })))
const BackupSettingsTab = lazy(() => import('@/components/settings/tabs/BackupSettingsTab').then((m) => ({ default: m.BackupSettingsTab })))
const ArchivedConversationsSettingsTab = lazy(() => import('@/components/settings/tabs/ArchivedConversationsSettingsTab').then((m) => ({ default: m.ArchivedConversationsSettingsTab })))
const LanAccessSettingsTab = lazy(() => import('@/components/settings/tabs/LanAccessSettingsTab').then((m) => ({ default: m.LanAccessSettingsTab })))
const AboutSettingsTab = lazy(() => import('@/components/settings/tabs/AboutSettingsTab').then((m) => ({ default: m.AboutSettingsTab })))
const ProjectCommandsSettingsTab = lazy(() => import('@/components/settings/tabs/ProjectCommandsSettingsTab').then((m) => ({ default: m.ProjectCommandsSettingsTab })))
const ChannelsSettingsTab = lazy(() => import('@/components/settings/tabs/ChannelsSettingsTab').then((m) => ({ default: m.ChannelsSettingsTab })))
const AgentProfilesPage = lazy(() => import('@/components/agent-profiles/AgentProfilesPage').then((m) => ({ default: m.AgentProfilesPage })))
const McpServersPanel = lazy(() => import('@/components/mcp-servers-dialog').then((m) => ({ default: m.McpServersPanel })))
const SkillsManagerPanel = lazy(() => import('@/components/skills-dialog').then((m) => ({ default: m.SkillsManagerPanel })))
const PluginsPage = lazy(() => import('@/components/plugins/PluginsPage').then((m) => ({ default: m.PluginsPage })))
const ScheduledTasksPage = lazy(() => import('@/components/scheduled-tasks/ScheduledTasksPage').then((m) => ({ default: m.ScheduledTasksPage })))
const ShareLinksSettingsPage = lazy(() => import('@/components/share/ShareLinksSettingsPage').then((m) => ({ default: m.ShareLinksSettingsPage })))

function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="quickforge-settings-stack h-full min-h-[30rem]">{children}</div>
}

function openScheduledTaskSession(sessionId: string) {
  window.dispatchEvent(new CustomEvent('quickforge:open-session-from-settings', { detail: { sessionId } }))
}

// Lazy components stay module-scoped so rerendering the workspace never remounts a tab.
// `active` mirrors the legacy tab element staying mounted while detached: the stateful
// tabs use it to stop background work and reload data when they are reactivated.
const tabContent = {
  appearance: () => <AppearanceSettingsTab />,
  defaults: (_customProvider?: string, active?: boolean) => <DefaultOptionsSettingsTab active={active} />,
  memory: () => <MemorySettingsTab />,
  customModels: (customProvider?: string, active?: boolean) => <CustomProvidersSettingsTab customProvider={customProvider} active={active} />,
  agents: () => <SettingsPanel><AgentProfilesPage /></SettingsPanel>,
  skills: () => <SettingsPanel><SkillsManagerPanel active scope="global" embedded onSaved={() => undefined} /></SettingsPanel>,
  mcp: () => <SettingsPanel><McpServersPanel active /></SettingsPanel>,
  plugins: () => <SettingsPanel><PluginsPage /></SettingsPanel>,
  scheduledTasks: () => <SettingsPanel><ScheduledTasksPage onOpenSession={openScheduledTaskSession} /></SettingsPanel>,
  projectCommands: () => <ProjectCommandsSettingsTab />,
  backup: () => <BackupSettingsTab />,
  archivedConversations: (_customProvider?: string, active?: boolean) => <ArchivedConversationsSettingsTab active={active} />,
  shareLinks: () => <SettingsPanel><ShareLinksSettingsPage /></SettingsPanel>,
  channels: (_customProvider?: string, active?: boolean) => <ChannelsSettingsTab active={active} />,
  lanAccess: (_customProvider?: string, active?: boolean) => <LanAccessSettingsTab active={active} />,
  about: (_customProvider?: string, active?: boolean) => <AboutSettingsTab active={active} />,
}

export type ReactSettingsTabContentProps = {
  tabKey: keyof typeof tabContent
  customProvider?: string
  active?: boolean
}

export function ReactSettingsTabContent({ tabKey, customProvider, active }: ReactSettingsTabContentProps) {
  return (
    <Suspense fallback={<div className="quickforge-settings-note">{t('loading')}</div>}>
      {tabContent[tabKey](customProvider, active)}
    </Suspense>
  )
}
