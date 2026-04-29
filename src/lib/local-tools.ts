import type { AgentTool } from '@mariozechner/pi-agent-core'
import { registerToolRenderer } from '@mariozechner/pi-web-ui'
import { html } from 'lit'
import { Type } from 'typebox'

type ToolResponse = {
  content: string
  details?: unknown
}

type ToolStatus = 'Running' | 'Done' | 'Error' | 'Called'

type ToolResultLike = {
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
  details?: unknown
}

function stringifyValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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

class LocalWorkspaceToolRenderer {
  private readonly toolName: string
  private readonly label: string

  constructor(toolName: string, label: string) {
    this.toolName = toolName
    this.label = label
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status: ToolStatus = result?.isError ? 'Error' : result ? 'Done' : isStreaming ? 'Running' : 'Called'
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
            <svg class="shrink-0 ${status === 'Error' ? 'text-destructive' : status === 'Running' ? 'text-primary' : 'text-green-600 dark:text-green-500'}" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 8 4 4-4 4"/><path d="M13 16h4"/><rect width="18" height="14" x="3" y="5" rx="2"/></svg>
            <span class="min-w-0 flex-1 truncate">${this.label}${summary ? html`<span class="text-muted-foreground/70"> · ${summary}</span>` : ''}</span>
            <span class="shrink-0 text-xs ${status === 'Error' ? 'text-destructive' : status === 'Running' ? 'text-primary' : 'text-muted-foreground'}">${status}</span>
          </summary>
          <div class="mt-3 space-y-3">
            ${input ? html`
              <div>
                <div class="mb-1 text-xs font-medium text-muted-foreground">Input</div>
                <code-block .code=${input} language="json"></code-block>
              </div>
            ` : ''}
            ${output ? html`
              <div>
                <div class="mb-1 text-xs font-medium text-muted-foreground">Output</div>
                ${this.toolName === 'run_command'
                  ? html`<console-block .content=${output} .variant=${variant}></console-block>`
                  : html`<code-block .code=${output} language="text"></code-block>`}
              </div>
            ` : ''}
            ${details ? html`
              <div>
                <div class="mb-1 text-xs font-medium text-muted-foreground">Details</div>
                <code-block .code=${details} language="json"></code-block>
              </div>
            ` : ''}
          </div>
        </details>
      `,
    }
  }
}

function registerLocalWorkspaceToolRenderers() {
  const renderers: Array<[string, string]> = [
    ['get_project_info', 'Project Info'],
    ['list_dir', 'List Directory'],
    ['read_file', 'Read File'],
    ['grep_files', 'Search Files'],
    ['write_file', 'Write File'],
    ['edit_file', 'Edit File'],
    ['run_command', 'Run Command'],
  ]

  for (const [name, label] of renderers) {
    registerToolRenderer(name, new LocalWorkspaceToolRenderer(name, label))
  }
}

registerLocalWorkspaceToolRenderers()

async function callLocalTool(name: string, params: unknown, signal?: AbortSignal): Promise<ToolResponse> {
  const response = await fetch(`/api/tools/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || `${name} failed with HTTP ${response.status}`)
  }

  return payload as ToolResponse
}

function createLocalTool<T extends AgentTool>(tool: T): T {
  return tool
}

export const localWorkspaceTools: AgentTool[] = [
  createLocalTool({
    name: 'get_project_info',
    label: 'Project Info',
    description: 'Get the currently selected local project directory used by workspace tools.',
    parameters: Type.Object({}),
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('get_project_info', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'list_dir',
    label: 'List Directory',
    description: 'List files and folders inside the currently selected project. Paths are relative to the project root.',
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: 'Directory path relative to the workspace root. Defaults to .', default: '.' })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('list_dir', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'read_file',
    label: 'Read File',
    description: 'Read a UTF-8 text file inside the currently selected project. Use offset and limit for large files.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      offset: Type.Optional(Type.Number({ description: '1-based line offset.', default: 1 })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to return.', default: 200 })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('read_file', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'grep_files',
    label: 'Search Files',
    description: 'Search text in the currently selected project files. Returns matching file paths and line numbers.',
    parameters: Type.Object({
      query: Type.String({ description: 'Plain text or regular expression to search for.' }),
      path: Type.Optional(Type.String({ description: 'Directory path relative to the workspace root. Defaults to .', default: '.' })),
      regex: Type.Optional(Type.Boolean({ description: 'Treat query as a regular expression.', default: false })),
      caseSensitive: Type.Optional(Type.Boolean({ description: 'Use case-sensitive matching.', default: false })),
      limit: Type.Optional(Type.Number({ description: 'Maximum matches to return.', default: 200 })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('grep_files', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'write_file',
    label: 'Write File',
    description: 'Create or overwrite a UTF-8 text file inside the currently selected project.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      content: Type.String({ description: 'Complete file content to write.' }),
    }),
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('write_file', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'edit_file',
    label: 'Edit File',
    description: 'Edit a text file by replacing exact text. oldText must match exactly once.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      oldText: Type.String({ description: 'Exact existing text to replace. Must be unique in the file.' }),
      newText: Type.String({ description: 'Replacement text.' }),
    }),
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('edit_file', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
  createLocalTool({
    name: 'run_command',
    label: 'Run Command',
    description: 'Run a shell command in the currently selected project. Use this for lint, build, tests, git status, and diagnostics.',
    parameters: Type.Object({
      command: Type.String({ description: 'Command to execute in the workspace.' }),
      timeoutSeconds: Type.Optional(Type.Number({ description: 'Timeout in seconds. Defaults to 60.', default: 60 })),
    }),
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      const result = await callLocalTool('run_command', params, signal)
      return { content: [{ type: 'text', text: result.content }], details: result.details }
    },
  }),
]

export function getLocalWorkspaceTools(yoloMode: boolean): AgentTool[] {
  return yoloMode ? localWorkspaceTools : []
}
