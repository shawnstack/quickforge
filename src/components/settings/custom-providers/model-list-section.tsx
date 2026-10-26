import { useState } from 'react'
import { ChevronRight, Download, Plus, Trash2 } from 'lucide-react'
import type { CustomProvider } from '@/storage'
import { t } from '@/lib/i18n'
import { InfoTip } from '@/components/ui/info-tip'
import { emptyModelDraft, modelDraftOf, type AnyModel, type ModelDraft } from './shared'

export type ModelTestOutcome = { ok: boolean; error?: string }

export type ModelListSectionProps = {
  provider: CustomProvider
  notice: string
  discovering: boolean
  /** 草稿态尚未落库，不能从服务器拉取模型。 */
  canDiscover: boolean
  onSaveModel: (index: number | 'new', draft: ModelDraft) => Promise<boolean>
  onRemoveModel: (index: number) => void
  onToggleVisible: (index: number) => void
  onTestModel: (index: number | 'new', draft: ModelDraft) => Promise<ModelTestOutcome>
  onDiscover: () => void
}

function ModelCaps({ model }: { model: AnyModel }) {
  return (
    <span className="quickforge-settings-meta">
      {model.reasoning === true ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('reasoning')}</span> : null}
      {model.input?.includes('image') === true ? <span className="quickforge-settings-badge quickforge-settings-badge-muted">{t('modelVisionCapability')}</span> : null}
      {model.quickforgeHidden === true ? <span className="quickforge-settings-badge quickforge-settings-badge-warning">{t('modelHiddenBadge')}</span> : null}
    </span>
  )
}

function ModelEditBody(props: {
  draft: ModelDraft
  testing: boolean
  testOutcome: ModelTestOutcome | null
  onUpdate: (patch: Partial<ModelDraft>) => void
  onTest: () => void
  onCancel: () => void
  onSave: () => void
  saveLabel: string
}) {
  const { draft, testing, testOutcome, onUpdate, onTest, onCancel, onSave, saveLabel } = props
  return (
    <div className="quickforge-providers-model-edit">
      <label className="quickforge-settings-form-row">
        <span className="quickforge-settings-form-label">{t('modelId')}</span>
        <input
          className="quickforge-settings-input quickforge-settings-mono"
          value={draft.modelId}
          placeholder={t('modelIdPlaceholder')}
          onChange={(event) => onUpdate({ modelId: event.currentTarget.value })}
        />
      </label>
      <div className="quickforge-settings-model-grid">
        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('contextWindow')}</span>
          <input
            className="quickforge-settings-input"
            value={String(draft.contextWindow)}
            type="number"
            onChange={(event) => onUpdate({ contextWindow: Number(event.currentTarget.value) })}
          />
        </label>
        <label className="quickforge-settings-form-row">
          <span className="quickforge-settings-form-label">{t('maxTokens')}</span>
          <input
            className="quickforge-settings-input"
            value={String(draft.maxTokens)}
            type="number"
            onChange={(event) => onUpdate({ maxTokens: Number(event.currentTarget.value) })}
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.reasoning}
          onChange={(event) => onUpdate({ reasoning: event.currentTarget.checked })}
        />
        <span>{t('reasoningModel')}</span>
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.supportsImages}
          onChange={(event) => onUpdate({ supportsImages: event.currentTarget.checked })}
        />
        <span>
          {t('imageInputModel')}
          <InfoTip label={t('imageInputModelHelp')} />
        </span>
      </label>
      <div className="quickforge-settings-row mt-3">
        <div className="quickforge-settings-row-main">
          {testing
            ? <span className="quickforge-settings-status">{t('testingConnection')}</span>
            : testOutcome
              ? testOutcome.ok
                ? <span className="quickforge-settings-badge quickforge-settings-badge-success">✓ {t('connectionOk')}</span>
                : <span className="quickforge-settings-alert">✗ {testOutcome.error || t('connectionFailed')}</span>
              : null}
        </div>
        <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            disabled={testing}
            onClick={onTest}
          >
            {t('testThisModel')}
          </button>
          <button className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact" type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className="quickforge-settings-button quickforge-settings-button-primary quickforge-settings-button-compact" type="button" onClick={onSave}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModelRow(props: {
  model: AnyModel
  index: number
  canDelete: boolean
  onSave: (index: number, draft: ModelDraft) => Promise<boolean>
  onRemove: (index: number) => void
  onToggleVisible: (index: number) => void
  onTest: (index: number, draft: ModelDraft) => Promise<ModelTestOutcome>
}) {
  const { model, index, canDelete, onSave, onRemove, onToggleVisible, onTest } = props
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ModelDraft>(() => modelDraftOf(model))
  const [testing, setTesting] = useState(false)
  const [testOutcome, setTestOutcome] = useState<ModelTestOutcome | null>(null)

  const update = (patch: Partial<ModelDraft>) => setDraft((current) => ({ ...current, ...patch }))

  const save = async () => {
    const ok = await onSave(index, draft)
    if (ok) {
      setOpen(false)
      setTestOutcome(null)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestOutcome(null)
    try {
      setTestOutcome(await onTest(index, draft))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`quickforge-providers-model${open ? ' quickforge-providers-model-open' : ''}`}>
      <div className="quickforge-providers-model-main">
        <button
          className="quickforge-settings-icon-action"
          type="button"
          aria-label={t('expandModel')}
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => { setOpen(!open); setTestOutcome(null) }}
        >
          <ChevronRight className="size-3.5 transition-transform duration-150" style={{ transform: open ? 'rotate(90deg)' : undefined }} aria-hidden="true" />
        </button>
        <span className="quickforge-providers-model-id">{model.id}</span>
        <ModelCaps model={model} />
        <span className="quickforge-providers-model-spec">
          {(model.contextWindow ?? 0).toLocaleString()} ctx · {(model.maxTokens ?? 0).toLocaleString()} out
        </span>
        <label className="quickforge-settings-switch" title={t('showModelInSelectorsHelp')}>
          <input
            type="checkbox"
            checked={model.quickforgeHidden !== true}
            aria-label={t('showModelInSelectors')}
            onChange={() => onToggleVisible(index)}
          />
          <span aria-hidden="true"></span>
        </label>
        {canDelete
          ? (
            <button
              className="quickforge-settings-icon-action quickforge-settings-icon-action-danger"
              type="button"
              title={t('delete')}
              onClick={() => onRemove(index)}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          )
          : null}
      </div>
      {open
        ? (
          <ModelEditBody
            draft={draft}
            testing={testing}
            testOutcome={testOutcome}
            onUpdate={update}
            onTest={() => void test()}
            onCancel={() => setOpen(false)}
            onSave={() => void save()}
            saveLabel={t('saveModel')}
          />
        )
        : null}
    </div>
  )
}

export function ModelListSection(props: ModelListSectionProps) {
  const { provider, notice, discovering, canDiscover, onSaveModel, onRemoveModel, onToggleVisible, onTestModel, onDiscover } = props
  const models = provider.models ?? []
  const [newDraft, setNewDraft] = useState<ModelDraft | null>(null)
  const [newTesting, setNewTesting] = useState(false)
  const [newTestOutcome, setNewTestOutcome] = useState<ModelTestOutcome | null>(null)
  const visibleCount = models.filter((model) => (model as AnyModel).quickforgeHidden !== true).length

  const saveNew = async () => {
    if (!newDraft) return
    const ok = await onSaveModel('new', newDraft)
    if (ok) {
      setNewDraft(null)
      setNewTestOutcome(null)
    }
  }

  const testNew = async () => {
    if (!newDraft) return
    setNewTesting(true)
    setNewTestOutcome(null)
    try {
      setNewTestOutcome(await onTestModel('new', newDraft))
    } finally {
      setNewTesting(false)
    }
  }

  return (
    <section className="quickforge-providers-section" aria-label={t('modelsList')}>
      <div className="quickforge-providers-section-head">
        <div className="quickforge-providers-section-title">{t('modelsList')}</div>
        <div className="quickforge-providers-section-actions">
          <span className="quickforge-providers-section-hint">{t('modelsVisibleCount', { visible: visibleCount, count: models.length })}</span>
          {canDiscover
            ? (
              <button
                className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
                type="button"
                disabled={discovering}
                onClick={onDiscover}
              >
                <Download className="size-3.5" aria-hidden="true" />
                {discovering ? t('discoveringModels') : t('fetchModels')}
              </button>
            )
            : null}
          <button
            className="quickforge-settings-button quickforge-settings-button-secondary quickforge-settings-button-compact"
            type="button"
            onClick={() => setNewDraft(emptyModelDraft())}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            {t('addModel')}
          </button>
        </div>
      </div>

      {notice ? <div className="quickforge-settings-note">{notice}</div> : null}

      {newDraft
        ? (
          <div className="quickforge-providers-model quickforge-providers-model-open">
            <div className="quickforge-providers-model-main">
              <span className="quickforge-providers-model-id quickforge-providers-model-new">{t('newModelBadge')}</span>
            </div>
            <ModelEditBody
              draft={newDraft}
              testing={newTesting}
              testOutcome={newTestOutcome}
              onUpdate={(patch) => setNewDraft({ ...newDraft, ...patch })}
              onTest={() => void testNew()}
              onCancel={() => { setNewDraft(null); setNewTestOutcome(null) }}
              onSave={() => void saveNew()}
              saveLabel={t('addModel')}
            />
          </div>
        )
        : null}

      {models.length === 0 && !newDraft
        ? <div className="quickforge-settings-empty-row">{t('noModelAdded')}</div>
        : (
          <div className="quickforge-providers-model-list">
            {models.map((model, index) => (
              <ModelRow
                key={model.id}
                model={model as AnyModel}
                index={index}
                canDelete
                onSave={onSaveModel}
                onRemove={onRemoveModel}
                onToggleVisible={onToggleVisible}
                onTest={onTestModel}
              />
            ))}
          </div>
        )}
    </section>
  )
}
