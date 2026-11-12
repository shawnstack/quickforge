import { lazy, Suspense, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'

const AppearanceSettingsTab = lazy(() => import('@/components/settings/tabs/AppearanceSettingsTab').then((m) => ({ default: m.AppearanceSettingsTab })))
const DefaultOptionsSettingsTab = lazy(() => import('@/components/settings/tabs/DefaultOptionsSettingsTab').then((m) => ({ default: m.DefaultOptionsSettingsTab })))
const MemorySettingsTab = lazy(() => import('@/components/settings/tabs/MemorySettingsTab').then((m) => ({ default: m.MemorySettingsTab })))
const WorkingMemorySettingsTab = lazy(() => import('@/components/settings/tabs/WorkingMemorySettingsTab').then((m) => ({ default: m.WorkingMemorySettingsTab })))
const CustomProvidersSettingsTab = lazy(() => import('@/components/settings/tabs/CustomProvidersSettingsTab').then((m) => ({ default: m.CustomProvidersSettingsTab })))
const NetworkSettingsTab = lazy(() => import('@/components/settings/tabs/NetworkSettingsTab').then((m) => ({ default: m.NetworkSettingsTab })))
const DataSettingsTab = lazy(() => import('@/components/settings/tabs/DataSettingsTab').then((m) => ({ default: m.DataSettingsTab })))
const AboutSettingsTab = lazy(() => import('@/components/settings/tabs/AboutSettingsTab').then((m) => ({ default: m.AboutSettingsTab })))
const ProjectCommandsSettingsTab = lazy(() => import('@/components/settings/tabs/ProjectCommandsSettingsTab').then((m) => ({ default: m.ProjectCommandsSettingsTab })))
const HooksSettingsTab = lazy(() => import('@/components/settings/tabs/HooksSettingsTab').then((m) => ({ default: m.HooksSettingsTab })))
const AgentProfilesPage = lazy(() => import('@/components/agent-profiles/AgentProfilesPage').then((m) => ({ default: m.AgentProfilesPage })))
const McpServersPanel = lazy(() => import('@/components/mcp-servers-dialog').then((m) => ({ default: m.McpServersPanel })))
const SkillsManagerPanel = lazy(() => import('@/components/skills').then((m) => ({ default: m.SkillsManagerPanel })))
const PluginsPage = lazy(() => import('@/components/plugins/PluginsPage').then((m) => ({ default: m.PluginsPage })))
const ScheduledTasksPage = lazy(() => import('@/components/scheduled-tasks/ScheduledTasksPage').then((m) => ({ default: m.ScheduledTasksPage })))
const DreamingSettingsTab = lazy(() => import('@/components/dreaming/DreamingSettingsTab').then((m) => ({ default: m.DreamingSettingsTab })))

function SettingsPanel({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={cn('quickforge-settings-stack h-full min-h-[30rem]', wide && 'quickforge-settings-stack-wide')}>{children}</div>
}

function openScheduledTaskSession(sessionId: string) {
  // 原 window CustomEvent 桥（quickforge:open-session-from-settings）已由
  // ui-store 请求信号替代：tab 工厂零 props，App 订阅 useUIStore 处理。
  useUIStore.getState().requestOpenSession(sessionId)
}

// Lazy components stay module-scoped so rerendering the workspace never remounts a tab.
// `active` mirrors the legacy tab element staying mounted while detached: the stateful
// tabs use it to stop background work and reload data when they are reactivated.
const tabContent = {
  appearance: () => <AppearanceSettingsTab />,
  defaults: (_customProvider?: string, active?: boolean) => <DefaultOptionsSettingsTab active={active} />,
  memory: () => <MemorySettingsTab />,
  network: (_customProvider?: string, active?: boolean) => <NetworkSettingsTab active={active} />,
  workingMemory: () => <WorkingMemorySettingsTab />,
  customModels: (customProvider?: string, active?: boolean) => <CustomProvidersSettingsTab customProvider={customProvider} active={active} />,
  agents: () => <SettingsPanel><AgentProfilesPage /></SettingsPanel>,
  skills: () => <SettingsPanel wide><SkillsManagerPanel active scope="global" embedded onSaved={() => undefined} /></SettingsPanel>,
  mcp: () => <SettingsPanel><McpServersPanel active /></SettingsPanel>,
  plugins: () => <SettingsPanel><PluginsPage /></SettingsPanel>,
  scheduledTasks: () => <SettingsPanel><ScheduledTasksPage onOpenSession={openScheduledTaskSession} /></SettingsPanel>,
  dreaming: () => <DreamingSettingsTab />,
  projectCommands: () => <ProjectCommandsSettingsTab />,
  hooks: () => <HooksSettingsTab />,
  data: (_customProvider?: string, active?: boolean) => <DataSettingsTab active={active} />,
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
