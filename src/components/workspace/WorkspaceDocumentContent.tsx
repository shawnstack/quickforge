import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PreviewErrorState } from '@/components/preview/PreviewErrorState'
import { classifyPreviewIssue, workspacePreviewCheckUrl, type PreviewIssue } from '@/components/preview/preview-error'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { workspacePreviewUrl, type DocumentFormat } from './artifact-preview-utils'

const EXCEL_PAGE_SIZE = 100
const EXCEL_MAX_ROWS = 5000
const PDF_RENDER_MARGIN = '900px 0px'

type WorkspaceDocumentContentProps = {
  projectId: string
  path: string
  format: DocumentFormat
  reloadNonce?: number
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; issue: PreviewIssue }
  | { status: 'ready'; data: ArrayBuffer }

function previewIssueFromError(path: string, error: unknown) {
  return classifyPreviewIssue({
    code: 'PREVIEW_SERVICE_FAILED',
    path,
    error: error instanceof Error ? error.message : String(error),
  })
}

function WorkspaceDocumentLoading() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground/75">
      <RefreshCw className="mr-2 size-4 animate-spin" />
      {t('workspaceDocumentLoading')}
    </div>
  )
}

function PdfPage({ pdf, pageNumber }: { pdf: Pick<PDFDocumentProxy, 'getPage'>; pageNumber: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const [rendered, setRendered] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: PDF_RENDER_MARGIN })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || rendered) return undefined
    let cancelled = false
    let renderTask: { cancel?: () => void; promise: Promise<unknown> } | undefined
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const canvas = canvasRef.current
      const host = hostRef.current
      if (!canvas || !host) return
      const baseViewport = page.getViewport({ scale: 1 })
      const availableWidth = Math.max(280, Math.min(host.clientWidth || 860, 1100))
      const scale = Math.min(2, availableWidth / baseViewport.width)
      const viewport = page.getViewport({ scale })
      const outputScale = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`
      const nextRenderTask = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })
      renderTask = nextRenderTask
      return nextRenderTask.promise
    }).then(() => {
      if (!cancelled) setRendered(true)
    }).catch((renderError) => {
      if (!cancelled && renderError?.name !== 'RenderingCancelledException') {
        setError(renderError instanceof Error ? renderError.message : String(renderError))
      }
    })
    return () => {
      cancelled = true
      renderTask?.cancel?.()
    }
  }, [pageNumber, pdf, rendered, visible])

  return (
    <div ref={hostRef} className="relative flex min-h-48 w-full flex-col items-center rounded-xl border border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-background p-3 shadow-sm">
      <div className="mb-2 text-[11px] font-medium text-muted-foreground/65">{t('workspacePdfPage', { page: pageNumber })}</div>
      {error ? <div className="p-6 text-sm text-destructive">{error}</div> : null}
      {!error ? <canvas ref={canvasRef} className={cn('max-w-full bg-white', !rendered && 'min-h-40')} /> : null}
      {!error && !rendered ? <div className="absolute text-xs text-muted-foreground/65">{t('workspaceDocumentLoading')}</div> : null}
    </div>
  )
}

function PdfDocument({ data }: { data: ArrayBuffer }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    let loadingTask: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined
    void import('pdfjs-dist').then((pdfjs) => {
      if (disposed) return undefined
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), disableRange: true, disableStream: true })
      return loadingTask.promise
    }).then((document) => {
      if (!disposed && document) setPdf(document)
    }).catch((parseError) => {
      if (!disposed) setError(parseError instanceof Error ? parseError.message : String(parseError))
    })
    return () => {
      disposed = true
      void loadingTask?.destroy?.()
    }
  }, [data])

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!pdf) return <WorkspaceDocumentLoading />
  return (
    <div className="h-full overflow-auto bg-muted/10 px-4 py-5">
      <div className="mx-auto flex max-w-[72rem] flex-col gap-5">
        {Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} />)}
      </div>
    </div>
  )
}

function DocxDocument({ data }: { data: ArrayBuffer }) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const styleRef = useRef<HTMLDivElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let disposed = false
    const body = bodyRef.current
    const styles = styleRef.current
    if (!body || !styles) return undefined
    body.replaceChildren()
    styles.replaceChildren()
    void import('docx-preview').then(({ renderAsync }) => renderAsync(data.slice(0), body, styles, {
      className: 'quickforge-docx-preview',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      ignoreWidth: false,
      ignoreHeight: false,
      useBase64URL: false,
    })).catch((parseError) => {
      if (!disposed) setError(parseError instanceof Error ? parseError.message : String(parseError))
    })
    return () => {
      disposed = true
      body.replaceChildren()
      styles.replaceChildren()
    }
  }, [data])

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  return (
    <div className="h-full overflow-auto bg-muted/10 px-4 py-5">
      <div ref={styleRef} />
      <div className="quickforge-docx-scope mx-auto max-w-[72rem] overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-background shadow-sm">
        <div ref={bodyRef} />
      </div>
    </div>
  )
}

type ExcelSheet = {
  name: string
  rows: string[][]
  totalRows: number
  truncated: boolean
}

function ExcelDocument({ data }: { data: ArrayBuffer }) {
  const [sheets, setSheets] = useState<ExcelSheet[]>([])
  // sheet/页码状态锚定到当前 data：数据重新加载后自动回到第 0 个 sheet、第 0 页，避免 effect 中重置。
  const [sheetState, setSheetState] = useState({ data, sheet: 0, page: 0 })
  const [error, setError] = useState('')
  const activeSheet = sheetState.data === data ? sheetState.sheet : 0
  const page = sheetState.data === data ? sheetState.page : 0

  useEffect(() => {
    let disposed = false
    void import('xlsx').then((xlsx) => {
      const workbook = xlsx.read(data.slice(0), { type: 'array', cellDates: true })
      return workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name]
        const rawRows = worksheet ? xlsx.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false, defval: '' }) : []
        const totalRows = rawRows.length
        const rows = rawRows.slice(0, EXCEL_MAX_ROWS).map((row) => row.map((cell) => String(cell ?? '')))
        return { name, rows, totalRows, truncated: totalRows > EXCEL_MAX_ROWS }
      })
    }).then((nextSheets) => {
      if (!disposed) setSheets(nextSheets)
    }).catch((parseError) => {
      if (!disposed) setError(parseError instanceof Error ? parseError.message : String(parseError))
    })
    return () => { disposed = true }
  }, [data])

  const sheet = sheets[activeSheet]
  const pageCount = sheet ? Math.max(1, Math.ceil(sheet.rows.length / EXCEL_PAGE_SIZE)) : 1
  const visibleRows = useMemo(() => sheet?.rows.slice(page * EXCEL_PAGE_SIZE, (page + 1) * EXCEL_PAGE_SIZE) ?? [], [page, sheet])
  const columnCount = visibleRows.reduce((max, row) => Math.max(max, row.length), 0)

  if (error) return <div className="p-6 text-sm text-destructive">{error}</div>
  if (!sheet) return <WorkspaceDocumentLoading />
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[color-mix(in_oklab,var(--border)_42%,transparent)] bg-muted/15 px-3 py-2">
        {sheets.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            type="button"
            className={cn('h-8 shrink-0 rounded-xl px-3 text-xs font-medium transition-colors', index === activeSheet ? 'bg-muted/70 text-foreground' : 'text-muted-foreground/70 hover:bg-muted/35 hover:text-foreground/90')}
            onClick={() => { setSheetState({ data, sheet: index, page: 0 }) }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/5">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={page * EXCEL_PAGE_SIZE + rowIndex}>
                <th className="sticky left-0 z-10 w-12 border-b border-r border-border/45 bg-muted/35 px-2 py-1.5 text-right font-mono font-normal text-muted-foreground/60">
                  {page * EXCEL_PAGE_SIZE + rowIndex + 1}
                </th>
                {Array.from({ length: columnCount }, (_, columnIndex) => (
                  <td key={columnIndex} className="max-w-80 whitespace-pre-wrap break-words border-b border-r border-border/35 bg-background px-2.5 py-1.5 align-top text-foreground/82">
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color-mix(in_oklab,var(--border)_42%,transparent)] px-3 py-2 text-xs text-muted-foreground/70">
        <div className="min-w-0 truncate">
          {t('workspaceExcelRows', { shown: Math.min(sheet.rows.length, (page + 1) * EXCEL_PAGE_SIZE), total: sheet.totalRows })}
          {sheet.truncated ? ` · ${t('workspaceExcelTruncated', { count: EXCEL_MAX_ROWS })}` : ''}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" disabled={page === 0} onClick={() => setSheetState({ data, sheet: activeSheet, page: Math.max(0, page - 1) })} aria-label={t('workspacePreviousPage')} title={t('workspacePreviousPage')}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center font-mono">{page + 1} / {pageCount}</span>
          <Button variant="ghost" size="icon" className="size-8" disabled={page + 1 >= pageCount} onClick={() => setSheetState({ data, sheet: activeSheet, page: Math.min(pageCount - 1, page + 1) })} aria-label={t('workspaceNextPage')} title={t('workspaceNextPage')}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceDocumentContent({ projectId, path, format, reloadNonce = 0 }: WorkspaceDocumentContentProps) {
  const [manualNonce, setManualNonce] = useState(reloadNonce)
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  // revision 由 prop reloadNonce 与手动刷新序号派生，Tab 复用时递增的 reloadNonce 能直接触发重新加载。
  const revision = Math.max(reloadNonce, manualNonce)
  const previewUrl = workspacePreviewUrl(projectId, path, revision)

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setManualNonce((current) => Math.max(current, reloadNonce) + 1)
  }, [reloadNonce])

  useEffect(() => {
    const controller = new AbortController()
    void fetch(workspacePreviewCheckUrl(previewUrl), { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setState({
          status: 'error',
          issue: classifyPreviewIssue({
            status: response.status,
            code: typeof payload?.code === 'string' ? payload.code : undefined,
            path: typeof payload?.path === 'string' ? payload.path : path,
            error: typeof payload?.error === 'string' ? payload.error : `${response.status} ${response.statusText}`.trim(),
          }),
        })
        return undefined
      }
      return fetch(previewUrl, { cache: 'no-cache', signal: controller.signal })
    }).then(async (response) => {
      if (!response) return
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
      setState({ status: 'ready', data: await response.arrayBuffer() })
    }).catch((error) => {
      if (!controller.signal.aborted) setState({ status: 'error', issue: previewIssueFromError(path, error) })
    })
    return () => controller.abort()
  }, [path, previewUrl])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_42%,transparent)] px-3">
        <FileText className="size-4 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/88" title={path}>{path}</div>
        <Button variant="ghost" size="icon" className="size-8 rounded-xl text-muted-foreground/75" onClick={reload} aria-label={t('refreshPreview')} title={t('refreshPreview')}>
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {state.status === 'loading' ? <WorkspaceDocumentLoading /> : null}
        {state.status === 'error' ? <PreviewErrorState issue={state.issue} onRetry={reload} /> : null}
        {state.status === 'ready' && format === 'pdf' ? <PdfDocument data={state.data} /> : null}
        {state.status === 'ready' && format === 'docx' ? <DocxDocument data={state.data} /> : null}
        {state.status === 'ready' && format === 'excel' ? <ExcelDocument data={state.data} /> : null}
      </div>
    </div>
  )
}
