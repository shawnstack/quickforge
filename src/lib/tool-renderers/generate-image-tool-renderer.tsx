import { t } from '@/lib/i18n'
import { generatedImageAssetUrl, parseGeneratedImageDetails } from '@/lib/generated-image-assets'
import { summarizeParams } from '@/lib/tool-param-summary'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import { renderCodeBlock, renderStatus, renderToolIcon, resultText, toolStatus, type ToolResultLike } from './shared'

/** generate_image 渲染器（T4 由 原 html`` 模板迁为 React，class 链保持不变）。 */
export class GenerateImageToolRenderer {
  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const details = parseGeneratedImageDetails(result?.details)
    const summary = summarizeParams('generate_image', params, result)
    const output = resultText(result)
    const model = details?.model || (typeof params?.model === 'string' ? params.model : '')

    return {
      isCustom: true,
      content: (
        <div className="quickforge-generated-image-tool space-y-3">
          <div className="quickforge-tool-summary flex items-center gap-2 text-sm text-muted-foreground">
            {renderToolIcon('generate_image')}
            <span className="min-w-0 flex-1 truncate">{t('generateImage')}{summary ? <span className="text-muted-foreground"> · {summary}</span> : null}</span>
            {renderStatus(status, timing)}
          </div>
          {details ? (
            <>
              <div className={details.assets.length > 1 ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : 'grid grid-cols-1 gap-3'}>
                {details.assets.map((asset, index) => {
                  const url = generatedImageAssetUrl(details, asset)
                  const label = t('generatedImageAlt', { index: index + 1 })
                  return (
                    <figure className="overflow-hidden rounded-lg border border-border bg-background/90" key={asset.assetId}>
                      <a href={url} target="_blank" rel="noopener noreferrer" title={t('openGeneratedImage')} aria-label={t('openGeneratedImage')}>
                        <img className="block max-h-[32rem] w-full object-contain" src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" />
                      </a>
                      <figcaption className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{model || asset.mimeType}</span>
                        <a className="text-muted-foreground transition-colors hover:text-foreground" href={url} download={asset.assetId} title={t('downloadGeneratedImage')} aria-label={t('downloadGeneratedImage')}>{t('downloadGeneratedImage')}</a>
                      </figcaption>
                    </figure>
                  )
                })}
              </div>
              {details.text ? <div className="text-sm leading-relaxed text-muted-foreground">{details.text}</div> : null}
            </>
          ) : status === 'running' ? (
            <div className="rounded-lg border border-border bg-background/90 px-3 py-6 text-center text-sm text-muted-foreground">{t('generatingImage')}</div>
          ) : output ? renderCodeBlock(output, 'text') : null}
        </div>
      ),
    }
  }
}
