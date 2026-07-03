import type { SettingsTab } from '@earendil-works/pi-web-ui'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { createLanguageSettingsTab } from '@/lib/language-settings-tab'
import { createAppearanceSettingsTab } from '@/lib/appearance-settings-tab'
import { createDefaultOptionsSettingsTab } from '@/lib/default-options-settings-tab'
import { createBackupSettingsTab } from '@/lib/backup-settings-tab'
import { createArchivedConversationsSettingsTab } from '@/lib/archived-conversations-settings-tab'
import { createServiceSettingsTab } from '@/lib/service-settings-tab'
import { createLanAccessSettingsTab } from '@/lib/lan-access-settings-tab'
import { createAboutSettingsTab } from '@/lib/about-settings-tab'
import { createProjectCommandsSettingsTab } from '@/lib/project-commands-settings-tab'
import { createChannelsSettingsTab } from '@/lib/channels-settings-tab'
import {
  createAgentProfilesSettingsTab,
  createMcpSettingsTab,
  createPluginsSettingsTab,
  createScheduledTasksSettingsTab,
} from '@/lib/react-settings-tabs'

export type SettingsInitialTab =
  | 'language'
  | 'appearance'
  | 'defaults'
  | 'customModels'
  | 'agents'
  | 'mcp'
  | 'plugins'
  | 'scheduledTasks'
  | 'projectCommands'
  | 'backup'
  | 'archivedConversations'
  | 'service'
  | 'channels'
  | 'lanAccess'
  | 'about'

export function createSettingsTabs(customProvider?: string) {
  const tabs = [
    { key: 'language', tab: createLanguageSettingsTab() },
    { key: 'appearance', tab: createAppearanceSettingsTab() },
    { key: 'defaults', tab: createDefaultOptionsSettingsTab() },
    { key: 'customModels', tab: createCustomProvidersOnlyTab(customProvider) },
    { key: 'agents', tab: createAgentProfilesSettingsTab() },
    { key: 'mcp', tab: createMcpSettingsTab() },
    { key: 'plugins', tab: createPluginsSettingsTab() },
    { key: 'scheduledTasks', tab: createScheduledTasksSettingsTab() },
    { key: 'projectCommands', tab: createProjectCommandsSettingsTab() },
    { key: 'backup', tab: createBackupSettingsTab() },
    { key: 'archivedConversations', tab: createArchivedConversationsSettingsTab() },
    { key: 'service', tab: createServiceSettingsTab() },
    { key: 'channels', tab: createChannelsSettingsTab() },
    { key: 'lanAccess', tab: createLanAccessSettingsTab() },
    { key: 'about', tab: createAboutSettingsTab() },
  ] as const satisfies readonly { key: SettingsInitialTab; tab: SettingsTab }[]

  return {
    items: [...tabs],
    tabs: tabs.map((item) => item.tab),
    indexOf: (key: SettingsInitialTab) => tabs.findIndex((item) => item.key === key),
  }
}
