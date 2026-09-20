import { createElement } from 'react'
import { ReactSettingsTabContent } from '@/lib/react-settings-tabs'
import { t } from '@/lib/i18n'

// Keep the existing navigation order and resolve translations at render/search time.
const settingsTabDefinitions = [
  { key: 'appearance', name: 'appearance', description: 'appearanceDescription' },
  { key: 'defaults', name: 'defaultOptions', description: 'defaultOptionsDescription' },
  { key: 'memory', name: 'memory', description: 'memoryDescription' },
  { key: 'customModels', name: 'customModels', description: 'customModelsDescription' },
  { key: 'agents', name: 'agentsTab', description: 'agentsDescription' },
  { key: 'skills', name: 'skills', description: 'globalSkillsDescription' },
  { key: 'mcp', name: 'mcpServers', description: undefined },
  { key: 'plugins', name: 'plugins', description: undefined },
  { key: 'scheduledTasks', name: 'scheduledTasks', description: 'scheduledTasksDescription' },
  { key: 'projectCommands', name: 'projectCommands', description: 'projectCommandsDescription' },
  { key: 'hooks', name: 'hooksTab', description: 'hooksTabDescription' },
  { key: 'backup', name: 'backupRestore', description: 'backupRestoreDescription' },
  { key: 'archivedConversations', name: 'archivedConversations', description: 'archivedConversationsDescription' },
  { key: 'shareLinks', name: 'shareLinks', description: 'shareLinksDescription' },
  { key: 'channels', name: 'channels', description: 'channelsDescription' },
  { key: 'lanAccess', name: 'lanAccess', description: 'lanAccessDescription' },
  { key: 'about', name: 'about', description: 'aboutQuickForgeDescription' },
] as const

export type SettingsInitialTab = typeof settingsTabDefinitions[number]['key']

export function createSettingsTabs(customProvider?: string) {
  const items = settingsTabDefinitions.map(({ key, name, description }) => ({
    key,
    getTabName: () => t(name),
    getDescription: description ? () => t(description) : undefined,
    content: createElement(ReactSettingsTabContent, { key: `${key}:${customProvider ?? ''}`, tabKey: key, customProvider }),
  }))
  return {
    items,
    indexOf: (key: SettingsInitialTab) => items.findIndex((item) => item.key === key),
  }
}
