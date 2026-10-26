import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Inspector 已拆分为 shell + 专用 hook/子组件：源码契约断言跟随实现迁移到对应文件。
const source = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const treeHook = readFileSync(new URL('../../src/components/workspace/useWorkspaceTree.ts', import.meta.url), 'utf8')
const readerHook = readFileSync(new URL('../../src/components/workspace/useWorkspaceReader.ts', import.meta.url), 'utf8')
const treePanel = readFileSync(new URL('../../src/components/workspace/WorkspaceTreePanel.tsx', import.meta.url), 'utf8')
const reviewPanel = readFileSync(new URL('../../src/components/workspace/WorkspaceReviewPanel.tsx', import.meta.url), 'utf8')

describe('workspace inspector on-demand source wiring', () => {
  it('renders a manual Git error retry that forces loadGitStatus', () => {
    expect(reviewPanel).toMatch(/shouldShowWorkspaceGitRetry\(gitLoadStatus\)[\s\S]*?onClick=\{\(\) => void loadGitStatus\(true\)\}/)
  })

  it('loads the tree root from Inspector open state without coupling it to Git', () => {
    expect(treeHook).toMatch(/shouldLoadWorkspaceTreeRoot\(open, workspaceTreeDirectory\(treeState, '\.'\)\.status\)[\s\S]*?void loadTreeDirectory\('\.'\)/)
  })

  it('routes search refresh and search error retry through runWorkspaceSearch', () => {
    expect(treePanel).toMatch(/workspaceRefreshTarget\(filter\) === 'search'\) void runWorkspaceSearch\(filter\)/)
    expect(treePanel).toMatch(/searchState\.status === 'error'[\s\S]*?onClick=\{\(\) => void runWorkspaceSearch\(filter\)\}/)
  })
})

describe('workspace inspector review request wiring', () => {
  it('collapses the file navigation when a review request opens a file diff', () => {
    expect(source).toMatch(/if \(request\.path\) \{[\s\S]*?openDiffTabRef\.current\?\.\(request\.path, false\)[\s\S]*?setReaderNavigationVisible\(false\)[\s\S]*?\}/)
  })
})

describe('workspace inspector cache wiring', () => {
  it('seeds and writes the directory cache inside loadTreeDirectory', () => {
    expect(treeHook).toMatch(/readWorkspaceDirectoryCache\(resolveServerCacheKey\(\), projectId, directoryPath\)/)
    expect(treeHook).toMatch(/isWorkspaceDirectoryCacheFresh\(cached\)/)
    expect(treeHook).toMatch(/writeWorkspaceDirectoryCache\(resolveServerCacheKey\(\), projectId, directoryPath,/)
  })

  it('reads the file cache and validates it against the meta endpoint', () => {
    expect(readerHook).toMatch(/readWorkspaceFileCache\(serverKey, projectId,/)
    expect(readerHook).toMatch(/getWorkspaceFileMeta\(projectId,/)
    expect(readerHook).toMatch(/workspaceFileMatchesMeta\(cached, meta\)/)
    expect(readerHook).toMatch(/writeWorkspaceFileCache\(serverKey, projectId, file\)/)
  })

  it('restores and persists expanded directory paths', () => {
    expect(treeHook).toMatch(/readWorkspaceExpandedCache\(resolveServerCacheKey\(\), projectId\)/)
    expect(treeHook).toMatch(/writeWorkspaceExpandedCache\(resolveServerCacheKey\(\), projectId, \[\.\.\.next\]\)/)
  })
})
