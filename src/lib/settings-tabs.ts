import { createElement } from 'react'
import { ReactSettingsTabContent } from '@/lib/react-settings-tabs'
import { t } from '@/lib/i18n'
import {
  settingsTabDefinitions,
  settingsTabGroupDefinitions,
  type SettingsInitialTab,
} from '@/lib/settings-tab-definitions'

export type { SettingsInitialTab }

export function createSettingsTabs(customProvider?: string) {
  const items = settingsTabDefinitions.map((definition) => {
    const { key, name, description, group, keywords } = definition
    return {
      key,
      group,
      keywords,
      // Rendered as a badge in the nav and in the tab header: the feature is still
      // settling (notes format, run semantics), so users should know before they
      // rely on it.
      beta: (definition as { beta?: boolean }).beta === true,
      getTabName: () => t(name),
      getDescription: description ? () => t(description) : undefined,
      content: createElement(ReactSettingsTabContent, { key: `${key}:${customProvider ?? ''}`, tabKey: key, customProvider }),
    }
  })
  const groups = settingsTabGroupDefinitions.map((group) => ({
    key: group.key,
    getLabel: () => t(group.name),
    items: items.filter((item) => item.group === group.key),
  }))
  return {
    items,
    groups,
    about: items.find((item) => item.key === 'about'),
    indexOf: (key: SettingsInitialTab) => items.findIndex((item) => item.key === key),
  }
}
