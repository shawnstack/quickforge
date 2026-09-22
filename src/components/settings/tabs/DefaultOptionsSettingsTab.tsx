import { useEffect, useRef, useState } from 'react'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getAppStorage } from '@/storage'
import {
  defaultThinkingLevelForModel,
  getSelectableConfiguredModels,
  loadDefaultOptions,
  mergeAvailableModels,
  saveDefaultOptions,
} from '@/lib/pi-chat'
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
import { modelDisplayLabel as modelLabel } from '@/lib/model-display-label'
import { loadModelCatalog } from '@/lib/model-reference'
import { InfoTip } from '@/components/ui/info-tip'
import { SettingsSelect, SettingsSwitch } from './shared'
import { SettingsNumberInput } from './SettingsNumberInput'

type AnyModel = Model<Api>

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

type NetworkProxyMode = 'direct' | 'system' | 'manual' | 'pac'

type NetworkProxyState = {
  config: {
    mode: NetworkProxyMode
    proxyUrl: string
  }
  status: {
    effectiveMode: NetworkProxyMode | 'unsupported'
    supported: boolean
    source: string
    runtimeKind: string
    features?: {
      pac?: boolean
      pacUrl?: boolean
      wpad?: boolean
      socks?: boolean
    }
    error?: string
  }
}

const THINKING_OPTIONS: { value: ThinkingLevel; label: () => string }[] = [
  { value: 'off', label: () => t('thinkingOff') },
  { value: 'low', label: () => t('thinkingLow') },
  { value: 'medium', label: () => t('thinkingMedium') },
  { value: 'high', label: () => t('thinkingHigh') },
  { value: 'xhigh', label: () => t('thinkingXHigh') },
]

const TOOL_DISPLAY_MODE_OPTIONS: { value: ToolDisplayMode; label: () => string }[] = [
  { value: 'compact', label: () => t('toolDisplayCompact') },
  { value: 'detailed', label: () => t('toolDisplayDetailed') },
]

const CUSTOM_SHELL_OPTION = '__custom__'

function normalizeBaseUrl(value?: string) {
  return (value ?? '').trim().replace(/\/$/, '')
}

function modelKey(model: AnyModel) {
  return JSON.stringify([
    model.provider,
    model.id,
    model.api,
    normalizeBaseUrl(model.baseUrl),
  ])
}

/** 按目录键查找模型（updateModel 的手动选择逻辑）。 */
function findModelByValue(models: AnyModel[], value: string) {
  return models.find((model) => modelKey(model) === value)
}

/** 启动默认模型解析：优先精确匹配持久化默认，回退目录第一项。 */
function resolveDefaultModel(models: AnyModel[], savedModel?: AnyModel) {
  return savedModel
    ? findModelByValue(models, modelKey(savedModel)) ?? models[0]
    : models[0]
}

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
  const [models, setModels] = useState<AnyModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AnyModel | undefined>(undefined)

  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const [toolDisplayMode, setToolDisplayMode] = useState<ToolDisplayMode>('compact')
  const [showContextUsage, setShowContextUsage] = useState(false)
  const [expandProcessStageByDefault, setExpandProcessStageByDefault] = useState(true)
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
  const [networkProxyMode, setNetworkProxyMode] = useState<NetworkProxyMode>('direct')
  const [networkProxyUrl, setNetworkProxyUrl] = useState('')
  const [savedNetworkProxyConfig, setSavedNetworkProxyConfig] = useState({ mode: 'direct' as NetworkProxyMode, proxyUrl: '' })
  const [networkProxyStatus, setNetworkProxyStatus] = useState<NetworkProxyState['status'] | null>(null)
  const [networkProxySaving, setNetworkProxySaving] = useState(false)
  const [networkProxyLoaded, setNetworkProxyLoaded] = useState(false)

  // 保存排队/最新状态镜像：仅加载与事件回调更新，渲染读取 React state。
  const defaultOptionsSavePromiseRef = useRef<Promise<void>>(Promise.resolve())
  const selectedModelRef = useRef(selectedModel)
  const thinkingLevelRef = useRef(thinkingLevel)
  const toolDisplayModeRef = useRef(toolDisplayMode)
  const showContextUsageRef = useRef(showContextUsage)
  const expandProcessStageByDefaultRef = useRef(expandProcessStageByDefault)
  const autoCompactRef = useRef({ enabled: autoCompactEnabled, thresholdPercent: autoCompactThresholdPercent, keepRecentTurns: autoCompactKeepRecentTurns, requireConfirmation: autoCompactRequireConfirmation })
  const goalMaxIterationsRef = useRef(goalMaxIterations)
  const autoArchiveEnabledRef = useRef(autoArchiveEnabled)
  const networkProxyRef = useRef({ mode: networkProxyMode, url: networkProxyUrl, saving: networkProxySaving, loaded: networkProxyLoaded, status: networkProxyStatus })
  const terminalShellConfigRef = useRef(terminalShellConfig)

  const markSaved = (message = t('defaultOptionsSaved')) => {
    setSaved(true)
    setSavedMessage(message)
    setError('')
  }

  const loadNetworkProxy = async () => {
    try {
      const response = await fetch('/api/system/network-proxy', { cache: 'no-store' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      const mode = payload?.config?.mode || 'direct'
      const url = payload?.config?.proxyUrl || ''
      setNetworkProxyMode(mode)
      setNetworkProxyUrl(url)
      setSavedNetworkProxyConfig({ mode, proxyUrl: url })
      setNetworkProxyStatus(payload?.status || null)
      setNetworkProxyLoaded(true)
      networkProxyRef.current = { ...networkProxyRef.current, mode, url, status: payload?.status || null, loaded: true }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
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
      const [localModels, catalogModels, defaults, toolDisplaySettings, autoCompactSettings, goalSettings, autoArchiveSettings] = await Promise.all([
        getSelectableConfiguredModels(storage),
        loadModelCatalog().catch(() => []),
        loadDefaultOptions(storage),
        loadToolDisplaySettings(storage),
        loadAutoCompactSettings(storage),
        loadGoalSettings(storage),
        loadAutoArchiveSettings(storage),
      ])
      const baseModels = catalogModels.length ? catalogModels : localModels
      const nextModels = mergeAvailableModels(baseModels, [])
      const nextSelectedModel = resolveDefaultModel(nextModels, defaults.model)
      setModels(nextModels)
      setSelectedModel(nextSelectedModel)
      selectedModelRef.current = nextSelectedModel
      const nextThinkingLevel = defaults.thinkingLevel ?? defaultThinkingLevelForModel(nextSelectedModel)
      setThinkingLevel(nextThinkingLevel)
      thinkingLevelRef.current = nextThinkingLevel
      setToolDisplayMode(toolDisplaySettings.toolDisplayMode)
      setShowContextUsage(toolDisplaySettings.showContextUsage)
      setExpandProcessStageByDefault(toolDisplaySettings.expandProcessStageByDefault)
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
      expandProcessStageByDefaultRef.current = toolDisplaySettings.expandProcessStageByDefault
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
      await Promise.all([
        loadTerminalShell(),
        loadNetworkProxy(),
      ])
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

  const updateModel = (value: string) => {
    const nextModel = findModelByValue(models, value)
    setSelectedModel(nextModel)
    selectedModelRef.current = nextModel
    const nextThinkingLevel = defaultThinkingLevelForModel(nextModel)
    setThinkingLevel(nextThinkingLevel)
    thinkingLevelRef.current = nextThinkingLevel
    setSaved(false)
    void saveDefaultModelOptions()
  }

  const updateThinkingLevel = (value: string) => {
    const next = THINKING_OPTIONS.some((option) => option.value === value) ? value as ThinkingLevel : 'off'
    setThinkingLevel(next)
    thinkingLevelRef.current = next
    setSaved(false)
    void saveDefaultModelOptions()
  }

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

  const updateExpandProcessStageByDefault = (checked: boolean) => {
    setExpandProcessStageByDefault(checked)
    expandProcessStageByDefaultRef.current = checked
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

  const updateNetworkProxyMode = (mode: NetworkProxyMode) => {
    const proxy = networkProxyRef.current
    if (proxy.mode === mode || proxy.saving || !proxy.loaded) return
    if (mode === 'pac' && proxy.status?.features?.pacUrl !== true) return
    setNetworkProxyMode(mode)
    networkProxyRef.current = { ...proxy, mode }
    setSaved(false)
    setError('')
    if (mode === 'manual' || mode === 'pac') return
    void saveNetworkProxy()
  }

  const updateNetworkProxyUrl = (value: string) => {
    setNetworkProxyUrl(value)
    networkProxyRef.current = { ...networkProxyRef.current, url: value }
    setSaved(false)
  }

  const networkProxyValidationError = (proxy = { mode: networkProxyMode, url: networkProxyUrl }) => {
    const value = proxy.url.trim()
    const isPac = proxy.mode === 'pac'
    if (!value) return t(isPac ? 'networkProxyPacUrlRequired' : 'networkProxyAddressRequired')
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        return t(isPac ? 'networkProxyPacUrlProtocolError' : 'networkProxyAddressProtocolError')
      }
      if (!url.hostname) return t(isPac ? 'networkProxyPacUrlHostError' : 'networkProxyAddressPortError')
      if (!isPac && !url.port) return t('networkProxyAddressPortError')
      if (url.username || url.password) {
        return t(isPac ? 'networkProxyPacUrlCredentialsError' : 'networkProxyAddressCredentialsError')
      }
      if (isPac && url.hash) return t('networkProxyPacUrlFragmentError')
      if (!isPac && ((url.pathname && url.pathname !== '/') || url.search || url.hash)) {
        return t('networkProxyAddressPathError')
      }
      return ''
    } catch {
      return t(isPac ? 'networkProxyPacUrlInvalid' : 'networkProxyAddressInvalid')
    }
  }

  const saveNetworkProxy = async () => {
    const proxy = networkProxyRef.current
    if (proxy.saving || !proxy.loaded) return
    if (proxy.mode === 'pac' && proxy.status?.features?.pacUrl !== true) {
      setSaved(false)
      setError(t('networkProxyPacUnsupported'))
      return
    }
    if (proxy.mode === 'manual' || proxy.mode === 'pac') {
      const validationError = networkProxyValidationError(proxy)
      if (validationError) {
        setSaved(false)
        setError(validationError)
        return
      }
    }
    setNetworkProxySaving(true)
    networkProxyRef.current = { ...proxy, saving: true }
    setSaved(false)
    setError('')
    try {
      const response = await fetch('/api/system/network-proxy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: proxy.mode, proxyUrl: proxy.url }),
      })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      const mode = payload?.config?.mode || proxy.mode
      const url = payload?.config?.proxyUrl || ''
      setNetworkProxyMode(mode)
      setNetworkProxyUrl(url)
      setSavedNetworkProxyConfig({ mode, proxyUrl: url })
      setNetworkProxyStatus(payload?.status || null)
      networkProxyRef.current = { mode, url, saving: false, loaded: true, status: payload?.status || null }
      markSaved(t('networkProxySaved'))
    } catch (err) {
      setNetworkProxyMode(savedNetworkProxyConfig.mode)
      setNetworkProxyUrl(savedNetworkProxyConfig.proxyUrl)
      networkProxyRef.current = { ...networkProxyRef.current, mode: savedNetworkProxyConfig.mode, url: savedNetworkProxyConfig.proxyUrl }
      setSaved(false)
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setNetworkProxySaving(false)
      networkProxyRef.current = { ...networkProxyRef.current, saving: false }
    }
  }

  const refreshNetworkProxy = async () => {
    const proxy = networkProxyRef.current
    if (proxy.saving || !proxy.loaded) return
    setNetworkProxySaving(true)
    networkProxyRef.current = { ...proxy, saving: true }
    setSaved(false)
    setError('')
    try {
      const response = await fetch('/api/system/network-proxy/refresh', { method: 'POST' })
      const payload = await response.json().catch(() => null) as NetworkProxyState | null
      if (!response.ok) throw new Error((payload as { error?: string } | null)?.error || t('requestFailed'))
      setNetworkProxyStatus(payload?.status || null)
      networkProxyRef.current = { ...networkProxyRef.current, status: payload?.status || null }
      markSaved(t('networkProxyRefreshed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setNetworkProxySaving(false)
      networkProxyRef.current = { ...networkProxyRef.current, saving: false }
    }
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

  const saveDefaultModelOptions = async () => {
    const model = selectedModelRef.current
    const level = model?.reasoning ? thinkingLevelRef.current : 'off'
    const save = async () => {
      try {
        await saveDefaultOptions(getAppStorage(), {
          model,
          thinkingLevel: level,
        })
        markSaved()
      } catch (err) {
        setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    defaultOptionsSavePromiseRef.current = defaultOptionsSavePromiseRef.current.then(save, save)
    await defaultOptionsSavePromiseRef.current
  }

  const saveToolDisplayOptions = async () => {
    try {
      await saveToolDisplaySettings(getAppStorage(), {
        toolDisplayMode: toolDisplayModeRef.current,
        showContextUsage: showContextUsageRef.current,
        expandProcessStageByDefault: expandProcessStageByDefaultRef.current,
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
      await saveGoalSettings(getAppStorage(), { maxIterations: goalMaxIterationsRef.current })
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

  const modelSelectOptions = () => models.map((model) => ({ value: modelKey(model), label: modelLabel(model) }))

  const thinkingOptions = () => THINKING_OPTIONS.map((option) => ({ value: option.value, label: option.label() }))

  const terminalShellOptions = () => [
    ...terminalShellConfig.profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    { value: CUSTOM_SHELL_OPTION, label: t('terminalShellCustomOption') },
  ]

  const renderNetworkProxyModeOption = (mode: NetworkProxyMode, label: string) => {
    const selected = networkProxyMode === mode
    const unsupported = mode === 'pac' && networkProxyStatus?.features?.pacUrl !== true
    return (
      <button
        key={mode}
        type="button"
        className={`quickforge-settings-segmented-option${selected ? ' quickforge-settings-segmented-option-active' : ''}`}
        aria-pressed={selected ? 'true' : 'false'}
        title={unsupported ? t('networkProxyPacUnsupported') : ''}
        disabled={networkProxySaving || !networkProxyLoaded || unsupported}
        onClick={() => updateNetworkProxyMode(mode)}
      >
        {label}
      </button>
    )
  }

  const networkProxySettings = () => {
    const hasProxyUrlInput = networkProxyMode === 'manual' || networkProxyMode === 'pac'
    const pacUnsupported = networkProxyMode === 'pac' && networkProxyStatus?.features?.pacUrl !== true
    const proxyValidationError = hasProxyUrlInput ? networkProxyValidationError() : ''
    const hasUnsavedProxyUrl = hasProxyUrlInput && (
      networkProxyUrl !== savedNetworkProxyConfig.proxyUrl
      || savedNetworkProxyConfig.mode !== networkProxyMode
    )
    const statusText = !networkProxyLoaded
      ? t('networkProxyLoadFailed')
      : pacUnsupported
        ? t('networkProxyPacUnsupported')
        : networkProxyStatus?.supported === false
          ? networkProxyStatus.error || t('networkProxyUnsupported')
          : t('networkProxyStatus', {
              source: networkProxyStatus?.source || t('unknown'),
              runtime: networkProxyStatus?.runtimeKind || t('unknown'),
            })

    return (
      <section className="quickforge-settings-section" aria-label={t('networkConnection')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('networkProxyMode')}
              <InfoTip label={t('networkProxyDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{statusText}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <div className="quickforge-settings-segmented quickforge-settings-segmented-wrap" role="group" aria-label={t('networkProxyMode')}>
              {renderNetworkProxyModeOption('direct', t('networkProxyDirect'))}
              {renderNetworkProxyModeOption('system', t('networkProxySystem'))}
              {renderNetworkProxyModeOption('manual', t('networkProxyManual'))}
              {renderNetworkProxyModeOption('pac', t('networkProxyPac'))}
            </div>
          </div>
        </div>

        {hasProxyUrlInput
          ? (
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">
                  {t(networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                </div>
                <div className="quickforge-settings-row-description">
                  {t(networkProxyMode === 'pac' ? 'networkProxyPacUrlDescription' : 'networkProxyAddressDescription')}
                </div>
              </div>
              <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-network-proxy-control">
                <input
                  id="quickforge-network-proxy-url"
                  className="quickforge-settings-input quickforge-settings-mono"
                  type="url"
                  aria-label={t(networkProxyMode === 'pac' ? 'networkProxyPacUrl' : 'networkProxyAddress')}
                  aria-invalid={hasUnsavedProxyUrl && proxyValidationError ? 'true' : 'false'}
                  value={networkProxyUrl}
                  placeholder={networkProxyMode === 'pac' ? 'https://example.com/proxy.pac' : 'http://127.0.0.1:7890'}
                  disabled={networkProxySaving || !networkProxyLoaded || pacUnsupported}
                  onChange={(event) => updateNetworkProxyUrl(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && networkProxyUrl.trim()) {
                      event.preventDefault()
                      void saveNetworkProxy()
                    }
                  }}
                />
                <button
                  className="quickforge-settings-button quickforge-settings-button-primary"
                  type="button"
                  disabled={networkProxySaving || !networkProxyLoaded || pacUnsupported || Boolean(proxyValidationError) || !hasUnsavedProxyUrl}
                  onClick={() => void saveNetworkProxy()}
                >
                  {networkProxySaving ? t('saving') : t('networkProxySave')}
                </button>
              </div>
            </div>
          )
          : null}

        {networkProxyMode === 'system'
          ? (
            <div className="quickforge-settings-row">
              <div className="quickforge-settings-row-main">
                <div className="quickforge-settings-row-title">{t('networkProxyRefresh')}</div>
                <div className="quickforge-settings-row-description">{t('networkProxyRefreshDescription')}</div>
              </div>
              <div className="quickforge-settings-row-control">
                <button
                  className="quickforge-settings-button"
                  type="button"
                  disabled={networkProxySaving || !networkProxyLoaded}
                  onClick={() => void refreshNetworkProxy()}
                >
                  {networkProxySaving ? t('saving') : t('networkProxyRefresh')}
                </button>
              </div>
            </div>
          )
          : null}
      </section>
    )
  }

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
                <div className="quickforge-settings-row-title">{t('terminalShellCommand')}</div>
                <div className="quickforge-settings-row-description">{t('terminalShellCustomDescription')}</div>
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
      <section className="quickforge-settings-section" aria-label={t('defaultOptions')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('language')}
              <InfoTip label={t('languageDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('displayLanguage')}</div>
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

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('defaultModel')}</div>
            <div className="quickforge-settings-row-description">{t('defaultModelDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <SettingsSelect
              value={selectedModel ? modelKey(selectedModel) : ''}
              options={modelSelectOptions()}
              disabled={models.length === 0}
              searchable
              searchPlaceholder={t('search')}
              noResultsLabel={t('noMatchingOptions')}
              placeholder={t('noModelAvailable')}
              label={t('defaultModel')}
              onChange={(value) => updateModel(value)}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('defaultThinkingLevel')}</div>
            <div className="quickforge-settings-row-description">
              {selectedModel?.reasoning ? t('defaultThinkingLevelDescription') : t('thinkingRequiresReasoningModel')}
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-compact">
            <SettingsSelect
              value={thinkingLevel}
              options={thinkingOptions()}
              disabled={!selectedModel?.reasoning}
              label={t('defaultThinkingLevel')}
              onChange={(value) => updateThinkingLevel(value)}
            />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('toolDisplay')}
              <InfoTip label={t('toolDisplayModeDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('toolDisplayModeDescription')}</div>
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
              {t('expandProcessStageByDefault')}
              <InfoTip label={t('expandProcessStageByDefaultDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('expandProcessStageByDefaultDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={expandProcessStageByDefault} onChange={updateExpandProcessStageByDefault} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('systemNotifications')}
              <InfoTip label={t('systemNotificationsDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{systemNotificationStatusText()}</div>
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
            <div className="quickforge-settings-row-description">{t('showContextUsageDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={showContextUsage} onChange={updateShowContextUsage} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoArchiveEnabled')}
              <InfoTip label={t('autoArchiveDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('autoArchiveTriggerNote')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={autoArchiveEnabled} onChange={updateAutoArchiveEnabled} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('autoCompactEnabled')}
              <InfoTip label={t('autoCompactDescription')} />
            </div>
            <div className="quickforge-settings-row-description">{t('autoCompactTriggerNote')}</div>
          </div>
          <div className="quickforge-settings-row-control">
            <SettingsSwitch checked={autoCompactEnabled} onChange={updateAutoCompactEnabled} />
          </div>
        </div>

        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('autoCompactRequireConfirmation')}</div>
            <div className="quickforge-settings-row-description">{t('autoCompactRequireConfirmationDescription')}</div>
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
            <div className="quickforge-settings-row-title">{t('autoCompactThresholdPercent')}</div>
            <div className="quickforge-settings-row-description">{t('autoCompactThresholdDescription')}</div>
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
              <InfoTip label={t('autoCompactHistoryPreserved')} />
            </div>
            <div className="quickforge-settings-row-description">{t('autoCompactKeepRecentTurnsDescription')}</div>
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
            <div className="quickforge-settings-row-title">{t('goalMaxIterations')}</div>
            <div className="quickforge-settings-row-description">{t('goalMaxIterationsDescription')}</div>
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

      {networkProxySettings()}

      {terminalShellSettings()}

      {saved ? <div className="quickforge-settings-message" role="status">{savedMessage || t('defaultOptionsSaved')}</div> : null}
      {error ? <div className="quickforge-settings-alert" role="alert">{error}</div> : null}
    </div>
  )
}
