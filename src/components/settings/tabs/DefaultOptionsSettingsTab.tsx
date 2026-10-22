import { useEffect, useRef, useState } from 'react'
import { getAppStorage } from '@/storage'
import {
  loadToolDisplaySettings,
  saveToolDisplaySettings,
  type ToolDisplayMode,
} from '@/lib/tool-display-settings'
import {
  loadAutoCompactSettings,
  saveAutoCompactSettings,
} from '@/lib/auto-compact-settings'
import {
  loadGoalSettings,
  saveGoalSettings,
} from '@/lib/goal-settings'
import {
  loadAutoArchiveSettings,
  saveAutoArchiveSettings,
} from '@/lib/auto-archive-settings'
import { applyAppLanguage, getAppLanguage, t, type AppLanguage } from '@/lib/i18n'
import {
  getSystemNotificationPermission,
  isSystemNotificationsEnabled,
  requestSystemNotificationPermission,
  setSystemNotificationsEnabled as persistSystemNotificationsEnabled,
  showTaskSystemNotification,
  type SystemNotificationPermission,
} from '@/lib/system-notifications'
import { showConfirm } from '@/components/ui/confirm-dialog'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSelect, SettingsSwitch } from './shared'
import { SettingsNumberInput } from './SettingsNumberInput'

type TerminalShellProfile = {
  id: string
  name: string
  command: string
  builtin: boolean
  detected?: boolean
}

type TerminalShellConfig = {
  terminalShell: string
  defaultProfileId: string
  profiles: TerminalShellProfile[]
}

const TOOL_DISPLAY_MODE_OPTIONS: { value: ToolDisplayMode; label: () => string }[] = [
  { value: 'compact', label: () => t('toolDisplayCompact') },
  { value: 'detailed', label: () => t('toolDisplayDetailed') },
]

const CUSTOM_SHELL_OPTION = '__custom__'

function customProfileId() {
  return `custom_${globalThis.crypto?.randomUUID?.().slice(0, 8) || Date.now().toString(36)}`
}

function profileNameFromCommand(command: string) {
  const normalized = command.trim()
  const executable = normalized.split(/[\\/]/).pop()?.replace(/^"|"$/g, '') || normalized
  if (/^bash(\.exe)?$/i.test(executable)) return 'Bash'
  if (/^zsh$/i.test(executable)) return 'Zsh'
  if (/^fish$/i.test(executable)) return 'Fish'
  if (/^cmd(\.exe)?$/i.test(executable)) return 'Command Prompt'
  if (/^powershell(\.exe)?$/i.test(executable)) return 'Windows PowerShell'
  if (/^pwsh(\.exe)?$/i.test(executable)) return 'PowerShell 7+'
  return executable || 'Custom Shell'
}

function DeleteIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function DefaultOptionsSettingsTab({ active }: { active?: boolean } = {}) {
  const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>('compact')
  const [showContextUsage, setShowContextUsage] = useState(false)
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true)
  const [autoCompactRequireConfirmation, setAutoCompactRequireConfirmation] = useState(true)
  const [autoCompactThresholdPercent, setAutoCompactThresholdPercent] = useState(80)
  const [autoCompactThresholdPercentInput, setAutoCompactThresholdPercentInput] = useState('80')
  const [autoCompactKeepRecentTurns, setAutoCompactKeepRecentTurns] = useState(0)
  const [goalMaxIterations, setGoalMaxIterations] = useState(20)
  const [goalMaxIterationsInput, setGoalMaxIterationsInput] = useState('20')
  const [autoArchiveEnabled, setAutoArchiveEnabled] = useState(false)
  const [systemNotificationsEnabled, setSystemNotificationsEnabled] = useState(false)
  const [systemNotificationPermission, setSystemNotificationPermission] = useState<SystemNotificationPermission>('unsupported')
  const [systemNotificationBusy, setSystemNotificationBusy] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(() => getAppLanguage())
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [error, setError] = useState('')
  const [terminalShellConfig, setTerminalShellConfig] = useState<TerminalShellConfig>({ terminalShell: 'auto', defaultProfileId: 'auto', profiles: [] })
  const [customShellCommand, setCustomShellCommand] = useState('')
  const [customShellEditorOpen, setCustomShellEditorOpen] = useState(false)

  // 保存排队/最新状态镜像：仅加载与事件回调更新，渲染读取 React state。
  const toolDisplayModeRef = useRef(toolDisplayMode)
  const showContextUsageRef = useRef(showContextUsage)
  const autoCompactRef = useRef({ enabled: autoCompactEnabled, thresholdPercent: autoCompactThresholdPercent, keepRecentTurns: autoCompactKeepRecentTurns, requireConfirmation: autoCompactRequireConfirmation })
  const goalMaxIterationsRef = useRef(goalMaxIterations)
  const autoArchiveEnabledRef = useRef(autoArchiveEnabled)
  const terminalShellConfigRef = useRef(terminalShellConfig)

  const markSaved = (message = t('defaultOptionsSaved')) => {
    setSaved(true)
    setSavedMessage(message)
    setError('')
  }

  const loadTerminalShell = async () => {
    try {
      const response = await fetch('/api/system/terminal-shell', { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      const config = {
        terminalShell: payload?.terminalShell || 'auto',
        defaultProfileId: payload?.defaultProfileId || 'auto',
        profiles: Array.isArray(payload?.profiles) ? payload.profiles : [],
      }
      setTerminalShellConfig(config)
      terminalShellConfigRef.current = config
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const loadSettings = async () => {
    try {
      const storage = getAppStorage()
      const [toolDisplaySettings, autoCompactSettings, goalSettings, autoArchiveSettings] = await Promise.all([
        loadToolDisplaySettings(storage),
        loadAutoCompactSettings(storage),
        loadGoalSettings(storage),
        loadAutoArchiveSettings(storage),
      ])
      setToolDisplayMode(toolDisplaySettings.toolDisplayMode)
      setShowContextUsage(toolDisplaySettings.showContextUsage)
      setAutoCompactEnabled(autoCompactSettings.enabled)
      setAutoCompactRequireConfirmation(autoCompactSettings.requireConfirmation)
      setAutoCompactThresholdPercent(autoCompactSettings.thresholdPercent)
      setAutoCompactThresholdPercentInput(String(autoCompactSettings.thresholdPercent))
      setAutoCompactKeepRecentTurns(autoCompactSettings.keepRecentTurns)
      setGoalMaxIterations(goalSettings.maxIterations)
      setGoalMaxIterationsInput(String(goalSettings.maxIterations))
      setAutoArchiveEnabled(autoArchiveSettings.enabled)
      toolDisplayModeRef.current = toolDisplaySettings.toolDisplayMode
      showContextUsageRef.current = toolDisplaySettings.showContextUsage
      autoCompactRef.current = autoCompactSettings
      goalMaxIterationsRef.current = goalSettings.maxIterations
      autoArchiveEnabledRef.current = autoArchiveSettings.enabled
      let nextNotificationsEnabled = isSystemNotificationsEnabled()
      const permission = await getSystemNotificationPermission()
      setSystemNotificationPermission(permission)
      // Reflect the permission in the UI only; the stored preference stays intact
      // until the user explicitly disables notifications.
      if (nextNotificationsEnabled && permission !== 'granted') {
        nextNotificationsEnabled = false
      }
      setSystemNotificationsEnabled(nextNotificationsEnabled)
      await loadTerminalShell()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // 旧版元素常驻、切走仅 detach：重新激活时重新加载已保存设置（中间态由常驻组件保留）。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    // One-shot async storage/API load; state updates report its result or failure.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSettings()
    // 首次激活与每次重新激活时加载；编辑中的表单草稿不会被 loadSettings 重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const updateLanguage = (value: string) => {
    const next = value === 'zh' ? 'zh' : 'en'
    setSelectedLanguage(next)
    void applyAppLanguage(getAppStorage(), next)
  }

  const updateToolDisplayMode = (next: ToolDisplayMode) => {
    if (toolDisplayMode === next) return
    setToolDisplayMode(next)
    toolDisplayModeRef.current = next
    setSaved(false)
    void saveToolDisplayOptions()
  }

  const updateShowContextUsage = (checked: boolean) => {
    setShowContextUsage(checked)
    showContextUsageRef.current = checked
    setSaved(false)
    void saveToolDisplayOptions()
  }

  const updateAutoCompactEnabled = (checked: boolean) => {
    setAutoCompactEnabled(checked)
    autoCompactRef.current = { ...autoCompactRef.current, enabled: checked }
    setSaved(false)
    void saveAutoCompactOptions()
  }

  const updateAutoCompactRequireConfirmation = (checked: boolean) => {
    setAutoCompactRequireConfirmation(checked)
    autoCompactRef.current = { ...autoCompactRef.current, requireConfirmation: checked }
    setSaved(false)
    void saveAutoCompactOptions()
  }

  const updateAutoArchiveEnabled = (checked: boolean) => {
    setAutoArchiveEnabled(checked)
    autoArchiveEnabledRef.current = checked
    setSaved(false)
    void saveAutoArchiveOptions()
  }

  const updateSystemNotifications = async (checked: boolean) => {
    setSystemNotificationBusy(true)
    setSaved(false)
    setError('')
    try {
      if (!checked) {
        persistSystemNotificationsEnabled(false)
        setSystemNotificationsEnabled(false)
        markSaved(t('systemNotificationsDisabled'))
        return
      }

      // Persist the enabled preference before requesting permission so native
      // initialization ordering is preserved; the switch still reflects the
      // permission outcome without revoking the stored preference.
      persistSystemNotificationsEnabled(true)
      const permission = await requestSystemNotificationPermission()
      setSystemNotificationPermission(permission)
      setSystemNotificationsEnabled(permission === 'granted')
      if (permission === 'granted') {
        markSaved(t('systemNotificationsEnabled'))
      } else if (permission === 'denied') {
        setError(t('systemNotificationsDeniedHelp'))
      } else if (permission === 'unsupported') {
        setError(t('systemNotificationsUnsupported'))
      }
    } catch (err) {
      // Keep the stored enable preference; only the UI reflects the failure.
      setSystemNotificationsEnabled(false)
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSystemNotificationBusy(false)
    }
  }

  const sendTestSystemNotification = async () => {
    setSystemNotificationBusy(true)
    setError('')
    try {
      const shown = await showTaskSystemNotification({
        key: `test:${Date.now()}`,
        title: t('systemNotificationTestTitle'),
        status: 'idle',
        force: true,
      })
      if (!shown) setError(t('systemNotificationTestFailed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('systemNotificationTestFailed'))
    } finally {
      setSystemNotificationBusy(false)
    }
  }

  const systemNotificationStatusText = () => {
    if (systemNotificationPermission === 'unsupported') return t('systemNotificationsUnsupported')
    if (systemNotificationPermission === 'denied') return t('systemNotificationsPermissionDenied')
    if (systemNotificationPermission === 'granted') return t('systemNotificationsPermissionGranted')
    return t('systemNotificationsPermissionPrompt')
  }

  const updateAutoCompactThresholdPercent = (value: string) => {
    setAutoCompactThresholdPercentInput(value)
    const parsed = Number(value)
    if (value !== '' && Number.isFinite(parsed)) {
      setAutoCompactThresholdPercent(parsed)
      autoCompactRef.current = { ...autoCompactRef.current, thresholdPercent: parsed }
    }
    setSaved(false)
  }

  const updateAutoCompactKeepRecentTurns = (value: string) => {
    const parsed = Number(value)
    const normalized = Number.isFinite(parsed) ? parsed : 0
    setAutoCompactKeepRecentTurns(normalized)
    autoCompactRef.current = { ...autoCompactRef.current, keepRecentTurns: normalized }
    setSaved(false)
  }

  const commitAutoCompactThresholdPercent = (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      setAutoCompactThresholdPercentInput(String(autoCompactThresholdPercent))
      return
    }
    const normalized = Math.max(50, Math.min(95, Math.round(parsed)))
    setAutoCompactThresholdPercent(normalized)
    setAutoCompactThresholdPercentInput(String(normalized))
    autoCompactRef.current = { ...autoCompactRef.current, thresholdPercent: normalized }
    void saveAutoCompactOptions()
  }

  const commitAutoCompactKeepRecentTurns = (value: string) => {
    const parsed = Number(value)
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.min(20, Math.round(parsed))) : 0
    setAutoCompactKeepRecentTurns(normalized)
    autoCompactRef.current = { ...autoCompactRef.current, keepRecentTurns: normalized }
    void saveAutoCompactOptions()
  }

  const updateGoalMaxIterations = (value: string) => {
    setGoalMaxIterationsInput(value)
    const parsed = Number(value)
    if (value !== '' && Number.isFinite(parsed)) {
      setGoalMaxIterations(parsed)
      goalMaxIterationsRef.current = parsed
    }
    setSaved(false)
  }

  const commitGoalMaxIterations = (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      setGoalMaxIterationsInput(String(goalMaxIterations))
      return
    }
    const normalized = Math.max(1, Math.min(100, Math.round(parsed)))
    setGoalMaxIterations(normalized)
    setGoalMaxIterationsInput(String(normalized))
    goalMaxIterationsRef.current = normalized
    void saveGoalOptions()
  }

  const customShellProfiles = () => {
    return terminalShellConfigRef.current.profiles.filter((profile) => !profile.builtin)
  }

  const selectedTerminalShellProfileId = () => {
    const config = terminalShellConfig
    const profiles = config.profiles
    if (profiles.some((profile) => profile.id === config.defaultProfileId)) {
      return config.defaultProfileId
    }
    return profiles[0]?.id || CUSTOM_SHELL_OPTION
  }

  const updateTerminalShellSelection = (value: string) => {
    if (value === CUSTOM_SHELL_OPTION) {
      setCustomShellEditorOpen(true)
      return
    }

    setCustomShellEditorOpen(false)
    void saveTerminalShellConfig(value)
  }

  const saveTerminalShellConfig = async (defaultProfileId: string, customProfiles = customShellProfiles(), message = t('terminalShellSaved')) => {
    try {
      const response = await fetch('/api/system/terminal-shell', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultProfileId, profiles: customProfiles }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
      setTerminalShellConfig(payload as TerminalShellConfig)
      terminalShellConfigRef.current = payload as TerminalShellConfig
      markSaved(message)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const addCustomTerminalShell = async () => {
    const command = customShellCommand.trim()
    if (!command) {
      setError(t('terminalShellProfileRequired'))
      return
    }

    const profile = { id: customProfileId(), name: profileNameFromCommand(command), command, builtin: false }
    const profiles = [
      ...customShellProfiles(),
      profile,
    ]
    setCustomShellCommand('')
    setCustomShellEditorOpen(false)
    await saveTerminalShellConfig(profile.id, profiles, t('terminalShellProfilesSaved'))
  }

  const deleteCustomTerminalShell = async (profileId: string) => {
    const profile = terminalShellConfigRef.current.profiles.find((item) => item.id === profileId)
    if (!profile || profile.builtin) return
    const confirmed = await showConfirm({
      description: t('terminalShellDeleteConfirm', { name: profile.name }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const profiles = customShellProfiles().filter((item) => item.id !== profileId)
    const defaultProfileId = terminalShellConfigRef.current.defaultProfileId === profileId ? 'auto' : terminalShellConfigRef.current.defaultProfileId
    await saveTerminalShellConfig(defaultProfileId, profiles, t('terminalShellProfilesSaved'))
  }

  const saveToolDisplayOptions = async () => {
    try {
      await saveToolDisplaySettings(getAppStorage(), {
        toolDisplayMode: toolDisplayModeRef.current,
        showContextUsage: showContextUsageRef.current,
      })
      markSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const saveAutoCompactOptions = async () => {
    try {
      await saveAutoCompactSettings(getAppStorage(), {
        enabled: autoCompactRef.current.enabled,
        thresholdPercent: autoCompactRef.current.thresholdPercent,
        keepRecentTurns: autoCompactRef.current.keepRecentTurns,
        minSourceChars: 1600,
        requireConfirmation: autoCompactRef.current.requireConfirmation,
      })
      markSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const saveGoalOptions = async () => {
    try {
      await saveGoalSettings(getAppStorage(), {
        maxIterations: goalMaxIterationsRef.current,
      })
      markSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const saveAutoArchiveOptions = async () => {
    try {
      await saveAutoArchiveSettings(getAppStorage(), { enabled: autoArchiveEnabledRef.current })
      markSaved(t('autoArchiveSaved'))
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const channel = new BroadcastChannel('quickforge-sync')
          channel.postMessage({
            type: 'settings-changed',
            sourceTabId: 'default-options-settings-tab',
            timestamp: Date.now(),
          })
          channel.close()
        } catch {
          // Cross-tab refresh is best-effort only.
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const languageOptions = () => [
    { value: 'zh', label: t('simplifiedChinese') },
    { value: 'en', label: t('english') },
  ]

  const terminalShellOptions = () => [
    ...terminalShellConfig.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    { value: CUSTOM_SHELL_OPTION, label: t('terminalShellCustomOption') },
  ]

  const terminalShellSettings = () => {
    const config = terminalShellConfig
    const profiles = config.profiles
    const selectedProfileId = selectedTerminalShellProfileId()
    const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
    const showCustomEditor = customShellEditorOpen || profiles.length === 0

    return (
      <section className="quickforge-settings-section" aria-label={t('terminalShell')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('terminalShellDefault')}
              <InfoTip label={t('terminalShellDescription')} />
            </div>
            <div className="quickforge-settings-row-description quickforge-settings-mono">
              {selectedProfile?.command || t('terminalShellNoDetected')}
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <SettingsSelect
              value={showCustomEditor ? CUSTOM_SHELL_OPTION : selectedProfileId}
              options={terminalShellOptions()}
              label={t('terminalShellDefault')}
              onChange={(value) => updateTerminalShellSelection(value)}
            />
            {selectedProfile && !selectedProfile.builtin && !showCustomEditor
              ? (
                <button
                  className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                  type="button"
                  title={t('delete')}
                  aria-label={t('delete')}
                  onClick={() => void deleteCustomTerminalShell(selectedProfile.id)}
                >
                  <DeleteIcon />
                </button>
              )
              : null}
          </div>
        </div>

        {showCustomEditor
          ? (
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">
                  {t('terminalShellCommand')}
                  <InfoTip label={t('terminalShellCustomDescription')} />
                </div>
              </div>
              <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-terminal-shell-command-control">
                <input
                  className="quickforge-settings-input quickforge-settings-mono"
                  type="text"
                  value={customShellCommand}
                  placeholder={t('terminalShellCommandPlaceholder')}
                  onChange={(event) => setCustomShellCommand(event.currentTarget.value)}
                />
                <button
                  className="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  title={t('terminalShellAdd')}
                  aria-label={t('terminalShellAdd')}
                  onClick={() => void addCustomTerminalShell()}
                >
                  {t('terminalShellAdd')}
                </button>
              </div>
            </div>
          )
          : null}
      </section>
    )
  }

  const renderToolDisplayModeOption = (option: { value: ToolDisplayMode; label: () => string }) => {
    const selected = toolDisplayMode === option.value
    return (
      <button
        key={option.value}
        type="button"
        className={`quickforge-settings-segmented-option${selected ? ' quickforge-settings-segmented-option-active' : ''}`}
        aria-pressed={selected ? 'true' : 'false'}
        onClick={() => updateToolDisplayMode(option.value)}
      >
        {option.label()}
      </button>
    )
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t('loading')}</div>
  }

  return (
    <div className="quickforge-settings-stack">
      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('settingsSectionBasics')}</h3>
        <section className="quickforge-settings-section" aria-label={t('settingsSectionBasics')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('language')}
              <InfoTip label={t('languageDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-compact">
            <SettingsSelect
              value={selectedLanguage}
              options={languageOptions()}
              label={t('language')}
              onChange={(value) => updateLanguage(value)}
            />
          </div>
        </div>
        </section>
      </div>

      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('settingsSectionInteraction')}</h3>
        <section className="quickforge-settings-section" aria-label={t('settingsSectionInteraction')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('toolDisplay')}
              <InfoTip label={t('toolDisplayModeDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <div className="quickforge-settings-segmented" role="group" aria-label={t('toolDisplay')}>
              {TOOL_DISPLAY_MODE_OPTIONS.map((option) => renderToolDisplayModeOption(option))}
            </div>
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('systemNotifications')}
              <InfoTip label={`${t('systemNotificationsDescription')} ${systemNotificationStatusText()}`} />
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            {systemNotificationsEnabled ? (
              <button
                className="quickforge-settings-button quickforge-settings-button-secondary"
                type="button"
                disabled={systemNotificationBusy}
                onClick={() => void sendTestSystemNotification()}
              >{t('systemNotificationsTest')}</button>
            ) : null}
            <SettingsSwitch
              checked={systemNotificationsEnabled}
              onChange={(checked) => { void updateSystemNotifications(checked) }}
              disabled={systemNotificationBusy || systemNotificationPermission === 'unsupported'}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('showContextUsage')}
              <InfoTip label={t('showContextUsageDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={showContextUsage} onChange={updateShowContextUsage} />
          </div>
        </div>
        </section>
      </div>

      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('settingsSectionContext')}</h3>
        <section className="quickforge-settings-section" aria-label={t('settingsSectionContext')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoArchiveEnabled')}
              <InfoTip label={`${t('autoArchiveDescription')} ${t('autoArchiveTriggerNote')}`} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={autoArchiveEnabled} onChange={updateAutoArchiveEnabled} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoCompactEnabled')}
              <InfoTip label={`${t('autoCompactDescription')} ${t('autoCompactTriggerNote')}`} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={autoCompactEnabled} onChange={updateAutoCompactEnabled} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoCompactRequireConfirmation')}
              <InfoTip label={t('autoCompactRequireConfirmationDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch
              checked={autoCompactRequireConfirmation}
              onChange={updateAutoCompactRequireConfirmation}
              disabled={!autoCompactEnabled}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoCompactThresholdPercent')}
              <InfoTip label={t('autoCompactThresholdDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsNumberInput
              className="quickforge-settings-input quickforge-settings-number-input"
              min="50"
              max="95"
              step="1"
              aria-label={t('autoCompactThresholdPercent')}
              value={autoCompactThresholdPercentInput}
              disabled={!autoCompactEnabled}
              onInput={updateAutoCompactThresholdPercent}
              onCommit={commitAutoCompactThresholdPercent}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoCompactKeepRecentTurns')}
              <InfoTip label={`${t('autoCompactHistoryPreserved')} ${t('autoCompactKeepRecentTurnsDescription')}`} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsNumberInput
              className="quickforge-settings-input quickforge-settings-number-input"
              min="0"
              max="20"
              step="1"
              aria-label={t('autoCompactKeepRecentTurns')}
              value={String(autoCompactKeepRecentTurns)}
              disabled={!autoCompactEnabled}
              onInput={updateAutoCompactKeepRecentTurns}
              onCommit={commitAutoCompactKeepRecentTurns}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('goalMaxIterations')}
              <InfoTip label={t('goalMaxIterationsDescription')} />
            </div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsNumberInput
              className="quickforge-settings-input quickforge-settings-number-input"
              min="1"
              max="100"
              step="1"
              aria-label={t('goalMaxIterations')}
              value={goalMaxIterationsInput}
              onInput={updateGoalMaxIterations}
              onCommit={commitGoalMaxIterations}
            />
          </div>
        </div>
        </section>
      </div>

      <div className="quickforge-settings-group">
        <h3 className="quickforge-settings-group-title">{t('settingsSectionTerminal')}</h3>
        {terminalShellSettings()}
      </div>

      {saved ? <div className="quickforge-settings-message" role="status">{savedMessage || t('defaultOptionsSaved')}</div> : null}
      {error ? <div className="quickforge-settings-alert" role="alert">{error}</div> : null}
    </div>
  )
}
