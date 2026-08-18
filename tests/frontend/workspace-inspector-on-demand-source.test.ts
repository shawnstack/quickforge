import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')

describe('workspace inspector on-demand source wiring', () => {
  it('renders a manual Git error retry that forces loadGitStatus', () => {
    expect(source).toMatch(/shouldShowWorkspaceGitRetry\(gitLoadStatus\)[\s\S]*?onClick=\{\(\) => void loadGitStatus\(true\)\}/)
  })

  it('loads the tree root from Inspector open state without coupling it to Git', () => {
    expect(source).toMatch(/shouldLoadWorkspaceTreeRoot\(open, workspaceTreeDirectory\(treeState, '\.'\)\.status\)[\s\S]*?void loadTreeDirectory\('\.'\)/)
  })

  it('routes search refresh and search error retry through runWorkspaceSearch', () => {
    expect(source).toMatch(/workspaceRefreshTarget\(filter\) === 'search'\) void runWorkspaceSearch\(filter\)/)
    expect(source).toMatch(/searchState\.status === 'error'[\s\S]*?onClick=\{\(\) => void runWorkspaceSearch\(filter\)\}/)
  })
})

describe('workspace inspector cache wiring', () => {
  it('seeds and writes the directory cache inside loadTreeDirectory', () => {
    expect(source).toMatch(/readWorkspaceDirectoryCache\(resolveServerCacheKey\(\), projectId, directoryPath\)/)
    expect(source).toMatch(/isWorkspaceDirectoryCacheFresh\(cached\)/)
    expect(source).toMatch(/writeWorkspaceDirectoryCache\(resolveServerCacheKey\(\), projectId, directoryPath,/)
  })

  it('reads the file cache and validates it against the meta endpoint', () => {
    expect(source).toMatch(/readWorkspaceFileCache\(serverKey, projectId,/)
    expect(source).toMatch(/getWorkspaceFileMeta\(projectId,/)
    expect(source).toMatch(/workspaceFileMatchesMeta\(cached, meta\)/)
    expect(source).toMatch(/writeWorkspaceFileCache\(serverKey, projectId, file\)/)
  })

  it('restores and persists expanded directory paths', () => {
    expect(source).toMatch(/readWorkspaceExpandedCache\(resolveServerCacheKey\(\), projectId\)/)
    expect(source).toMatch(/writeWorkspaceExpandedCache\(resolveServerCacheKey\(\), projectId, \[\.\.\.next\]\)/)
  })
})
