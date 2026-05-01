import { registerToolRenderer } from '@mariozechner/pi-web-ui'
import { html } from 'lit'
import { t, type AppTextKey } from '@/lib/i18n'
import type { AgentTool } from '@mariozechner/pi-agent-core'

type ToolResultLike = {
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

type ToolStatusKey = 'running' | 'done' | 'error' | 'called'

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
  }
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function resultText(result: ToolResultLike | undefined) {
  return result?.content
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n') ?? ''
}

function summarizeParams(toolName: string, params: Record<string, unknown> | undefined) {
  if (!params) return ''
  if (toolName === 'run_command' && typeof params.command === 'string') return params.command
  if ('path' in params && typeof params.path === 'string') return params.path
  if ('query' in params && typeof params.query === 'string') return params.query
  return ''
}

// ---------------------------------------------------------------------------
// Tool renderers (UI display only)
// These map tool names to custom renderers so the ChatPanel shows input/output
// in a rich format (code blocks, console output, etc.) instead of raw JSON.
//
// Tool definitions (name, description, parameters) live ONLY on the server:
//   server/tools/definitions.mjs  — canonical source
//   GET /api/tools                — served as JSON
// ---------------------------------------------------------------------------

class LocalWorkspaceToolRenderer {
  private toolName: string
  private labelKey: AppTextKey

  constructor(toolName: string, labelKey: AppTextKey) {
    this.toolName = toolName
    this.labelKey = labelKey
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status: ToolStatusKey = result?.isError ? 'error' : result ? 'done' : isStreaming ? 'running' : 'called'
    const summary = summarizeParams(this.toolName, params)
    const input = stringifyValue(params)
    const output = resultText(result)
    const details = stringifyValue(result?.details)
    const variant = result?.isError ? 'error' : 'default'

    return {
      isCustom: false,
      content: html`
        <details class="group/tool">
          <summary class="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
            <svg class="shrink-0 transition-transform group-open/tool:rotate-90" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            <svg class="shrink-0 ${status === 'error' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-green-600 dark:text-green-500'}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect width="18" height="14" x="3" y="5" rx="2"/></svg>
            <span class="min-w-0 flex-1 truncate">${t(this.labelKey)}${summary ? html`<span class="text-muted-foreground/70"> · ${summary}</span>` : ''}</span>
            <span class="shrink-0 text-xs ${status === 'error' ? 'text-destructive' : status === 'running' ? 'text-primary' : 'text-muted-foreground'}">${t(status)}</span>
          </summary>
          <div class="mt-3 space-y-3">
            ${input ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('input')}</div><code-block .code=${input} language="json"></code-block></div>` : ''}
            ${output ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('output')}</div>${this.toolName === 'run_command' ? html`<console-block .content=${output} .variant=${variant}></console-block>` : html`<code-block .code=${output} language="text"></code-block>`}</div>` : ''}
            ${details ? html`<div><div class="mb-1 text-xs font-medium text-muted-foreground">${t('details')}</div><code-block .code=${details} language="json"></code-block></div>` : ''}
          </div>
        </details>
      `,
    }
  }
}

// Register renderers at import time
for (const [name, label] of [
  ['get_project_info', 'projectInfo'],
  ['list_dir', 'listDirectory'],
  ['read_file', 'readFile'],
  ['grep_files', 'searchFiles'],
  ['write_file', 'writeFile'],
  ['edit_file', 'editFile'],
  ['run_command', 'runCommand'],
] as Array<[string, AppTextKey]>) {
  registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, label))
}

// Tool execution is entirely server-side. The ChatPanel never calls .execute()
// on client-side tools — it only reads state.tools for display purposes.
// Returning an empty array is safe because ServerAgent ignores state.tools
// and the server agent has its own canonical tool list.
export function getLocalWorkspaceTools(_yoloMode: boolean, _projectId?: string): AgentTool[] {
  return []
}
