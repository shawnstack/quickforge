import type { SettingsTab } from '@earendil-works/pi-web-ui'
import { createCustomProvidersOnlyTab } from '@/lib/custom-providers-only-tab'
import { createAppearanceSettingsTab } from '@/lib/appearance-settings-tab'
import { createDefaultOptionsSettingsTab } from '@/lib/default-options-settings-tab'
import { createMemorySettingsTab } from '@/lib/memory-settings-tab'
import { createBackupSettingsTab } from '@/lib/backup-settings-tab'
import { createArchivedConversationsSettingsTab } from '@/lib/archived-conversations-settings-tab'
import { createLanAccessSettingsTab } from '@/lib/lan-access-settings-tab'
import { createAboutSettingsTab } from '@/lib/about-settings-tab'
import { createProjectCommandsSettingsTab } from '@/lib/project-commands-settings-tab'
import { createChannelsSettingsTab } from '@/lib/channels-settings-tab'
import { t } from '@/lib/i18n'
import {
  createAgentProfilesSettingsTab,
  createCloudAccountSettingsTab,
  createMcpSettingsTab,
  createPluginsSettingsTab,
  createScheduledTasksSettingsTab,
  createShareLinksSettingsTab,
  createSkillsSettingsTab,
} from '@/lib/react-settings-tabs'

export type SettingsInitialTab =
  | 'appearance'
  | 'cloudAccount'
  | 'defaults'
  | 'memory'
  | 'customModels'
  | 'agents'
  | 'skills'
  | 'mcp'
  | 'plugins'
  | 'scheduledTasks'
  | 'projectCommands'
  | 'backup'
  | 'archivedConversations'
  | 'shareLinks'
  | 'channels'
  | 'lanAccess'
  | 'about'

export function createSettingsTabs(customProvider?: string) {
  const tabs = [
    { key: 'appearance', tab: createAppearanceSettingsTab(), getDescription: () => t('appearanceDescription') },
    { key: 'cloudAccount', tab: createCloudAccountSettingsTab(), getDescription: () => t('cloudAccountDescription') },
    { key: 'defaults', tab: createDefaultOptionsSettingsTab(), getDescription: () => t('defaultOptionsDescription') },
    { key: 'memory', tab: createMemorySettingsTab(), getDescription: () => t('memoryDescription') },
    { key: 'customModels', tab: createCustomProvidersOnlyTab(customProvider), getDescription: () => t('customModelsDescription') },
    { key: 'agents', tab: createAgentProfilesSettingsTab(), getDescription: () => t('agentsDescription') },
    { key: 'skills', tab: createSkillsSettingsTab(), getDescription: () => t('globalSkillsDescription') },
    { key: 'mcp', tab: createMcpSettingsTab(), getDescription: undefined },
    { key: 'plugins', tab: createPluginsSettingsTab(), getDescription: undefined },
    { key: 'scheduledTasks', tab: createScheduledTasksSettingsTab(), getDescription: () => t('scheduledTasksDescription') },
    { key: 'projectCommands', tab: createProjectCommandsSettingsTab(), getDescription: () => t('projectCommandsDescription') },
    { key: 'backup', tab: createBackupSettingsTab(), getDescription: () => t('backupRestoreDescription') },
    { key: 'archivedConversations', tab: createArchivedConversationsSettingsTab(), getDescription: () => t('archivedConversationsDescription') },
    { key: 'shareLinks', tab: createShareLinksSettingsTab(), getDescription: () => t('shareLinksDescription') },
    { key: 'channels', tab: createChannelsSettingsTab(), getDescription: () => t('channelsDescription') },
    { key: 'lanAccess', tab: createLanAccessSettingsTab(), getDescription: () => t('lanAccessDescription') },
    { key: 'about', tab: createAboutSettingsTab(), getDescription: () => t('aboutQuickForgeDescription') },
  ] as const satisfies readonly { key: SettingsInitialTab; tab: SettingsTab; getDescription?: () => string }[]

  return {
    items: [...tabs],
    tabs: tabs.map((item) => item.tab),
    indexOf: (key: SettingsInitialTab) => tabs.findIndex((item) => item.key === key),
  }
}
