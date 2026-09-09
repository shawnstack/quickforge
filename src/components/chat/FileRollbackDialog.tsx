import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { t, type AppTextKey } from '@/lib/i18n'
import {
  canConfirmFileRollback,
  canConfirmSingleFileRollback,
  canConfirmTurnRollback,
  createFileRollbackController,
  createTurnRollbackController,
  turnRollbackCounts,
  type FileRollbackClient,
  type FileRollbackState,
  type TurnRollbackClient,
  type TurnRollbackState,
} from './file-rollback-state'

const REASONS: Record<string, AppTextKey> = {
  external_modified: 'fileRollbackExternalModified',
  missing_file: 'fileRollbackMissingFile',
  backup_unavailable: 'fileRollbackBackupUnavailable',
  legacy_backup: 'fileRollbackLegacyBackup',
  incomplete_write: 'fileRollbackIncompleteWrite',
  unsafe_path: 'fileRollbackUnsafePath',
  unavailable: 'fileRollbackUnavailable',
  session_busy: 'fileRollbackSessionBusy',
  batch_changed: 'fileRollbackBatchChanged',
}

function explainReason(reason: string) {
  return t(Object.hasOwn(REASONS, reason) ? REASONS[reason] : 'fileRollbackUnavailable')
}

/** 轮级预检的冲突原因码 → 文案（未知/空原因保守解释为无法确认安全性）。 */
const TURN_REASONS: Record<string, AppTextKey> = {
  'modified-after-turn': 'turnRollbackModifiedAfterTurn',
  'external-change': 'turnRollbackExternalChange',
  'stale-backup': 'turnRollbackStaleBackup',
}

function explainTurnReason(reason: string | null) {
  if (!reason) return t('fileRollbackUnavailable')
  return t(Object.hasOwn(TURN_REASONS, reason) ? TURN_REASONS[reason] : 'fileRollbackUnavailable')
}

export function FileRollbackDialogContent({ state, onClose, onPreview, onConfirm, onConfirmFile, titleId, descriptionId }: {
  state: FileRollbackState
  onClose: () => void
  onPreview: () => void
  onConfirm: () => void
  onConfirmFile: (path: string) => void
  titleId: string
  descriptionId: string
}) {
  const { phase, preview, result } = state
  const busy = phase === 'loading' || phase === 'executing'
  const readyFeedbackKey = !result && !state.outcomeUnconfirmed && preview?.files.some((file) => !file.safe)
    ? 'fileRollbackUnsafeHint'
    : canConfirmFileRollback(state) ? 'fileRollbackSafeHint' : 'fileRollbackHint'
  const feedbackKey = {
    loading: 'fileRollbackLoading',
    executing: 'fileRollbackExecuting',
    'preview-error': 'fileRollbackPreviewError',
    unconfirmed: 'fileRollbackUnconfirmed',
    blocked: 'fileRollbackBlocked',
    failed: 'fileRollbackFailed',
    completed: 'fileRollbackCompleted',
    partial: 'fileRollbackPartial',
    ready: readyFeedbackKey,
  } as const
  const counts = { restored: result?.restored ?? 0, removed: result?.removedCreated ?? 0 }
  return <>
    <div className="quickforge-file-rollback-heading">
      <h2 id={titleId} tabIndex={-1}>{t('fileRollbackTitle')}</h2>
      <button type="button" className="quickforge-file-rollback-close" aria-label={t('close')} onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
    <p id={descriptionId} className="quickforge-file-rollback-description">{t('fileRollbackDescription')} {t('fileRollbackHint')}</p>
    <div aria-busy={busy}>
      {[true, false].map((safe) => {
        const files = preview?.files.filter((file) => file.safe === safe) ?? []
        const groupId = `${titleId}-${safe ? 'safe' : 'unsafe'}`
        return <section key={String(safe)} className="quickforge-file-rollback-group" aria-labelledby={groupId}>
          <h3 id={groupId}>{t(safe ? 'fileRollbackSafe' : 'fileRollbackUnsafe', { count: files.length })}</h3>
          <ul>
            {files.map((file) => <li key={file.path}>
              <span className="quickforge-file-rollback-path" title={file.path}>{file.path}</span>
              <span className="quickforge-file-rollback-reason">{file.safe
                ? t(file.action === 'restore' ? 'fileRollbackRestore' : 'fileRollbackDelete')
                : explainReason(file.reason)}</span>
              {file.safe ? <button type="button" className="quickforge-file-rollback-single"
                disabled={!canConfirmSingleFileRollback(state, file.path)} onClick={() => onConfirmFile(file.path)}
                aria-label={`${t('fileRollbackConfirmFile')}: ${file.path}`}>
                {t('fileRollbackConfirmFile')}
              </button> : null}
            </li>)}
          </ul>
        </section>
      })}
    </div>
    <div className="quickforge-file-rollback-feedback" role="status" aria-live="polite" aria-atomic="true">
      <p>{t(feedbackKey[phase], counts)}</p>
      {preview?.reason ? <p>{explainReason(preview.reason)}</p> : null}
      {state.outcomeUnconfirmed && phase !== 'unconfirmed' ? <p>{t('fileRollbackUnconfirmed')}</p> : null}
      {result?.status === 'partial' && result.errors.length === 0 && phase !== 'partial'
        ? <p>{t('fileRollbackPartial', counts)}</p> : null}
      {result && (result.status === 'failed' || result.errors.length > 0) && phase !== 'failed'
        ? <p>{t('fileRollbackFailed', counts)}</p> : null}
    </div>
    {!busy && phase !== 'completed' ? <button type="button" className="quickforge-file-rollback-recheck" onClick={onPreview}>
      {t('fileRollbackRetry')}
    </button> : null}
    <div className="quickforge-file-rollback-actions">
      <button type="button" className="quickforge-file-rollback-confirm" disabled={!canConfirmFileRollback(state)} onClick={onConfirm}>
        <Undo2 size={16} aria-hidden="true" />{t('fileRollbackConfirm')}
      </button>
    </div>
  </>
}

export function FileRollbackDialog({ client, onClose, onCompleted }: {
  client: FileRollbackClient
  onClose: () => void
  onCompleted: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const controllerRef = useRef<ReturnType<typeof createFileRollbackController> | null>(null)
  const [state, setState] = useState<FileRollbackState>({ phase: 'loading' })
  const id = useId()

  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controller = createFileRollbackController(client, setState, onCompleted)
    controllerRef.current = controller
    dialog.showModal() // Native modal supplies focus containment and makes the background inert.
    dialog.querySelector<HTMLElement>('h2')?.focus() // Never focus the destructive action initially.
    void controller.preview()
    return () => {
      controller.dispose()
      controllerRef.current = null
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [client, onCompleted])

  const close = () => {
    controllerRef.current?.dispose()
    onClose()
  }
  return <dialog ref={dialogRef} className="quickforge-file-rollback-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={(event) => { event.preventDefault(); close() }}>
    <FileRollbackDialogContent state={state} titleId={`${id}-title`} descriptionId={`${id}-description`}
      onClose={close} onPreview={() => { void controllerRef.current?.preview() }} onConfirm={() => { void controllerRef.current?.confirm() }}
      onConfirmFile={(path) => { void controllerRef.current?.confirmFile(path) }} />
  </dialog>
}

/**
 * 轮级「撤销本轮改动」内容：安全分组复用会话级弹窗 UI，但没有单文件撤销入口
 * （轮级 API 只有整轮执行）；restore/delete 与冲突原因使用轮级文案。
 */
export function TurnRollbackDialogContent({ state, onClose, onPreview, onConfirm, titleId, descriptionId }: {
  state: TurnRollbackState
  onClose: () => void
  onPreview: () => void
  onConfirm: () => void
  titleId: string
  descriptionId: string
}) {
  const { phase, preview, result } = state
  const busy = phase === 'loading' || phase === 'executing'
  const readyFeedbackKey = !result && preview?.files.some((file) => !file.safe)
    ? 'turnRollbackUnsafeHint'
    : canConfirmTurnRollback(state) ? 'turnRollbackSafeHint' : 'turnRollbackHint'
  const feedbackKey = {
    loading: 'fileRollbackLoading',
    executing: 'fileRollbackExecuting',
    'preview-error': 'fileRollbackPreviewError',
    unconfirmed: 'fileRollbackUnconfirmed',
    conflict: 'turnRollbackConflict',
    failed: 'fileRollbackFailed',
    completed: 'fileRollbackCompleted',
    partial: 'turnRollbackPartial',
    ready: readyFeedbackKey,
  } as const
  const counts = turnRollbackCounts(result)
  return <>
    <div className="quickforge-file-rollback-heading">
      <h2 id={titleId} tabIndex={-1}>{t('turnRollbackTitle')}</h2>
      <button type="button" className="quickforge-file-rollback-close" aria-label={t('close')} onClick={onClose}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
    <p id={descriptionId} className="quickforge-file-rollback-description">{t('turnRollbackDescription')} {t('turnRollbackHint')}</p>
    <div aria-busy={busy}>
      {[true, false].map((safe) => {
        const files = preview?.files.filter((file) => file.safe === safe) ?? []
        const groupId = `${titleId}-${safe ? 'safe' : 'unsafe'}`
        return <section key={String(safe)} className="quickforge-file-rollback-group" aria-labelledby={groupId}>
          <h3 id={groupId}>{t(safe ? 'fileRollbackSafe' : 'fileRollbackUnsafe', { count: files.length })}</h3>
          <ul>
            {files.map((file) => <li key={file.path}>
              <span className="quickforge-file-rollback-path" title={file.path}>{file.path}</span>
              <span className="quickforge-file-rollback-reason">{file.safe
                ? t(file.action === 'restore' ? 'turnRollbackRestore' : 'turnRollbackDelete')
                : explainTurnReason(file.reason)}</span>
            </li>)}
          </ul>
        </section>
      })}
    </div>
    <div className="quickforge-file-rollback-feedback" role="status" aria-live="polite" aria-atomic="true">
      <p>{t(feedbackKey[phase], counts)}</p>
      {result?.conflicts.length ? <p>{result.conflicts
        .map((file) => `${file.path}${file.reason ? `：${explainTurnReason(file.reason)}` : ''}`)
        .join('；')}</p> : null}
    </div>
    {!busy && phase !== 'completed' ? <button type="button" className="quickforge-file-rollback-recheck" onClick={onPreview}>
      {t('fileRollbackRetry')}
    </button> : null}
    <div className="quickforge-file-rollback-actions">
      <button type="button" className="quickforge-file-rollback-confirm" disabled={!canConfirmTurnRollback(state)} onClick={onConfirm}>
        <Undo2 size={16} aria-hidden="true" />{t('turnRollbackConfirm')}
      </button>
    </div>
  </>
}

export function TurnRollbackDialog({ client, turnIds, onClose, onCompleted }: {
  client: TurnRollbackClient
  turnIds: string[]
  onClose: () => void
  onCompleted: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const controllerRef = useRef<ReturnType<typeof createTurnRollbackController> | null>(null)
  const [state, setState] = useState<TurnRollbackState>({ phase: 'loading' })
  const id = useId()

  useLayoutEffect(() => {
    const dialog = dialogRef.current!
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const controller = createTurnRollbackController(client, turnIds, setState, onCompleted)
    controllerRef.current = controller
    dialog.showModal() // Native modal supplies focus containment and makes the background inert.
    dialog.querySelector<HTMLElement>('h2')?.focus() // Never focus the destructive action initially.
    void controller.preview()
    return () => {
      controller.dispose()
      controllerRef.current = null
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [client, turnIds, onCompleted])

  const close = () => {
    controllerRef.current?.dispose()
    onClose()
  }
  return <dialog ref={dialogRef} className="quickforge-file-rollback-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={(event) => { event.preventDefault(); close() }}>
    <TurnRollbackDialogContent state={state} titleId={`${id}-title`} descriptionId={`${id}-description`}
      onClose={close} onPreview={() => { void controllerRef.current?.preview() }} onConfirm={() => { void controllerRef.current?.confirm() }} />
  </dialog>
}
