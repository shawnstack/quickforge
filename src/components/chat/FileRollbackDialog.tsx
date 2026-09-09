import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import { t, type AppTextKey } from '@/lib/i18n'
import {
  canConfirmFileRollback,
  canConfirmSingleFileRollback,
  createFileRollbackController,
  type FileRollbackClient,
  type FileRollbackState,
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
