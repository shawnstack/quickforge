import { useEffect, useRef, useState } from 'react'
import {
  getAppStorage,
  type CustomProvider,
  type CustomProviderType,
} from '@/storage'
import type { Api, Model } from '@earendil-works/pi-ai'
import { t } from '@/lib/i18n'
import { DEFAULT_CONNECTION, normalizeModelForProvider } from '@/lib/pi-chat'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { clearModelListCache } from '@/lib/model-list-cache'
import { InfoTip } from '@/components/ui/info-tip'

type ProviderProtocol = Extract<CustomProviderType, 'openai-completions' | 'anthropic-messages'>
type AnyModel = Model<Api> & { quickforgeHidden?: boolean }

type ModelForm = {
  modelId: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  supportsImages: boolean
  visibleInSelectors: boolean
  open?: boolean
}

type HeaderRow = { key: string; value: string }

type ProviderForm = {
  providerId?: string
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  headerRows: HeaderRow[]
  protocol: ProviderProtocol
  models: ModelForm[]
}

type PresetKey = 'openai' | 'deepseek' | 'glm' | 'ollama' | 'litellm' | 'custom'

// Preset values that get filled into the form fields. Labels for the chips come
// from i18n; these are the concrete provider/model values.
const PROVIDER_PRESETS: Record<Exclude<PresetKey, 'custom'>, {
  name: string
  baseUrl: string
  protocol: ProviderProtocol
  modelId: string
  supportsImages?: boolean
}> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai-completions', modelId: 'gpt-4o', supportsImages: true },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-completions', modelId: 'deepseek-chat' },
  glm: { name: 'Zhipu GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-completions', modelId: 'glm-4-plus' },
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', protocol: 'openai-completions', modelId: 'llama3.1' },
  litellm: { name: DEFAULT_CONNECTION.name, baseUrl: DEFAULT_CONNECTION.baseUrl, protocol: 'openai-completions', modelId: DEFAULT_CONNECTION.modelId, supportsImages: DEFAULT_CONNECTION.supportsImages },
}

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: 'openai', label: t('presetOpenai') },
  { key: 'deepseek', label: t('presetDeepseek') },
  { key: 'glm', label: t('presetGlm') },
  { key: 'ollama', label: t('presetOllama') },
  { key: 'litellm', label: t('presetLitellm') },
  { key: 'custom', label: t('presetCustom') },
]

const emptyModelForm = (): ModelForm => ({
  modelId: '',
  contextWindow: DEFAULT_CONNECTION.contextWindow,
  maxTokens: DEFAULT_CONNECTION.maxTokens,
  reasoning: true,
  supportsImages: false,
  visibleInSelectors: true,
  open: false,
})

const emptyForm = (): ProviderForm => ({
  name: DEFAULT_CONNECTION.name,
  baseUrl: DEFAULT_CONNECTION.baseUrl,
  apiKey: '',
  headerRows: [],
  protocol: 'openai-completions',
  models: [emptyModelForm()],
})

export type CustomProvidersSettingsTabProps = {
  /** 打开设置页后自动进入该名称供应商的编辑表单（自定义模型入口跳转用）。 */
  customProvider?: string
  /** 设置页切换 tab 时的激活标记；false = 已切走（停掉加载），undefined 视为激活。 */
  active?: boolean
}

export function CustomProvidersSettingsTab({ customProvider, active }: CustomProvidersSettingsTabProps) {
  const [providers, setProviders] = useState<CustomProvider[]>([])
  const [form, setForm] = useState<ProviderForm>(emptyForm)
  const [editingProviderId, setEditingProviderId] = useState<string | undefined>(undefined)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)

  // Progressive disclosure / connection-test UI state
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [activePreset, setActivePreset] = useState<PresetKey | ''>('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [testError, setTestError] = useState('')

  // 表单状态经 ref 供异步流程（autoEdit、保存、测试）读取最新值。
  const formRef = useRef(form)
  const providersRef = useRef(providers)
  const editingProviderIdRef = useRef(editingProviderId)
  // 深链自动进入编辑只消费一次（对齐旧版 Lit 的 autoEditProviderName 消费后置空），
  // 否则每次重新激活都会用已保存的供应商覆盖用户正在编辑的表单草稿。
  const autoEditConsumedRef = useRef(false)
  useEffect(() => {
    formRef.current = form
    providersRef.current = providers
    editingProviderIdRef.current = editingProviderId
  }, [form, providers, editingProviderId])

  const loadProviders = async () => {
    setLoading(true)
    try {
      const next = await getAppStorage().customProviders.getAll()
      providersRef.current = next
      setProviders(next)
    } catch (error) {
      logger.error('Failed to load custom providers:', error)
      providersRef.current = []
      setProviders([])
    } finally {
      setLoading(false)
    }
  }

  const resetTestState = () => {
    setTesting(false)
    setTestResult('idle')
    setTestError('')
  }

  const openAddForm = () => {
    setEditingProviderId(undefined)
    editingProviderIdRef.current = undefined
    setForm(emptyForm())
    setApiKeyVisible(false)
    setAdvancedOpen(false)
    setActivePreset('')
    resetTestState()
    setFormOpen(true)
  }

  const openEditForm = async (provider: CustomProvider) => {
    const apiKey = (await getAppStorage().providerKeys.get(provider.name)) ?? provider.apiKey ?? ''

    const existingModels = provider.models ?? []
    const models: ModelForm[] =
      existingModels.length > 0
        ? existingModels.map((model) => ({
            modelId: model.id,
            contextWindow: model.contextWindow ?? DEFAULT_CONNECTION.contextWindow,
            maxTokens: model.maxTokens ?? DEFAULT_CONNECTION.maxTokens,
            reasoning: model.reasoning === true,
            supportsImages: model.input?.includes('image') === true,
            visibleInSelectors: (model as AnyModel).quickforgeHidden !== true,
            open: false,
          }))
        : [emptyModelForm()]

    const sourceHeaders = existingModels[0]?.headers ?? {}
    const headerRows: HeaderRow[] = Object.entries(sourceHeaders).map(([key, value]) => ({
      key,
      value: String(value),
    }))

    const nextForm: ProviderForm = {
      providerId: provider.id,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey,
      headerRows,
      protocol: provider.type === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions',
      models,
    }
    setEditingProviderId(provider.id)
    editingProviderIdRef.current = provider.id
    setForm(nextForm)
    formRef.current = nextForm
    setApiKeyVisible(false)
    setAdvancedOpen(headerRows.length > 0 || provider.type === 'anthropic-messages')
    setActivePreset('')
    resetTestState()
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingProviderId(undefined)
    editingProviderIdRef.current = undefined
    setForm(emptyForm())
    setApiKeyVisible(false)
    setAdvancedOpen(false)
    setActivePreset('')
    resetTestState()
  }

  const updateForm = <K extends keyof ProviderForm>(key: K, value: ProviderForm[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      formRef.current = next
      return next
    })
    // Manual edits to identity fields invalidate the active preset highlight.
    if (key === 'name' || key === 'baseUrl') {
      setActivePreset('')
    }
    resetTestState()
  }

  const updateModelField = (index: number, key: keyof ModelForm, value: string | number | boolean) => {
    setForm((current) => {
      const models = current.models.map((model, i) =>
        i === index ? { ...model, [key]: value } : model,
      )
      const next = { ...current, models }
      formRef.current = next
      return next
    })
    if (key === 'modelId') {
      setActivePreset('')
      resetTestState()
    }
  }

  const addModelRow = () => {
    setForm((current) => {
      const next = { ...current, models: [...current.models, emptyModelForm()] }
      formRef.current = next
      return next
    })
  }

  const removeModelRow = (index: number) => {
    setForm((current) => {
      const models = current.models.filter((_, i) => i !== index)
      const next = { ...current, models }
      formRef.current = next
      return next
    })
  }

  const toggleModelExpanded = (index: number) => {
    setForm((current) => {
      const models = current.models.map((model, i) =>
        i === index ? { ...model, open: !model.open } : model,
      )
      const next = { ...current, models }
      formRef.current = next
      return next
    })
  }

  const addHeaderRow = () => {
    setForm((current) => {
      const next = { ...current, headerRows: [...current.headerRows, { key: '', value: '' }] }
      formRef.current = next
      return next
    })
  }

  const updateHeaderRow = (index: number, field: keyof HeaderRow, value: string) => {
    setForm((current) => {
      const headerRows = current.headerRows.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      )
      const next = { ...current, headerRows }
      formRef.current = next
      return next
    })
  }

  const removeHeaderRow = (index: number) => {
    setForm((current) => {
      const headerRows = current.headerRows.filter((_, i) => i !== index)
      const next = { ...current, headerRows }
      formRef.current = next
      return next
    })
  }

  const applyPreset = (key: PresetKey) => {
    setActivePreset(key)
    if (key === 'custom') {
      setForm((current) => {
        const next = {
          ...current,
          name: '',
          baseUrl: '',
          protocol: 'openai-completions' as const,
          models: [emptyModelForm()],
        }
        formRef.current = next
        return next
      })
    } else {
      const preset = PROVIDER_PRESETS[key]
      setForm((current) => {
        const next = {
          ...current,
          name: preset.name,
          baseUrl: preset.baseUrl,
          protocol: preset.protocol,
          models: [{ ...emptyModelForm(), modelId: preset.modelId, supportsImages: preset.supportsImages === true, open: false }],
        }
        formRef.current = next
        return next
      })
    }
    resetTestState()
  }

  useEffect(() => {
    // 旧版 Lit tab 元素常驻、切走仅 detach：每次重新激活（connectedCallback）都重新拉取供应商列表。
    // 无 props（active === undefined）视为激活，保持既有直接调用语义。
    if (active === false) return
    let cancelled = false
    void (async () => {
      await loadProviders()
      if (cancelled) return
      if (customProvider && !autoEditConsumedRef.current) {
        autoEditConsumedRef.current = true
        const provider = providersRef.current.find((p) => p.name === customProvider)
        if (provider) {
          await openEditForm(provider)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // 首次激活与每次重新激活时重新加载列表；编辑中的表单草稿不会被 loadProviders 重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Build a headers object from the key/value rows, skipping empty rows.
  const buildHeadersFromRows = (): Record<string, string> => {
    const headers: Record<string, string> = {}
    for (const row of formRef.current.headerRows) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (key && value) {
        headers[key] = value
      }
    }
    return headers
  }

  const buildModel = (modelForm: ModelForm, headers: Record<string, string>): AnyModel => {
    const name = formRef.current.name.trim()
    const baseUrl = formRef.current.baseUrl.trim()
    const isReasoningModel = modelForm.reasoning === true
    const supportsImages = modelForm.supportsImages === true
    const input: ('text' | 'image')[] = supportsImages ? ['text', 'image'] : ['text']
    const isDeepSeek = baseUrl.includes('api.deepseek.com')

    const model = {
      id: modelForm.modelId,
      name: `${modelForm.modelId} (${name})`,
      api: formRef.current.protocol,
      provider: name,
      baseUrl: baseUrl.replace(/\/$/, ''),
      reasoning: isReasoningModel,
      input,
      quickforgeHidden: modelForm.visibleInSelectors ? undefined : true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: Number(modelForm.contextWindow) || DEFAULT_CONNECTION.contextWindow,
      maxTokens: Number(modelForm.maxTokens) || DEFAULT_CONNECTION.maxTokens,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      thinkingLevelMap:
        isDeepSeek && isReasoningModel
          ? {
              low: 'high',
              medium: 'high',
              high: 'high',
              xhigh: 'max',
            }
          : undefined,
      compat:
        formRef.current.protocol === 'openai-completions'
          ? {
              supportsStore: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: isReasoningModel,
              supportsUsageInStreaming: false,
              supportsStrictMode: false,
              maxTokensField: 'max_tokens',
              // DeepSeek V4 requires reasoning_content on assistant messages in tool-call rounds
              ...(isDeepSeek && isReasoningModel
                ? {
                    requiresReasoningContentOnAssistantMessages: true,
                    thinkingFormat: 'deepseek' as const,
                  }
                : {}),
            }
          : undefined,
    } satisfies AnyModel

    return normalizeModelForProvider(model)
  }

  const testConnection = async () => {
    const baseUrl = formRef.current.baseUrl.trim()
    const firstModel = formRef.current.models.find((m) => m.modelId.trim())
    if (!baseUrl || !firstModel) {
      setTesting(false)
      setTestResult('fail')
      setTestError(t('testRequiresFields'))
      return
    }

    const headers = buildHeadersFromRows()
    const model = buildModel(firstModel, headers)

    setTesting(true)
    setTestResult('idle')
    setTestError('')

    try {
      const resp = await fetch('/api/models/test-connection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, apiKey: formRef.current.apiKey.trim() }),
      })
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (data?.ok) {
        setTestResult('ok')
        setTestError('')
      } else {
        setTestResult('fail')
        setTestError(data?.error || t('connectionFailed'))
      }
    } catch (error) {
      setTestResult('fail')
      setTestError((error as Error)?.message || t('connectionFailed'))
    } finally {
      setTesting(false)
    }
  }

  const saveModel = async () => {
    const name = formRef.current.name.trim()
    const baseUrl = formRef.current.baseUrl.trim()

    if (!name || !baseUrl) {
      void showAlert(t('fillProviderBaseUrlModel'))
      return
    }

    // Filter out models with empty IDs
    const filledModels = formRef.current.models.filter((model) => model.modelId.trim())

    if (filledModels.length === 0) {
      void showAlert(t('atLeastOneModel'))
      return
    }

    // Check for duplicate model IDs
    const ids = filledModels.map((model) => model.modelId.trim())
    const uniqueIds = new Set(ids)
    if (uniqueIds.size !== ids.length) {
      void showAlert(t('duplicateModelId'))
      return
    }

    const headers = buildHeadersFromRows()
    const models = filledModels.map((modelForm) => buildModel(modelForm, headers))
    const apiKey = formRef.current.apiKey.trim()
    const oldProvider = editingProviderIdRef.current
      ? providersRef.current.find((provider) => provider.id === editingProviderIdRef.current)
      : undefined

    const provider: CustomProvider = {
      id: editingProviderIdRef.current ?? randomId(),
      name,
      type: formRef.current.protocol,
      baseUrl: models[0].baseUrl,
      apiKey: apiKey || undefined,
      models,
    }

    try {
      const storage = getAppStorage()
      await storage.customProviders.set(provider)
      if (oldProvider && oldProvider.name !== provider.name) {
        await storage.providerKeys.delete(oldProvider.name)
      }
      if (apiKey) {
        await storage.providerKeys.set(provider.name, apiKey)
      } else {
        await storage.providerKeys.delete(provider.name)
      }
      clearModelListCache()
      closeForm()
      await loadProviders()
    } catch (error) {
      logger.error('Failed to save custom model:', error)
      void showAlert(t('saveCustomModelFailed'))
    }
  }

  const deleteProvider = async (provider: CustomProvider) => {
    const confirmed = await showConfirm({
      description: t('confirmDeleteProvider', { name: provider.name }),
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      const storage = getAppStorage()
      await storage.customProviders.delete(provider.id)
      await storage.providerKeys.delete(provider.name)
      clearModelListCache()
      await loadProviders()
    } catch (error) {
      logger.error('Failed to delete custom provider:', error)
      void showAlert(t('deleteFailed'))
    }
  }

  const renderProvider = (provider: CustomProvider) => {
    const models = provider.models ?? []
    const modelCount = models.length
    const protocolLabel = provider.type === 'anthropic-messages' ? 'Anthropic Messages' : 'OpenAI Compatible'
    const initial = provider.name.trim().charAt(0).toUpperCase() || 'M'

    return (
      <div className="quickforge-settings-list-item" key={provider.id}>
        <div className="quickforge-settings-list-item-main">
          <div className="flex min-w-0 items-start gap-3">
            <span className="quickforge-settings-avatar" aria-hidden="true">{initial}</span>
            <div className="min-w-0 flex-1">
              <div className="quickforge-settings-row-title">{provider.name}</div>
              <div className="quickforge-settings-row-description break-all">{provider.baseUrl}</div>
              <div className="quickforge-settings-meta">
                <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('providerProtocol')}: {protocolLabel}</span>
                <span className="quickforge-settings-badge quickforge-settings-badge-info">{t('modelsCount', { count: modelCount })}</span>
                {modelCount === 0
                  ? <span className="quickforge-settings-badge quickforge-settings-badge-warning">{t('noModelAdded')}</span>
                  : null}
              </div>
              {modelCount > 0
                ? (
                  <div className="quickforge-settings-meta">
                    {models.slice(0, 6).map((model) => (
                      <code className="quickforge-settings-command-name" key={model.id}>{model.id}</code>
                    ))}
                    {models.length > 6
                      ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">+{models.length - 6}</span>
                      : null}
                  </div>
                )
                : null}
            </div>
          </div>
        </div>
        <div className="quickforge-settings-list-item-actions">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            onClick={() => void openEditForm(provider)}
          >
            {t('editModel')}
          </button>
          <button
            className="quickforge-settings-button quickforge-settings-button-danger quickforge-settings-button-compact"
            type="button"
            onClick={() => void deleteProvider(provider)}
          >
            {t('delete')}
          </button>
        </div>
      </div>
    )
  }

  const renderPresetChips = () => (
    <div className="quickforge-settings-form-row">
      <span className="quickforge-settings-form-label">{t('presets')}</span>
      <div className="quickforge-settings-segmented quickforge-settings-segmented-wrap">
        {PRESET_OPTIONS.map((option) => {
          const active = activePreset === option.key
          return (
            <button
              key={option.key}
              className={`quickforge-settings-segmented-option${active ? ' quickforge-settings-segmented-option-active' : ''}`}
              type="button"
              onClick={() => applyPreset(option.key)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const renderModelRow = (model: ModelForm, index: number) => {
    const expanded = model.open === true
    return (
      <div className="quickforge-settings-subrow quickforge-settings-row-align-start" key={index}>
        <button
          className="quickforge-settings-icon-action"
          type="button"
          title={t('expandModel')}
          aria-expanded={expanded ? 'true' : 'false'}
          onClick={() => toggleModelExpanded(index)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="quickforge-settings-list-item-main">
          <input
            className="quickforge-settings-input quickforge-settings-mono"
            value={model.modelId}
            onChange={(event) => updateModelField(index, 'modelId', event.currentTarget.value)}
            placeholder={t('modelIdPlaceholder')}
          />
          {expanded
            ? (
              <>
                <div className="quickforge-settings-model-grid mt-3">
                  <label className="quickforge-settings-form-row">
                    <span className="quickforge-settings-form-label">{t('contextWindow')}</span>
                    <input
                      className="quickforge-settings-input"
                      value={String(model.contextWindow)}
                      type="number"
                      onChange={(event) => updateModelField(index, 'contextWindow', Number(event.currentTarget.value))}
                    />
                  </label>
                  <label className="quickforge-settings-form-row">
                    <span className="quickforge-settings-form-label">{t('maxTokens')}</span>
                    <input
                      className="quickforge-settings-input"
                      value={String(model.maxTokens)}
                      type="number"
                      onChange={(event) => updateModelField(index, 'maxTokens', Number(event.currentTarget.value))}
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={model.reasoning}
                    onChange={(event) => updateModelField(index, 'reasoning', event.currentTarget.checked)}
                  />
                  <span>{t('reasoningModel')}</span>
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={model.supportsImages}
                    onChange={(event) => updateModelField(index, 'supportsImages', event.currentTarget.checked)}
                  />
                  <span>
                    {t('imageInputModel')}
                    <InfoTip label={t('imageInputModelHelp')} />
                  </span>
                </label>
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className="text-sm text-muted-foreground">{t('showModelInSelectors')}</span>
                  <label className="quickforge-settings-switch" title={t('showModelInSelectorsHelp')}>
                    <input
                      type="checkbox"
                      checked={model.visibleInSelectors}
                      onChange={(event) => updateModelField(index, 'visibleInSelectors', event.currentTarget.checked)}
                    />
                    <span aria-hidden="true"></span>
                  </label>
                </div>
              </>
            )
            : null}
        </div>
        {form.models.length > 1
          ? (
            <button
              className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
              type="button"
              title={t('delete')}
              onClick={() => removeModelRow(index)}
            >
              ✕
            </button>
          )
          : null}
      </div>
    )
  }

  const renderHeadersEditor = () => (
    <div className="quickforge-settings-form-row">
      <span className="quickforge-settings-form-label">
        {t('customHeaders')}
        <InfoTip label={t('customHeadersHelp')} />
      </span>
      {form.headerRows.length === 0
        ? null
        : (
          <div className="quickforge-settings-nested-list">
            {form.headerRows.map((row, index) => (
              <div className="quickforge-settings-subrow" key={index}>
                <input
                  className="quickforge-settings-input"
                  value={row.key}
                  onChange={(event) => updateHeaderRow(index, 'key', event.currentTarget.value)}
                  placeholder={t('headerName')}
                />
                <input
                  className="quickforge-settings-input"
                  value={row.value}
                  onChange={(event) => updateHeaderRow(index, 'value', event.currentTarget.value)}
                  placeholder={t('headerValue')}
                />
                <button
                  className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
                  type="button"
                  title={t('removeHeader')}
                  onClick={() => removeHeaderRow(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      <button
        className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
        type="button"
        onClick={() => addHeaderRow()}
      >
        + {t('addHeader')}
      </button>
    </div>
  )

  const renderTestStatus = () => {
    if (testResult === 'idle' && !testing) return null
    if (testing) {
      return <span className="quickforge-settings-status">{t('testingConnection')}</span>
    }
    if (testResult === 'ok') {
      return <span className="quickforge-settings-badge quickforge-settings-badge-success">✓ {t('connectionOk')}</span>
    }
    return <span className="quickforge-settings-alert">✗ {testError || t('connectionFailed')}</span>
  }

  const renderForm = () => (
    <section className="quickforge-settings-section" aria-label={editingProviderId ? t('editCustomModel') : t('addCustomModel')}>
      <div className="quickforge-settings-toolbar">
        <button
          className="quickforge-settings-button quickforge-settings-button-secondary"
          type="button"
          onClick={() => closeForm()}
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
          {t('back')}
        </button>
        <div className="quickforge-settings-row-main">
          <div className="quickforge-settings-row-title">{editingProviderId ? t('editCustomModel') : t('addCustomModel')}</div>
          <div className="quickforge-settings-row-description">{t('customModelsDescription')}</div>
        </div>
      </div>

      <div className="quickforge-settings-form-grid">
        {renderPresetChips()}

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('providerName')}</span>
          <input
            className="quickforge-settings-input"
            value={form.name}
            onChange={(event) => updateForm('name', event.currentTarget.value)}
            placeholder={t('providerNamePlaceholder')}
          />
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">Base URL</span>
          <input
            className="quickforge-settings-input"
            value={form.baseUrl}
            onChange={(event) => updateForm('baseUrl', event.currentTarget.value)}
            placeholder={form.protocol === 'anthropic-messages'
              ? 'e.g., https://api.anthropic.com'
              : 'e.g., http://localhost:4000/v1'}
          />
        </label>

        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('apiKey')}</span>
          <div className="quickforge-settings-inline-field">
            <input
              className="quickforge-settings-input pr-10"
              value={form.apiKey}
              type={apiKeyVisible ? 'text' : 'password'}
              onChange={(event) => updateForm('apiKey', event.currentTarget.value)}
              placeholder={t('apiKeyPlaceholder')}
            />
            <button
              className="quickforge-settings-inline-field-button"
              type="button"
              title={apiKeyVisible ? t('hideApiKey') : t('showApiKey')}
              aria-label={apiKeyVisible ? t('hideApiKey') : t('showApiKey')}
              aria-pressed={apiKeyVisible ? 'true' : 'false'}
              onClick={() => setApiKeyVisible(!apiKeyVisible)}
            >
              {apiKeyVisible
                ? <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /><path d="M8.53 8.53A5 5 0 0 0 12 17a5 5 0 0 0 3.47-8.53" /></svg>
                : <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>}
            </button>
          </div>
        </label>

        <div className="quickforge-settings-form-row">
          <div className="flex items-center justify-between gap-3">
            <span className="quickforge-settings-form-label">{t('modelsList')}</span>
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
              type="button"
              onClick={() => addModelRow()}
            >
              + {t('addModel')}
            </button>
          </div>
          <div className="quickforge-settings-nested-list">
            {form.models.map((model, index) => renderModelRow(model, index))}
          </div>
        </div>

        <button
          className="quickforge-settings-details-toggle"
          type="button"
          aria-expanded={advancedOpen ? 'true' : 'false'}
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <span>{advancedOpen ? '▾' : '▸'}</span>
          {t('providerAdvanced')}
        </button>

        {advancedOpen
          ? (
            <div className="quickforge-settings-form-grid rounded-lg border border-border p-3">
              <label className="quickforge-settings-form-row">
                <span className="quickforge-settings-form-label">
                  {t('protocolType')}
                  <InfoTip label={t('protocolHelp')} />
                </span>
                <select
                  className="quickforge-settings-select"
                  value={form.protocol}
                  onChange={(event) => updateForm('protocol', event.currentTarget.value as ProviderProtocol)}
                >
                  <option value="openai-completions">OpenAI Compatible / Chat Completions</option>
                  <option value="anthropic-messages">Anthropic Messages</option>
                </select>
              </label>
              {renderHeadersEditor()}
            </div>
          )
          : null}
      </div>

      <div className="quickforge-settings-row">
        <div className="quickforge-settings-row-main">
          {renderTestStatus()}
        </div>
        <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary"
            type="button"
            onClick={() => closeForm()}
          >
            {t('cancel')}
          </button>
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary"
            type="button"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {testing ? t('testingConnection') : t('testConnection')}
          </button>
          <button
            className="quickforge-settings-button quickforge-settings-button-primary"
            type="button"
            onClick={() => void saveModel()}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </section>
  )

  if (formOpen) {
    return (
      <div className="quickforge-settings-stack">
        <div className="quickforge-settings-heading">
          <h3 className="quickforge-settings-title">
            {editingProviderId ? t('editCustomModel') : t('addCustomModel')}
            <InfoTip label={t('customModelsDescription')} />
          </h3>
        </div>
        {renderForm()}
      </div>
    )
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('customModelsTitle')}>
        <div className="quickforge-settings-toolbar">
          <div>
            <div className="quickforge-settings-row-title">{t('customModelsTitle')}</div>
            <div className="quickforge-settings-row-description">{t('customModelsDescription')}</div>
          </div>
          <button
            className="quickforge-settings-button quickforge-settings-button-primary"
            type="button"
            onClick={() => openAddForm()}
          >
            {t('addModel')}
          </button>
        </div>

        {loading
          ? <div className="quickforge-settings-empty-row">{t('loading')}</div>
          : providers.length === 0
            ? <div className="quickforge-settings-empty-row">{t('noCustomModels')}</div>
            : providers.map((provider) => renderProvider(provider))}
      </section>
    </div>
  )
}
