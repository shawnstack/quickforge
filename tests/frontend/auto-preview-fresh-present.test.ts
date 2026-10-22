import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findBestPreviewableArtifact } from '../../src/components/workspace/artifact-preview-utils'
import { extractToolExecutionArtifacts } from '../../src/lib/tool-artifacts'
import type { ToolExecutionEvent } from '../../src/lib/tool-execution-events'

function presentFilesEvent(files: string[], options: { defaultPreview?: string; toolCallId?: string } = {}): ToolExecutionEvent {
  return {
    toolCallId: options.toolCallId ?? 'call-present',
    toolName: 'present_files',
    result: {
      content: [{ type: 'text', text: JSON.stringify({ files, defaultPreview: options.defaultPreview }) }],
      details: { files, defaultPreview: options.defaultPreview },
    },
  }
}

describe('extractToolExecutionArtifacts', () => {
  it('extracts the files a single present_files execution just produced', () => {
    const artifacts = extractToolExecutionArtifacts(presentFilesEvent(['report.html', 'notes.md']))
    const paths = artifacts.map((artifact) => artifact.path)
    expect(paths).toContain('report.html')
    expect(paths).toContain('notes.md')
    expect(artifacts.every((artifact) => artifact.source === 'present_files')).toBe(true)
    expect(artifacts.every((artifact) => artifact.toolCallId === 'call-present')).toBe(true)
  })

  it('reads the payload from result content when details carry no files array', () => {
    const artifacts = extractToolExecutionArtifacts({
      toolCallId: 'call-content-only',
      toolName: 'present_files',
      result: {
        content: [{ type: 'text', text: JSON.stringify({ files: [{ path: 'chart.png' }] }) }],
      },
    })
    expect(artifacts.map((artifact) => artifact.path)).toEqual(['chart.png'])
  })

  it('returns nothing without a toolCallId or result', () => {
    expect(extractToolExecutionArtifacts(undefined)).toEqual([])
    expect(extractToolExecutionArtifacts({ toolName: 'present_files' })).toEqual([])
    expect(extractToolExecutionArtifacts({ toolCallId: 'call-x', toolName: 'present_files' })).toEqual([])
  })

  it('ignores tool executions that cannot present files', () => {
    expect(extractToolExecutionArtifacts({
      toolCallId: 'call-read',
      toolName: 'read_file',
      result: { content: [], details: { path: 'report.html' } },
    })).toEqual([])
  })
})

describe('findBestPreviewableArtifact', () => {
  it('prefers a present_files artifact that is previewable', () => {
    const artifact = findBestPreviewableArtifact(extractToolExecutionArtifacts(presentFilesEvent(['index.html'])))
    expect(artifact?.path).toBe('index.html')
  })

  it('skips non-previewable extensions so no panel opens for them', () => {
    const artifact = findBestPreviewableArtifact(extractToolExecutionArtifacts(presentFilesEvent(['archive.zip'])))
    expect(artifact).toBeUndefined()
  })
})

describe('auto preview source contract', () => {
  const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
  const utilsSource = readFileSync(new URL('../../src/components/workspace/artifact-preview-utils.ts', import.meta.url), 'utf8')

  it('drives auto preview from live tool_execution_end events, not message-state diffs', () => {
    expect(appSource).toContain('onLivePresentArtifacts={openLivePresentedArtifacts}')
    expect(appSource).toContain('const openLivePresentedArtifacts = useCallback(')
    // 状态差分方案已移除：历史快照 / 差分判定 / 签名去重都不应残留。
    expect(appSource).not.toContain('autoPreviewHistoryRef')
    expect(appSource).not.toContain('autoPreviewSignatureRef')
    expect(appSource).not.toContain('isNewlyPresentedArtifact')
    expect(appSource).not.toContain('collectToolResultToolCallIds')
  })

  it('reports live artifacts only for the view that is on screen', () => {
    expect(hostSource).toContain('extractToolExecutionArtifacts(event as ToolExecutionEvent)')
    expect(hostSource).toContain('isSessionViewActive(activityKey)')
    expect(hostSource).toContain('propsRef.current.onLivePresentArtifacts?.(sessionId, liveArtifacts)')
  })

  it('drops the retired state-diff helpers from the preview utils', () => {
    expect(utilsSource).not.toContain('export function collectToolResultToolCallIds(')
    expect(utilsSource).not.toContain('export function isNewlyPresentedArtifact(')
  })
})
