/* eslint-disable react-refresh/only-export-components -- exports the dialog component, the imperative `promptApiKey` entry and pure helpers (polling, escape-key decision) covered by tests. */
import type { Api, Model } from '@earendil-works/pi-ai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n'
import { loadModelCatalog } from '@/lib/model-reference'
import { getAppStorage } from '@/storage'

/**
 * React replacement for the legacy `<api-key-prompt-dialog>`.
 *
 * API semantics match `ApiKeyPromptDialog.prompt(provider) => Promise<boolean>`:
 * - The promise resolves `true` once a key for the provider appears in the
 *   local provider-keys store (the dialog polls the store, so external saves
 *   also resolve it).
 * - Closing/cancelling the dialog resolves `false`.
 * The legacy implementation polls `getAppStorage().providerKeys` every 500ms; the
 * polling core is extracted as `startApiKeyPolling` so the semantics stay
 * unit-testable without a DOM.
 */

const DEFAULT_POLL_INTERVAL_MS = 500

// Legacy `provider-key-input` cleared its "✗ Invalid" badge 5s after a failed
// test; keep the same dwell time so a rejected key does not look permanent.
const INVALID_STATE_RESET_MS = 5000

export interface ApiKeyPollOptions {
  provider: string
  getKey: (provider: string) => Promise<string | null>
  intervalMs?: number
  onFound: () => void
}

/**
 * Poll `getKey(provider)` until it returns a key, then call `onFound`.
 * Returns a stop function (also stops after `onFound` fires once).
 */
export function startApiKeyPolling({ provider, getKey, intervalMs = DEFAULT_POLL_INTERVAL_MS, onFound }: ApiKeyPollOptions): () => void {
  let stopped = false
  let found = false
  const timer = setInterval(() => {
    void (async () => {
      if (stopped || found) return
      try {
        const key = await getKey(provider)
        if (!stopped && key) {
          found = true
          clearInterval(timer)
          onFound()
        }
      } catch {
        // Storage read failed; keep polling like the legacy dialog does.
      }
    })()
  }, intervalMs)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}

/**
 * Pure keyboard decision for the dialog dismissal: only a bare Escape (no
 * Ctrl/Meta/Alt/Shift modifier) cancels the prompt.
 */
export function isDialogEscapeKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

/**
 * Models the pre-save probe may use, in priority order.
 *
 * The locally configured custom providers are the source of truth: they keep
 * the full model objects — custom request `headers` included — and they are
 * exactly what the settings tab's "Test connection" posts to
 * `POST /api/models/test-connection` (that endpoint forwards the object
 * unchanged into the provider request, see `server/routes/models.mjs`).
 *
 * `loadModelCatalog()` cannot be the primary source: the server's
 * `publicModel()` deletes `headers` (and `apiKey`) from catalog entries, so a
 * provider that needs custom request headers could never authenticate its
 * probe and its key would be rejected forever.
 * `pi-chat.getConfiguredModels()` has the same gap — it returns the catalog
 * whenever the catalog is non-empty — so the local store is read directly.
 *
 * Fallbacks, in order:
 * 1. the provider's model from the local `custom-providers` store (headers kept);
 * 2. the provider's model from `GET /api/models/catalog` (header-less entry,
 *    still probe-able when the provider needs no custom headers);
 * 3. no model at all — the caller then stores the key directly, matching the
 *    legacy `testApiKey`, which returned true when it knew no model.
 */
async function resolveProbeModel(provider: string): Promise<Model<Api> | null> {
  const local = await readLocalProviderModels()
  const configured = local.find((candidate) => candidate.provider === provider)
  if (configured) return configured

  const catalog = await loadModelCatalog()
  return catalog.find((candidate) => candidate.provider === provider) ?? null
}

async function readLocalProviderModels(): Promise<Model<Api>[]> {
  try {
    const providers = await getAppStorage().customProviders.getAll()
    return providers.flatMap((provider) => (Array.isArray(provider?.models) ? provider.models : []))
  } catch {
    // Storage may be uninitialized or unavailable; the catalog fallback still runs.
    return []
  }
}

/**
 * Legacy parity for `provider-key-input.saveKey()`: the legacy dialog probed the
 * provider (`testApiKey`, a minimal "Reply with: ok" request) before writing the
 * key to the store, so an invalid key was never persisted. QuickForge keeps
 * provider models on the server, so the probe is delegated to
 * `POST /api/models/test-connection`, which answers HTTP 200 with `{ ok, error }`
 * for both outcomes.
 *
 * Returns true when the key may be stored: the probe passed, or no model is
 * known for the provider (see `resolveProbeModel`). Cloud provider presets were
 * removed from this build (only custom providers remain), so a provider without
 * any configured model cannot be probed — the key is then stored directly to
 * keep the prompt usable, matching the legacy `testApiKey`, which also returned
 * true when it knew no model for the provider. Thrown errors count as a failed
 * test, like the legacy catch block.
 */
export async function verifyApiKeyBeforeSave(provider: string, apiKey: string): Promise<boolean> {
  try {
    const model = await resolveProbeModel(provider)
    if (!model) return true
    const response = await fetch('/api/models/test-connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, apiKey }),
    })
    const payload = (await response.json().catch(() => null)) as { ok?: boolean } | null
    return payload?.ok === true
  } catch {
    return false
  }
}

export type ApiKeySaveOutcome =
  | { status: 'saved' }
  | { status: 'invalid' }
  | { status: 'failed'; error: string }

/**
 * Test-then-store flow behind the dialog's Save button: the key reaches
 * `saveKey` only when the probe accepted it (legacy `provider-key-input.saveKey`
 * semantics). Store errors are reported as an outcome instead of throwing, so
 * the dialog can render the legacy "Failed to save API key" message.
 */
export async function saveApiKeyWithVerification(options: {
  provider: string
  apiKey: string
  saveKey: (provider: string, key: string) => Promise<void>
  verify?: (provider: string, apiKey: string) => Promise<boolean>
}): Promise<ApiKeySaveOutcome> {
  const verifyKey = options.verify ?? verifyApiKeyBeforeSave
  if (!(await verifyKey(options.provider, options.apiKey))) return { status: 'invalid' }
  try {
    await options.saveKey(options.provider, options.apiKey)
    return { status: 'saved' }
  } catch (error) {
    return { status: 'failed', error: String(error) }
  }
}

type ApiKeyPromptDialogProps = {
  provider: string
  getKey: (provider: string) => Promise<string | null>
  saveKey: (provider: string, key: string) => Promise<void>
  onResolve: (success: boolean) => void
  pollIntervalMs?: number
}

export function ApiKeyPromptDialog({ provider, getKey, saveKey, onResolve, pollIntervalMs }: ApiKeyPromptDialogProps) {
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolvedRef = useRef(false)
  const invalidResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    // Drop a pending "✗ Invalid" reset when the dialog goes away.
    if (invalidResetTimer.current !== null) clearTimeout(invalidResetTimer.current)
  }, [])

  useEffect(() => {
    return startApiKeyPolling({
      provider,
      getKey,
      intervalMs: pollIntervalMs,
      onFound: () => {
        if (!resolvedRef.current) {
          resolvedRef.current = true
          onResolve(true)
        }
      },
    })
  }, [provider, getKey, pollIntervalMs, onResolve])

  const resolveFalse = useCallback(() => {
    if (!resolvedRef.current) {
      resolvedRef.current = true
      onResolve(false)
    }
  }, [onResolve])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isDialogEscapeKey(event)) resolveFalse()
    },
    [resolveFalse],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleSave = async () => {
    if (!keyInput || saving) return
    setSaving(true)
    setError(null)
    const outcome = await saveApiKeyWithVerification({ provider, apiKey: keyInput, saveKey })
    if (outcome.status === 'saved') {
      // The poller observes the new key and resolves the prompt with true; keep
      // the dialog locked until then, like the legacy dialog did.
      return
    }
    setSaving(false)
    if (outcome.status === 'failed') {
      setError(t('apiKeyPromptSaveFailed', { error: outcome.error }))
      return
    }
    // Rejected key: show the legacy "✗ Invalid" state and clear it after 5s.
    setError(t('apiKeyPromptInvalid'))
    if (invalidResetTimer.current !== null) clearTimeout(invalidResetTimer.current)
    invalidResetTimer.current = setTimeout(() => {
      invalidResetTimer.current = null
      setError(null)
    }, INVALID_STATE_RESET_MS)
  }

  const [descriptionBefore, descriptionAfter] = t('apiKeyPromptDescription').split('{provider}')

  return (
    <div
      className="qf-api-key-prompt-dialog fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={t('apiKeyPromptTitle')}
      onClick={resolveFalse}
    >
      <div
        className="w-[min(500px,90vw)] rounded-xl border border-border bg-background p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 text-base font-semibold text-foreground">{t('apiKeyPromptTitle')}</div>
        <p className="mb-3 text-sm text-muted-foreground">
          {descriptionBefore}
          <span className="font-medium text-foreground capitalize">{provider}</span>
          {descriptionAfter}
        </p>
        <div className="flex items-center gap-2">
          <Input
            type="password"
            className="flex-1"
            placeholder={t('apiKeyPromptPlaceholder')}
            value={keyInput}
            disabled={saving}
            onChange={(event) => setKeyInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void handleSave()
              }
            }}
          />
          <Button size="sm" disabled={!keyInput || saving} onClick={() => void handleSave()}>
            {saving ? t('testingConnection') : t('save')}
          </Button>
        </div>
        {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={resolveFalse}>
            {t('cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Imperative prompt mirroring `ApiKeyPromptDialog.prompt(provider)`:
 * opens the dialog on a detached root and resolves once the key exists
 * (true) or the dialog is dismissed (false).
 */
export function promptApiKey(provider: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const storage = getAppStorage()
    const container = document.createElement('div')
    document.body.appendChild(container)
    // Restore focus to whatever was focused before the prompt when it closes
    // (the legacy modal base did the same); without this the focus fell back to
    // <body> and keyboard users lost their place.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = createRoot(container)
    const finish = (success: boolean) => {
      resolve(success)
      root.unmount()
      container.remove()
      // Deferred one macrotask (same as confirm-dialog.tsx) so the DOM has
      // settled before focusing.
      setTimeout(() => {
        if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus()
      }, 0)
    }
    root.render(
      <ApiKeyPromptDialog
        provider={provider}
        getKey={(name) => storage.providerKeys.get(name)}
        saveKey={(name, key) => storage.providerKeys.set(name, key)}
        onResolve={finish}
      />,
    )
  })
}
