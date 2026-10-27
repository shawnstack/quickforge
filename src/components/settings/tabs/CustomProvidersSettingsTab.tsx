import { useEffect, useRef, useState } from 'react'
import { getAppStorage, type CustomProvider } from '@/storage'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'
import { randomId } from '@/lib/random-id'
import { showAlert, showConfirm } from '@/components/ui/confirm-dialog'
import { clearModelListCache } from '@/lib/model-list-cache'
import { ProviderListPane, type ProviderTestStatus } from '@/components/settings/custom-providers/provider-list-pane'
import { ProviderDetailEmpty, ProviderDetailPane } from '@/components/settings/custom-providers/provider-detail-pane'
import { ConnectionSection, type ConnectionTestState } from '@/components/settings/custom-providers/connection-section'
import { ModelListSection, type ModelTestOutcome } from '@/components/settings/custom-providers/model-list-section'
import {
  PROVIDER_PRESETS,
  buildModelFromDrafts,
  connectionDraftOf,
  emptyModelDraft,
  headersFromRows,
  modelDraftOf,
  protocolOfProvider,
  type AnyModel,
  type ConnectionDraft,
  type ModelDraft,
  type PresetKey,
} from '@/components/settings/custom-providers/shared'

export type CustomProvidersSettingsTabProps = {
  /** 打开设置页后自动选中该名称供应商（自定义模型入口跳转用）。 */
  customProvider?: string
  /** 设置页切换 tab 时的激活标记；false = 已切走（停掉加载），undefined 视为激活。 */
  active?: boolean
}

const IDLE_TEST: ConnectionTestState = { status: 'idle' }
const JSON_HEADERS = { 'content-type': 'application/json' }
const DRAFT_ID = 'draft'
const LAST_SELECTED_KEY = 'quickforge:custom-providers:last-selected:v1'

type LastSelectedRef = { id: string; name: string }

/** 上次最后访问的提供商（id 优先，改名后按名称兜底）；存储不可用时静默降级。 */
function readLastSelected(): LastSelectedRef | null {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_SELECTED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastSelectedRef>
    if (typeof parsed?.id === 'string' && typeof parsed?.name === 'string') {
      return { id: parsed.id, name: parsed.name }
    }
  } catch {
    // 隐私模式等存储不可用场景：不记忆即可
  }
  return null
}

function writeLastSelected(ref: LastSelectedRef) {
  try {
    globalThis.localStorage?.setItem(LAST_SELECTED_KEY, JSON.stringify(ref))
  } catch {
    // 同上：写入失败不影响功能
  }
}

export function CustomProvidersSettingsTab({ customProvider, active }: CustomProvidersSettingsTabProps) {
  const [providers, setProviders] = useState<CustomProvider[]>([])
  const [draftProvider, setDraftProvider] = useState<CustomProvider | null>(null)
  const [draftSeq, setDraftSeq] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [keyConfigured, setKeyConfigured] = useState<Record<string, boolean>>({})
  const [testStates, setTestStates] = useState<Record<string, ConnectionTestState>>({})
  const [modelsNotice, setModelsNotice] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [loading, setLoading] = useState(true)
  // 窄屏：详情以抽屉覆盖列表；桌面布局忽略该标记。
  const [detailOpen, setDetailOpen] = useState(false)

  // 表单状态经 ref 供异步流程（保存、测试、发现）读取最新值。
  const providersRef = useRef(providers)
  const draftRef = useRef(draftProvider)
  const selectedIdRef = useRef(selectedId)
  // 深链自动选中只消费一次，否则每次重新激活都会覆盖用户当前选中项。
  const autoEditConsumedRef = useRef(false)
  useEffect(() => {
    providersRef.current = providers
    draftRef.current = draftProvider
    selectedIdRef.current = selectedId
  }, [providers, draftProvider, selectedId])

  const currentProvider = (): CustomProvider | null => {
    const id = selectedIdRef.current
    if (!id) return null
    if (id === DRAFT_ID) return draftRef.current
    return providersRef.current.find((provider) => provider.id === id) ?? null
  }

  const loadProviders = async () => {
    setLoading(true)
    try {
      const storage = getAppStorage()
      const next = await storage.customProviders.getAll()
      providersRef.current = next
      setProviders(next)
      const keyMap: Record<string, boolean> = {}
      for (const provider of next) {
        keyMap[provider.id] = Boolean(provider.apiKey || (await storage.providerKeys.get(provider.name)))
      }
      setKeyConfigured(keyMap)
    } catch (error) {
      logger.error('Failed to load custom providers:', error)
      providersRef.current = []
      setProviders([])
    } finally {
      setLoading(false)
    }
  }

  /** reveal=false 供恢复上次选中使用：不自动打开窄屏抽屉。草稿不写入记忆。 */
  const selectProvider = (id: string, options?: { reveal?: boolean }) => {
    setSelectedId(id)
    selectedIdRef.current = id
    setModelsNotice('')
    if (options?.reveal !== false) {
      setDetailOpen(true)
    }
    if (id !== DRAFT_ID) {
      const provider = providersRef.current.find((candidate) => candidate.id === id)
      if (provider) {
        writeLastSelected({ id: provider.id, name: provider.name })
      }
    }
  }

  const addPreset = (presetKey: PresetKey) => {
    const draft: CustomProvider = presetKey === 'custom'
      ? { id: DRAFT_ID, name: '', baseUrl: '', type: 'openai-completions', models: [] }
      : (() => {
          const preset = PROVIDER_PRESETS[presetKey]
          return {
            id: DRAFT_ID,
            name: preset.name,
            baseUrl: preset.baseUrl,
            type: preset.protocol,
            models: [buildModelFromDrafts(
              { name: preset.name, baseUrl: preset.baseUrl, protocol: preset.protocol },
              { ...emptyModelDraft(), modelId: preset.modelId, supportsImages: preset.supportsImages === true },
              {},
            )],
          }
        })()
    setDraftProvider(draft)
    draftRef.current = draft
    setDraftSeq((seq) => seq + 1)
    selectProvider(DRAFT_ID)
  }

  // 写回已持久化的提供商并同步本地列表。
  const applyProvider = async (provider: CustomProvider) => {
    await getAppStorage().customProviders.set(provider)
    clearModelListCache()
    const next = providersRef.current.some((existing) => existing.id === provider.id)
      ? providersRef.current.map((existing) => (existing.id === provider.id ? provider : existing))
      : [...providersRef.current, provider]
    providersRef.current = next
    setProviders(next)
  }

  const updateDraft = (next: CustomProvider) => {
    setDraftProvider(next)
    draftRef.current = next
  }

  /** L2：保存连接层（名称/地址/协议/请求头）；草稿态首次落库并携带密钥。 */
  const saveConnection = async (draft: ConnectionDraft, apiKey: string): Promise<boolean> => {
    const name = draft.name.trim()
    const baseUrl = draft.baseUrl.trim().replace(/\/$/, '')
    if (!name || !baseUrl) {
      void showAlert(t('fillProviderBaseUrlModel'))
      return false
    }
    const current = currentProvider()
    if (!current) return false

    const headers = headersFromRows(draft.headerRows)
    const models = (current.models ?? []).map((model) => buildModelFromDrafts(
      { name, baseUrl, protocol: draft.protocol },
      modelDraftOf(model as AnyModel),
      headers,
    ))

    try {
      const storage = getAppStorage()
      if (current.id === DRAFT_ID) {
        const trimmedKey = apiKey.trim()
        const provider: CustomProvider = { id: randomId(), name, type: draft.protocol, baseUrl, apiKey: trimmedKey || undefined, models }
        await storage.customProviders.set(provider)
        if (trimmedKey) await storage.providerKeys.set(name, trimmedKey)
        clearModelListCache()
        setDraftProvider(null)
        draftRef.current = null
        providersRef.current = [...providersRef.current, provider]
        setProviders(providersRef.current)
        setKeyConfigured((map) => ({ ...map, [provider.id]: Boolean(trimmedKey) }))
        setSelectedId(provider.id)
        selectedIdRef.current = provider.id
        return true
      }

      const renamed = current.name !== name
      const storedKey = (await storage.providerKeys.get(renamed ? current.name : name)) ?? ''
      const nextKey = apiKey.trim() || storedKey
      const provider: CustomProvider = { ...current, name, type: draft.protocol, baseUrl, apiKey: nextKey || undefined, models }
      await applyProvider(provider)
      if (renamed && storedKey) await storage.providerKeys.delete(current.name)
      if (nextKey) await storage.providerKeys.set(name, nextKey)
      setKeyConfigured((map) => ({ ...map, [provider.id]: Boolean(nextKey) }))
      return true
    } catch (error) {
      logger.error('Failed to save provider connection:', error)
      void showAlert(t('saveCustomModelFailed'))
      return false
    }
  }

  /** L2：单独更换/清除密钥，只写 provider-keys 与 apiKey 镜像，不触碰模型。 */
  const saveKey = async (value: string): Promise<boolean> => {
    const current = currentProvider()
    if (!current || current.id === DRAFT_ID) return false
    const trimmed = value.trim()
    try {
      const storage = getAppStorage()
      if (trimmed) {
        await storage.providerKeys.set(current.name, trimmed)
      } else {
        await storage.providerKeys.delete(current.name)
      }
      await applyProvider({ ...current, apiKey: trimmed || undefined })
      setKeyConfigured((map) => ({ ...map, [current.id]: Boolean(trimmed) }))
      return true
    } catch (error) {
      logger.error('Failed to save provider key:', error)
      void showAlert(t('saveCustomModelFailed'))
      return false
    }
  }

  /** L3：保存单个模型行（新增或就地更新）；草稿态只更新本地草稿。 */
  const saveModel = async (index: number | 'new', draft: ModelDraft): Promise<boolean> => {
    const current = currentProvider()
    if (!current) return false
    const modelId = draft.modelId.trim()
    if (!modelId) {
      void showAlert(t('modelIdRequired'))
      return false
    }
    const models = current.models ?? []
    if (models.some((model, i) => model.id === modelId && i !== index)) {
      void showAlert(t('duplicateModelId'))
      return false
    }
    const built = buildModelFromDrafts(
      { name: current.name, baseUrl: current.baseUrl, protocol: protocolOfProvider(current) },
      draft,
      headersFromRows(connectionDraftOf(current).headerRows),
    )
    const nextModels = index === 'new'
      ? [...models, built]
      : models.map((model, i) => (i === index ? built : model))
    try {
      if (current.id === DRAFT_ID) {
        updateDraft({ ...current, models: nextModels })
      } else {
        await applyProvider({ ...current, models: nextModels })
      }
      return true
    } catch (error) {
      logger.error('Failed to save model:', error)
      void showAlert(t('saveCustomModelFailed'))
      return false
    }
  }

  const removeModel = (index: number) => {
    const current = currentProvider()
    if (!current) return
    const models = (current.models ?? []).filter((_, i) => i !== index)
    if (current.id === DRAFT_ID) {
      updateDraft({ ...current, models })
    } else {
      applyProvider({ ...current, models }).catch((error: unknown) => {
        logger.error('Failed to remove model:', error)
        void showAlert(t('saveCustomModelFailed'))
      })
    }
  }

  /** L3：可见性行内开关，即时写回。 */
  const toggleVisible = (index: number) => {
    const current = currentProvider()
    if (!current) return
    const models = (current.models ?? []).map((model, i) =>
      i === index
        ? { ...model, quickforgeHidden: (model as AnyModel).quickforgeHidden === true ? undefined : true }
        : model,
    )
    if (current.id === DRAFT_ID) {
      updateDraft({ ...current, models })
    } else {
      applyProvider({ ...current, models }).catch((error: unknown) => {
        logger.error('Failed to toggle model visibility:', error)
        void showAlert(t('saveCustomModelFailed'))
      })
    }
  }

  /** L2：提供商级测试连接（GET baseUrl/models），不依赖已配置模型。 */
  const testProvider = async (draft: ConnectionDraft, apiKey: string) => {
    const id = selectedIdRef.current
    if (!id) return
    const baseUrl = draft.baseUrl.trim()
    if (!baseUrl) {
      setTestStates((states) => ({ ...states, [id]: { status: 'fail', error: t('testRequiresBaseUrl') } }))
      return
    }
    setTestStates((states) => ({ ...states, [id]: { status: 'testing' } }))
    try {
      const current = currentProvider()
      let key = apiKey.trim()
      if (!key && current && current.id !== DRAFT_ID) {
        key = (await getAppStorage().providerKeys.get(current.name)) ?? current.apiKey ?? ''
      }
      const resp = await fetch('/api/models/provider-test', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          baseUrl,
          protocol: draft.protocol,
          apiKey: key || undefined,
          headers: headersFromRows(draft.headerRows),
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      setTestStates((states) => ({
        ...states,
        [id]: data?.ok ? { status: 'ok' } : { status: 'fail', error: data?.error || t('connectionFailed') },
      }))
    } catch (error) {
      setTestStates((states) => ({ ...states, [id]: { status: 'fail', error: (error as Error)?.message || t('connectionFailed') } }))
    }
  }

  /** L3：模型级测试，复用 /api/models/test-connection。 */
  const testModel = async (_index: number | 'new', draft: ModelDraft): Promise<ModelTestOutcome> => {
    const current = currentProvider()
    if (!current) return { ok: false, error: t('connectionFailed') }
    const modelId = draft.modelId.trim()
    if (!current.baseUrl.trim() || !modelId) {
      return { ok: false, error: t('testRequiresFields') }
    }
    const model = buildModelFromDrafts(
      { name: current.name, baseUrl: current.baseUrl, protocol: protocolOfProvider(current) },
      draft,
      headersFromRows(connectionDraftOf(current).headerRows),
    )
    let apiKey = ''
    if (current.id !== DRAFT_ID) {
      apiKey = (await getAppStorage().providerKeys.get(current.name)) ?? current.apiKey ?? ''
    }
    try {
      const resp = await fetch('/api/models/test-connection', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ model, apiKey }),
      })
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      return data?.ok ? { ok: true } : { ok: false, error: data?.error || t('connectionFailed') }
    } catch (error) {
      return { ok: false, error: (error as Error)?.message || t('connectionFailed') }
    }
  }

  /** L3：模型行内一键连通性测试——直接用已保存的模型配置，不需要展开编辑。 */
  const quickTestModel = async (index: number): Promise<ModelTestOutcome> => {
    const current = currentProvider()
    const model = current?.models?.[index]
    if (!current || !model) {
      return { ok: false, error: t('connectionFailed') }
    }
    return testModel(index, modelDraftOf(model as AnyModel))
  }

  /** L3：从服务器拉取模型列表，合并为新的模型行。 */
  const discoverModels = async () => {
    const current = currentProvider()
    if (!current || current.id === DRAFT_ID) return
    setDiscovering(true)
    setModelsNotice('')
    try {
      const connection = connectionDraftOf(current)
      const apiKey = (await getAppStorage().providerKeys.get(current.name)) ?? current.apiKey ?? ''
      const resp = await fetch('/api/models/provider-discover', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          baseUrl: current.baseUrl,
          protocol: protocolOfProvider(current),
          apiKey: apiKey || undefined,
          headers: headersFromRows(connection.headerRows),
        }),
      })
      const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; models?: string[]; error?: string }
      if (!data?.ok || !Array.isArray(data.models)) {
        setModelsNotice(data?.error || t('fetchModelsFailed'))
        return
      }
      const existing = new Set((current.models ?? []).map((model) => model.id))
      const fresh = data.models.filter((id) => !existing.has(id))
      if (fresh.length === 0) {
        setModelsNotice(t('noNewModels'))
        return
      }
      const headers = headersFromRows(connection.headerRows)
      const added = fresh.map((id) => buildModelFromDrafts(
        { name: current.name, baseUrl: current.baseUrl, protocol: protocolOfProvider(current) },
        { ...emptyModelDraft(), modelId: id },
        headers,
      ))
      await applyProvider({ ...current, models: [...(current.models ?? []), ...added] })
      setModelsNotice(t('fetchedModels', { count: fresh.length }))
    } catch (error) {
      setModelsNotice((error as Error)?.message || t('fetchModelsFailed'))
    } finally {
      setDiscovering(false)
    }
  }

  const deleteProvider = async (provider: CustomProvider) => {
    // 草稿提供商虽未落库，但连接/模型可能已填了一半，同样走破坏性二次确认。
    if (provider.id === DRAFT_ID) {
      const confirmed = await showConfirm({
        description: t('confirmDiscardDraft', {
          name: provider.name.trim() || t('newProviderFallback'),
        }),
        confirmLabel: t('discard'),
        cancelLabel: t('cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      setDraftProvider(null)
      draftRef.current = null
      if (selectedIdRef.current === DRAFT_ID) {
        const fallback = providersRef.current[0]?.id ?? null
        setSelectedId(fallback)
        selectedIdRef.current = fallback
      }
      return
    }
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
      const next = providersRef.current.filter((existing) => existing.id !== provider.id)
      providersRef.current = next
      setProviders(next)
      if (selectedIdRef.current === provider.id) {
        const fallback = next[0]?.id ?? null
        setSelectedId(fallback)
        selectedIdRef.current = fallback
      }
    } catch (error) {
      logger.error('Failed to delete custom provider:', error)
      void showAlert(t('deleteFailed'))
    }
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
        const provider = providersRef.current.find((candidate) => candidate.name === customProvider)
        if (provider) {
          selectProvider(provider.id)
        }
      } else if (selectedIdRef.current === null) {
        // 恢复上次最后访问的提供商：id 命中优先，改名后按名称兜底；不自动展开窄屏抽屉。
        const last = readLastSelected()
        const restored = last
          ? providersRef.current.find((candidate) => candidate.id === last.id)
            ?? providersRef.current.find((candidate) => candidate.name === last.name)
          : undefined
        if (restored) {
          selectProvider(restored.id, { reveal: false })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // 首次激活与每次重新激活时重新加载列表；选中项与各层编辑草稿不会被 loadProviders 重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const selectedProvider = selectedId === DRAFT_ID
    ? draftProvider
    : providers.find((provider) => provider.id === selectedId) ?? null
  const isDraft = selectedId === DRAFT_ID && draftProvider !== null
  const testState = (selectedId ? testStates[selectedId] : undefined) ?? IDLE_TEST
  const detailKey = isDraft ? `${DRAFT_ID}:${draftSeq}` : selectedProvider?.id ?? 'none'
  const rowTestStatus: Record<string, ProviderTestStatus> = {}
  for (const [id, state] of Object.entries(testStates)) {
    rowTestStatus[id] = state.status === 'ok' ? 'ok' : state.status === 'fail' ? 'fail' : undefined
  }

  return (
    <div className="quickforge-settings-stack">
      <section
        className={`quickforge-providers-card${detailOpen && selectedProvider ? ' quickforge-providers-card-open' : ''}`}
        aria-label={t('customModelsTitle')}
      >
        <ProviderListPane
          providers={providers}
          draftProvider={draftProvider}
          selectedId={selectedId}
          keyConfigured={keyConfigured}
          testStatus={rowTestStatus}
          loading={loading}
          onSelect={selectProvider}
          onAddPreset={addPreset}
          onDelete={(provider) => void deleteProvider(provider)}
        />
        {selectedProvider
          ? (
            <ProviderDetailPane
              provider={selectedProvider}
              isDraft={isDraft}
              testState={testState}
              onDelete={() => void deleteProvider(selectedProvider)}
              onBack={() => setDetailOpen(false)}
            >
              <ConnectionSection
                key={`connection:${detailKey}`}
                provider={selectedProvider}
                isDraft={isDraft}
                keyConfigured={isDraft ? false : keyConfigured[selectedProvider.id] === true}
                testState={testState}
                onSaveConnection={saveConnection}
                onSaveKey={saveKey}
                onTest={(draft, apiKey) => void testProvider(draft, apiKey)}
              />
              <ModelListSection
                key={`models:${detailKey}`}
                provider={selectedProvider}
                notice={modelsNotice}
                discovering={discovering}
                canDiscover={!isDraft}
                onSaveModel={saveModel}
                onRemoveModel={removeModel}
                onToggleVisible={toggleVisible}
                onTestModel={testModel}
                onQuickTest={quickTestModel}
                onDiscover={() => void discoverModels()}
              />
            </ProviderDetailPane>
          )
          : <ProviderDetailEmpty />}
        <button type="button" className="quickforge-providers-backdrop" aria-label={t('back')} tabIndex={-1} onClick={() => setDetailOpen(false)} />
      </section>
    </div>
  )
}
