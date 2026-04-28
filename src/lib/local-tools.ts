import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

type ToolResponse = {
  content: string
  details?: unknown
}

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
    name: 'list_dir',
    label: 'List Directory',
    description: 'List files and folders inside the current workspace. Paths are relative to the workspace root.',
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
    description: 'Read a UTF-8 text file inside the current workspace. Use offset and limit for large files.',
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
    description: 'Search text in workspace files. Returns matching file paths and line numbers.',
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
    description: 'Create or overwrite a UTF-8 text file inside the current workspace.',
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
    description: 'Run a shell command in the current workspace. Use this for lint, build, tests, git status, and diagnostics.',
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
