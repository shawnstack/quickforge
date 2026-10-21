import { useState } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ShareLinksSettingsPage } from '@/components/share/ShareLinksSettingsPage'
import { ArchivedConversationsSettingsTab } from './ArchivedConversationsSettingsTab'
import { BackupSettingsTab } from './BackupSettingsTab'

type DataSubTab = 'backup' | 'archived' | 'shares'

const DATA_SUB_TABS = [
  { key: 'backup', label: 'backupRestore' },
  { key: 'archived', label: 'archivedConversations' },
  { key: 'shares', label: 'shareLinks' },
] as const

export function DataSettingsTab({ active }: { active?: boolean } = {}) {
  const [selected, setSelected] = useState<DataSubTab>('backup')
  const [visited, setVisited] = useState<ReadonlySet<DataSubTab>>(() => new Set<DataSubTab>(['backup']))
  if (!visited.has(selected)) {
    setVisited(new Set<DataSubTab>([...visited, selected]))
  }
  const parentActive = active !== false

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-subtabs" role="tablist" aria-label={t('dataManagement')}>
        {DATA_SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected === tab.key}
            className={cn('quickforge-settings-subtab', selected === tab.key && 'quickforge-settings-subtab-active')}
            onClick={() => setSelected(tab.key)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <div hidden={selected !== 'backup'} role="tabpanel">
        <BackupSettingsTab />
      </div>
      {visited.has('archived')
        ? (
          <div hidden={selected !== 'archived'} role="tabpanel">
            <ArchivedConversationsSettingsTab active={parentActive && selected === 'archived'} />
          </div>
        )
        : null}
      {visited.has('shares')
        ? (
          <div hidden={selected !== 'shares'} role="tabpanel">
            <ShareLinksSettingsPage embedded active={parentActive && selected === 'shares'} />
          </div>
        )
        : null}
    </div>
  )
}
