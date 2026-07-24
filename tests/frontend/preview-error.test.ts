import { describe, expect, it } from 'vitest'
import { classifyPreviewIssue, workspacePreviewCheckUrl } from '../../src/components/preview/preview-error'

describe('classifyPreviewIssue', () => {
  it.each([
    [{ status: 404 }, 'not-found'],
    [{ status: 415 }, 'unsupported'],
    [{ status: 413 }, 'too-large'],
    [{ status: 403 }, 'permission-denied'],
    [{ status: 500 }, 'service-failed'],
    [{ status: 418 }, 'unknown'],
  ] as const)('maps %j to %s', (input, kind) => {
    expect(classifyPreviewIssue({ ...input, error: 'detail' })).toMatchObject({ kind, error: 'detail' })
  })

  it('prefers stable backend error codes', () => {
    expect(classifyPreviewIssue({ status: 500, code: 'PREVIEW_FILE_NOT_FOUND', error: 'ENOENT' }))
      .toMatchObject({ kind: 'not-found', retryable: true })
    expect(classifyPreviewIssue({ code: 'PREVIEW_UNSUPPORTED_TYPE', error: 'Unsupported' }))
      .toMatchObject({ kind: 'unsupported', retryable: false })
  })
})

describe('workspacePreviewCheckUrl', () => {
  it('adds the internal check query', () => {
    expect(workspacePreviewCheckUrl('/api/workspace/preview/project/index.html'))
      .toBe('/api/workspace/preview/project/index.html?__quickforge_check=1')
  })

  it('preserves existing queries and removes hashes', () => {
    expect(workspacePreviewCheckUrl('/api/workspace/preview/project/index.html?r=2#section'))
      .toBe('/api/workspace/preview/project/index.html?r=2&__quickforge_check=1')
  })
})
