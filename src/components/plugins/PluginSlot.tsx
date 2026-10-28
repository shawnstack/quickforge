import { useEffect, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ExternalLink,
  Info,
  Languages,
  Play,
  Puzzle,
  Settings2,
  Sparkles,
  Star,
  Wand2,
  X,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { resolvePluginUiPayload } from '@/lib/plugin-ui-resolve'
import {
  dismissPluginUiToast,
  dispatchPluginUiAction,
  ensurePluginUiLoaded,
  usePluginUiSnapshot,
  usePluginUiToasts,
} from '@/lib/plugin-ui-client'
import type { PluginUiEvent, PluginUiNode, PluginUiSlotName, PluginUiSlotProps } from '@/lib/plugin-ui-types'

// A closed icon set on purpose: plugins name an icon, they never ship SVG or a
// component. Unknown names simply render without an icon.
const ICONS = {
  puzzle: Puzzle,
  sparkles: Sparkles,
  star: Star,
  zap: Zap,
  languages: Languages,
  play: Play,
  settings: Settings2,
  info: Info,
  check: Check,
  arrow: ArrowRight,
  wand: Wand2,
  link: ExternalLink,
} as const

type RenderContext = {
  plugin: string
  slot: PluginUiSlotName
  props: PluginUiSlotProps
  state: Record<string, unknown>
  run: (event: PluginUiEvent) => void
}

function toneClass(tone: PluginUiNode['tone']): string {
  // Only two visual weights exist in the design language: quiet (neutral) and
  // accented. Everything else maps onto those two rather than inventing a new
  // palette for plugins.
  if (tone === 'danger') return 'text-destructive'
  if (tone === 'neutral' || !tone) return 'text-muted-foreground'
  return 'text-primary'
}

function renderChildren(node: PluginUiNode, context: RenderContext): ReactNode[] {
  return (node.children || []).map((child, index) => renderNode(child, context, index))
}

function renderNode(node: PluginUiNode, context: RenderContext, index: number): ReactNode {
  const key = node.key || `${node.type}-${index}`
  const Icon = node.icon && node.icon in ICONS ? ICONS[node.icon as keyof typeof ICONS] : undefined
  const fire = (event?: PluginUiEvent) => {
    if (!event) return
    context.run(resolvePluginUiPayload(event, { props: context.props, state: context.state }))
  }

  switch (node.type) {
    case 'button':
      return (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={node.variant === 'default' ? 'default' : node.variant === 'danger' ? 'destructive' : 'ghost'}
          className="h-8 gap-1.5 px-2 text-xs"
          disabled={node.disabled}
          onClick={() => fire(node.onClick)}
        >
          {Icon ? <Icon className="size-3.5" /> : null}
          {node.label ? <span className="max-w-[160px] truncate">{node.label}</span> : null}
        </Button>
      )
    case 'icon-button':
      return (
        <Button
          key={key}
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={node.disabled}
          aria-label={node.label || undefined}
          title={node.label || undefined}
          onClick={() => fire(node.onClick)}
        >
          {Icon ? <Icon className="size-4" /> : <Puzzle className="size-4" />}
        </Button>
      )
    case 'text':
      return (
        <span key={key} className="max-w-[240px] truncate text-xs text-muted-foreground">
          {node.text}
        </span>
      )
    case 'badge':
      return (
        <span
          key={key}
          className={cn(
            'inline-flex h-5 max-w-[160px] items-center truncate rounded-full border border-[color-mix(in_oklab,var(--border)_70%,transparent)] px-2 text-[11px] leading-none',
            toneClass(node.tone),
          )}
        >
          {node.label}
        </span>
      )
    case 'icon':
      return Icon ? <Icon key={key} className={cn('size-3.5', toneClass(node.tone))} /> : null
    case 'divider':
      return <span key={key} className="mx-1 h-4 w-px bg-[color-mix(in_oklab,var(--border)_60%,transparent)]" aria-hidden="true" />
    case 'hstack':
      return (
        <span key={key} className="inline-flex items-center gap-1">
          {renderChildren(node, context)}
        </span>
      )
    case 'vstack':
      return (
        <span key={key} className="inline-flex flex-col items-start gap-1">
          {renderChildren(node, context)}
        </span>
      )
    case 'list':
      return (
        <span key={key} className="inline-flex flex-col items-stretch gap-0.5">
          {renderChildren(node, context)}
        </span>
      )
    case 'input':
      return (
        <Input
          key={key}
          className="h-8 w-40 text-xs"
          defaultValue={node.value || ''}
          placeholder={node.placeholder || ''}
          disabled={node.disabled}
          onChange={(event) => node.onChange && fire({ ...node.onChange, payload: { value: event.target.value } })}
        />
      )
    case 'select':
      return (
        <select
          key={key}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
          defaultValue={node.value || ''}
          disabled={node.disabled}
          onChange={(event) => node.onChange && fire({ ...node.onChange, payload: { value: event.target.value } })}
        >
          {(node.options || []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )
    case 'toggle':
      return (
        <label key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="size-3.5 accent-[var(--primary)]"
            defaultChecked={node.checked === true}
            disabled={node.disabled}
            onChange={(event) => node.onChange && fire({ ...node.onChange, payload: { checked: event.target.checked } })}
          />
          {node.label ? <span className="max-w-[160px] truncate">{node.label}</span> : null}
        </label>
      )
    case 'link':
      return node.open ? (
        <a
          key={key}
          className={cn('inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline', toneClass(node.tone))}
          href={node.open}
          target="_blank"
          rel="noreferrer noopener"
        >
          {node.label}
          <ExternalLink className="size-3" />
        </a>
      ) : null
    default:
      // Unknown primitive from a newer plugin apiVersion: render nothing rather
      // than throwing and taking the whole slot down.
      return null
  }
}

type PluginSlotProps = {
  slot: PluginUiSlotName
  props?: PluginUiSlotProps
  className?: string
}

/** Host-owned mount point for declarative plugin contributions. */
export function PluginSlot({ slot, props, className }: PluginSlotProps) {
  const snapshot = usePluginUiSnapshot()

  useEffect(() => {
    ensurePluginUiLoaded()
  }, [])

  // Defensive: the server never sends an empty contribution, but an empty
  // group must not leave an empty shell inside the host UI.
  const entries = (snapshot.slots[slot] || []).filter((entry) => entry.nodes.length !== 0)
  if (entries.length === 0) return null

  return (
    <div
      className={cn('quickforge-plugin-slot inline-flex min-w-0 items-center gap-1', className)}
      data-quickforge-plugin-slot={slot}
    >
      <ErrorBoundary fallback={null}>
        {entries.map((entry) => {
          const pluginState = snapshot.plugins.find((plugin) => plugin.name === entry.plugin)?.state || {}
          const context: RenderContext = {
            plugin: entry.plugin,
            slot,
            props: props || {},
            state: pluginState,
            run: (event) => {
              void dispatchPluginUiAction(entry.plugin, slot, event, props || {})
            },
          }
          return (
            <span key={entry.plugin} className="inline-flex min-w-0 items-center gap-1" data-quickforge-plugin={entry.plugin}>
              {entry.nodes.map((node, index) => renderNode(node, context, index))}
            </span>
          )
        })}
      </ErrorBoundary>
    </div>
  )
}

/** Floating feedback surface for `toast` values returned by plugin actions. */
export function PluginUiToasts() {
  const toasts = usePluginUiToasts()
  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-quickforge"
        >
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => dismissPluginUiToast(toast.id)}
            aria-label={t('close')}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
