import { t } from '@/lib/i18n'
import { LanAccessSettingsTab } from './LanAccessSettingsTab'
import { NetworkProxySettingsSection } from './NetworkProxySettingsSection'

export function NetworkSettingsTab({ active }: { active?: boolean } = {}) {
  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('lanAccess')}</h3>
        <LanAccessSettingsTab active={active} />
      </div>
      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('networkProxy')}</h3>
        <NetworkProxySettingsSection active={active} />
      </div>
    </div>
  )
}
