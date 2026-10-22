/* eslint-disable react-refresh/only-export-components -- exports the two menu halves (trigger + popover) plus their shared controller hook. */
import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { t } from '@/lib/i18n'
import type { CapabilitySuggestion } from '../capability-suggestions'

/**
 * Composer "+" menu, previously injected by
 * `panel-decoration/composer-plus-menu.ts`.
 *
 * The decoration prepended its trigger into the composer's left control row and
 * inserted the popover as a sibling **before** the editor card, then rebuilt the
 * popover's `innerHTML` per view (main / plugins) and dismissed itself from a
 * document-level capture pointerdown.
 *
 * The trigger and the popover therefore live in two different DOM positions, so
 * this module exposes them as two components sharing one controller hook:
 * - `ComposerPlusTrigger` goes into `MessageEditor`'s `leadingControls`
 *   (the left control row, where the decoration prepended it);
 * - `ComposerPlusPopover` renders next to the editor card, in flow, where the
 *   decoration inserted it — the CSS (`.quickforge-plus-popover`) is written for
 *   that position.
 */

const PlusIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)

const AttachmentIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

const PluginsIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7.5 4.5h5a1.5 1.5 0 0 1 1.5 1.5v2h1a2.5 2.5 0 0 1 0 5h-1v2a1.5 1.5 0 0 1-1.5 1.5h-2v1a2.5 2.5 0 0 1-5 0v-1h-2A1.5 1.5 0 0 1 2 15.5v-3h1a2 2 0 1 0 0-4H2v-2A1.5 1.5 0 0 1 3.5 5h2v-1a2.5 2.5 0 0 1 5 0v.5Z" />
  </svg>
)

const BackIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m15 18-6-6 6-6" />
  </svg>
)

// Icons for capability rows, mirroring the iconKind mapping used by @ mentions.
// Rows produced for plugins only ever carry these kinds; the generic plugins
// icon covers any plugin without a dedicated builtin icon.
const PLUGIN_ROW_ICONS: Record<CapabilitySuggestion['iconKind'], ReactElement> = {
  plugin: PluginsIcon,
  document: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.4 2.8h6.1L15.8 7v10.2H5.4z" /><path d="M11.4 2.9V7h4.1" /><path d="M7.6 10.2h5" /><path d="M7.6 13h4.3" />
    </svg>
  ),
  spreadsheet: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.4" y="4" width="13.2" height="12.2" rx="1.5" /><path d="M3.4 8h13.2" /><path d="M7.8 4v12.2" /><path d="M12.2 4v12.2" /><path d="M3.4 12h13.2" />
    </svg>
  ),
  presentation: (
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.2h14" /><rect x="4.2" y="4.2" width="11.6" height="8.4" rx="1.2" /><path d="M10 12.6v3.2" /><path d="m7.2 17 2.8-1.2 2.8 1.2" /><path d="M7.1 9.5 9 7.7l1.5 1.3 2.4-2.5" />
    </svg>
  ),
  skill: PluginsIcon,
  tool: PluginsIcon,
  command: PluginsIcon,
}

export type ComposerPlusView = 'main' | 'plugins'

export type ComposerPlusMenuController = {
  open: boolean
  view: ComposerPlusView
  triggerRef: RefObject<HTMLButtonElement | null>
  toggle: () => void
  close: () => void
  setView: (view: ComposerPlusView) => void
}

/**
 * Shared state for the trigger (left control row) and the popover (next to the
 * editor card). `onBeforeOpen` closes the other composer popovers: they are
 * mutually exclusive with this one.
 */
export function useComposerPlusMenu(onBeforeOpen?: () => void): ComposerPlusMenuController {
  const [open, setOpen] = useState(false)
  const [view, setViewState] = useState<ComposerPlusView>('main')
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (wasOpen) return false
      onBeforeOpen?.()
      return true
    })
    // Every open starts on the main view, like the decoration.
    setViewState('main')
  }, [onBeforeOpen])
  const setView = useCallback((next: ComposerPlusView) => setViewState(next), [])

  return { open, view, triggerRef, toggle, close, setView }
}

export type ComposerPlusTriggerProps = {
  controller: ComposerPlusMenuController
  /** Side Chat keeps the trigger visible but inert. */
  disabled?: boolean
}

export function ComposerPlusTrigger({ controller, disabled = false }: ComposerPlusTriggerProps) {
  const { open, triggerRef, toggle } = controller
  return (
    <button
      ref={triggerRef}
      type="button"
      className="quickforge-plus-inline inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground"
      title={t('composerAddMenu')}
      aria-label={t('composerAddMenu')}
      aria-haspopup="menu"
      aria-expanded={open}
      disabled={disabled}
      // Opening happens on pointerdown so the textarea keeps its selection and
      // focus (the decoration did the same).
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (disabled) return
        toggle()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {PlusIcon}
    </button>
  )
}

function PlusMenuItem({
  className,
  icon,
  label,
  description,
  pluginName,
  onSelect,
}: {
  className?: string
  icon: ReactElement
  label: string
  description?: string
  pluginName?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`quickforge-plus-popover-item${className ? ` ${className}` : ''}`}
      data-quickforge-plugin-name={pluginName}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    >
      <span className="quickforge-plus-popover-item-icon">{icon}</span>
      <span className="quickforge-plus-popover-item-main">
        <span className="quickforge-plus-popover-item-label">{label}</span>
        {description ? <span className="quickforge-plus-popover-item-description">{description}</span> : null}
      </span>
    </button>
  )
}

export type ComposerPlusPopoverProps = {
  controller: ComposerPlusMenuController
  attachmentsEnabled: boolean
  pluginsEnabled: boolean
  availablePluginRows: () => CapabilitySuggestion[]
  selectPluginCapability: (pluginName: string) => void
  /** Opens the editor's native file input. */
  onPickAttachment: () => void
}

export function ComposerPlusPopover({
  controller,
  attachmentsEnabled,
  pluginsEnabled,
  availablePluginRows,
  selectPluginCapability,
  onPickAttachment,
}: ComposerPlusPopoverProps) {
  const { open, view, setView, close, triggerRef } = controller
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    // Dismiss on any pointerdown outside the popover and its trigger — the same
    // document-level capture listener the decoration installed.
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (popoverRef.current?.contains(target ?? null)) return
      if (triggerRef.current?.contains(target ?? null)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [close, open, triggerRef])

  if (!open) return null

  return (
    <div ref={popoverRef} className="quickforge-plus-popover" role="menu">
      <div className="quickforge-plus-popover-header">
        {view === 'plugins' ? t('composerAddPlugins') : t('composerAddMenu')}
      </div>
      {view === 'main' ? (
        <>
          {attachmentsEnabled ? (
            <PlusMenuItem
              icon={AttachmentIcon}
              label={t('composerAddAttachment')}
              onSelect={() => {
                close()
                onPickAttachment()
              }}
            />
          ) : null}
          {pluginsEnabled && availablePluginRows().length > 0 ? (
            <PlusMenuItem
              icon={PluginsIcon}
              label={t('composerAddPlugins')}
              onSelect={() => setView('plugins')}
            />
          ) : null}
        </>
      ) : (
        <>
          <PlusMenuItem
            className="quickforge-plus-popover-back"
            icon={BackIcon}
            label={t('composerAddBack')}
            onSelect={() => setView('main')}
          />
          {availablePluginRows().map((row) => (
            <PlusMenuItem
              key={`${row.pluginName}:${row.label}`}
              icon={PLUGIN_ROW_ICONS[row.iconKind] ?? PluginsIcon}
              label={row.label}
              description={row.description}
              pluginName={row.pluginName}
              onSelect={() => {
                selectPluginCapability(row.pluginName)
                close()
              }}
            />
          ))}
        </>
      )}
    </div>
  )
}
