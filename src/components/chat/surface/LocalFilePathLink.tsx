import { t } from '@/lib/i18n'
import { artifactFileName } from '@/components/workspace/artifact-preview-utils'
import { fileIconUrl } from '@/components/workspace/file-icon-assets'
import { splitLocalFilePaths } from '../panel-decoration/local-file-path-links'
import { useLocalFilePathHandler } from './surface-context'

/**
 * Local file path links inside Markdown text.
 *
 * The decoration layer walked the rendered DOM after every pass, replacing text
 * nodes with `<button class="quickforge-file-path-link">` elements and stamping
 * a signature on the message element to avoid re-walking. React renders them
 * during the Markdown pass instead (`rehypeQfLocalFilePaths` splits the text
 * nodes, this component renders the segments), so:
 * - no post-render DOM mutation and no per-message signature bookkeeping;
 * - a link exists in the very first paint, not only after a decorate pass;
 * - the opener comes from context, so read-only/shared views render plain text.
 *
 * The button markup and classes are unchanged: `src/styles/chat/markdown-content.css` styles this and
 * `tests/frontend/local-file-path-links.test.ts` pins the contract.
 */

/** One inline path button; `title`/`aria-label` carry the full path text. */
export function LocalFilePathLink({ path }: { path: string }) {
  const onOpen = useLocalFilePathHandler()
  if (!onOpen) return <>{path}</>
  return (
    <button
      type="button"
      className="quickforge-file-path-link"
      data-quickforge-file-path={path}
      title={path}
      aria-label={t('openLocalFileWithPath', { path })}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onOpen(path)
      }}
    >
      {/* The icon source is shared with the tool card summary (same helper), so
          a path renders the same glyph in both places. */}
      <img src={fileIconUrl(path)} alt="" draggable={false} aria-hidden="true" />
      <span>{artifactFileName(path)}</span>
    </button>
  )
}

/**
 * Render a plain text run, turning detected local paths into links.
 *
 * Returns the text unchanged when no handler is available, so a surface without
 * a file opener never renders dead buttons.
 */
export function LocalFilePathText({ text }: { text: string }) {
  const onOpen = useLocalFilePathHandler()
  if (!onOpen) return <>{text}</>
  const segments = splitLocalFilePaths(text)
  if (segments.length === 1 && segments[0].kind === 'text') return <>{text}</>
  return (
    <>
      {segments.map((segment, index) => (
        segment.kind === 'path'
          ? <LocalFilePathLink key={`${index}:${segment.path}`} path={segment.path} />
          : <span key={`${index}:text`}>{segment.value}</span>
      ))}
    </>
  )
}
