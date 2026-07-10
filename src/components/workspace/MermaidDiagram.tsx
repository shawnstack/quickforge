import { useEffect, useState } from 'react'
import { t } from '@/lib/i18n'
import { createMermaidSvgDataUrl, renderMermaidSvg } from '@/lib/mermaid-renderer'

type MermaidDiagramProps = {
  source: string
}

type MermaidDiagramState = {
  source: string
  dataUrl: string
  error: boolean
}

type MermaidDiagramMode = {
  source: string
  value: 'preview' | 'source'
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const [mode, setMode] = useState<MermaidDiagramMode>({ source, value: 'preview' })
  const [state, setState] = useState<MermaidDiagramState>({ source: '', dataUrl: '', error: false })

  useEffect(() => {
    let cancelled = false

    void renderMermaidSvg(source)
      .then((svg) => {
        if (cancelled) return
        setState({ source, dataUrl: createMermaidSvgDataUrl(svg), error: false })
      })
      .catch(() => {
        if (cancelled) return
        setState({ source, dataUrl: '', error: true })
      })

    return () => {
      cancelled = true
    }
  }, [source])

  const currentState = state.source === source ? state : { source, dataUrl: '', error: false }
  const currentMode = mode.source === source ? mode.value : 'preview'
  const loading = state.source !== source
  const showSource = currentMode === 'source' || currentState.error

  return (
    <figure className="my-5 overflow-hidden rounded-xl border border-border bg-muted/20">
      <figcaption className="flex min-h-9 items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] text-muted-foreground/65">mermaid</span>
        <span className="inline-flex items-center gap-1 rounded-md bg-background/70 p-0.5">
          <button
            type="button"
            className="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!currentState.dataUrl}
            aria-pressed={!showSource}
            onClick={() => setMode({ source, value: 'preview' })}
          >
            {t('svgPreviewMode')}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-pressed={showSource}
            onClick={() => setMode({ source, value: 'source' })}
          >
            {t('svgSourceMode')}
          </button>
        </span>
      </figcaption>

      {loading ? (
        <div className="flex min-h-28 items-center justify-center px-4 py-8 text-xs text-muted-foreground/70" role="status">
          {t('mermaidRendering')}
        </div>
      ) : showSource ? (
        <>
          {currentState.error ? <p className="px-4 pt-3 text-xs text-muted-foreground">{t('mermaidRenderFailed')}</p> : null}
          <pre className="overflow-auto p-4 text-[12px] leading-5"><code>{source}</code></pre>
        </>
      ) : (
        <div className="flex min-h-28 justify-center overflow-auto bg-background/45 p-4">
          <img className="h-auto max-w-full object-contain" src={currentState.dataUrl} alt={t('mermaidPreviewLabel')} />
        </div>
      )}
    </figure>
  )
}
