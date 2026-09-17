import { projectContextFromId, registeredProjectContextFromId } from '../project-config.mjs'
import {
  resolveWorkspacePath,
  assertSafeWorkspacePath,
  toWorkspaceRelative,
} from '../utils/workspace.mjs'
import { sendJson, readJsonBody } from '../utils/response.mjs'
import { promises as fs } from 'node:fs'
import { logger } from '../utils/logger.mjs'
import path from 'node:path'
import { resolveModelBinding } from '../model-catalog.mjs'
import { createRequestAbortState, isAbortError } from './workspace-request-control.mjs'
import {
  listGitStatus,
  listGitBranches,
  listGitLog,
  isGitRepository,
  assertValidBranchName,
  git,
  readGitFile,
  generateGitCommitMessage,
  stageGitPath,
  stageAllGitChanges,
  unstageGitPath,
  unstageAllGitChanges,
  restoreGitPath,
  restoreAllGitChanges,
  commitGitChanges,
  pushGitBranch,
  commitAndPushGitChanges,
} from './workspace-git-service.mjs'
import {
  listWorkspaceChildren,
  searchWorkspace,
  listWorkspaceMentionChildren,
} from './workspace-browser-service.mjs'
import {
  statWorkspaceTextFile,
  languageFromPath,
  readWorkspaceTextFile,
  createWorkspacePreviewError,
  inspectWorkspacePreviewFile,
  buildPreviewEtag,
  ifNoneMatchSatisfied,
  workspacePreviewIssueFromError,
  openWorkspaceExternalPath,
} from './workspace-file-service.mjs'
export { isAbortError, createRequestAbortState } from './workspace-request-control.mjs'
export { git, listGitStatus, commitAndPushGitChanges } from './workspace-git-service.mjs'
export {
  compareWorkspaceEntries,
  listWorkspaceChildren,
  readValidatedWorkspaceSearchDirectory,
  searchWorkspace,
  listWorkspaceMentionChildren,
  searchWorkspaceMentions,
} from './workspace-browser-service.mjs'
export {
  workspacePreviewIssueFromError,
  inspectWorkspacePreviewFile,
  buildPreviewEtag,
  openWorkspaceExternalPath,
} from './workspace-file-service.mjs'

async function projectContextFromUrl(url) {
  const projectId = url.searchParams.get('projectId')
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  return projectContextFromId(projectId)
}

async function handleWorkspaceChildren(req, res, url) {
  const context = await projectContextFromUrl(url)
  sendJson(res, 200, await listWorkspaceChildren(context, url.searchParams.get('path') || '.', {
    limit: url.searchParams.get('limit'),
    cursor: url.searchParams.get('cursor') || '',
  }))
}

async function handleWorkspaceSearch(req, res, url) {
  const context = await projectContextFromUrl(url)
  // 客户端断开（req aborted / res 提前 close）时中止 rg/BFS 搜索，避免白跑
  const { signal, dispose } = createRequestAbortState(req, res)
  try {
    sendJson(res, 200, await searchWorkspace(context, url.searchParams.get('query') || '', {
      limit: url.searchParams.get('limit'),
      signal,
    }))
  } catch (error) {
    // 客户端已断开时不再写响应，静默结束
    if (isAbortError(error)) return
    throw error
  } finally {
    dispose()
  }
}

async function handleWorkspaceMentionChildren(req, res, url) {
  const projectId = url.searchParams.get('projectId')
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await registeredProjectContextFromId(projectId)
  sendJson(res, 200, await listWorkspaceMentionChildren(context, url.searchParams.get('path') || '.'))
}

async function handleWorkspaceFile(req, res, url) {
  const context = await projectContextFromUrl(url)
  const relativePath = url.searchParams.get('path') || ''
  if (!relativePath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  // meta=1：轻量元信息探测（与 preview 路由的 `__quickforge_check=1` 探测风格一致）。
  // 走同一安全校验与 stat，但绝不读取文件内容，供客户端校验本地文件缓存快照。
  if (url.searchParams.get('meta') === '1') {
    const info = await statWorkspaceTextFile(context, relativePath)
    sendJson(res, 200, {
      path: info.path,
      size: info.size,
      mtimeMs: info.mtimeMs,
      language: languageFromPath(info.path),
      readonly: true,
    })
    return
  }
  const file = await readWorkspaceTextFile(context, relativePath)
  sendJson(res, 200, {
    ...file,
    language: languageFromPath(file.path),
    readonly: true,
  })
}

async function handleWorkspacePreview(req, res, url) {
  let relativePath = ''
  try {
    const prefix = '/api/workspace/preview/'
    const tail = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
    const slashIndex = tail.indexOf('/')
    if (slashIndex <= 0) {
      throw createWorkspacePreviewError('projectId and path are required', 400, 'PREVIEW_INVALID_PATH')
    }

    const projectId = decodeURIComponent(tail.slice(0, slashIndex))
    relativePath = decodeURIComponent(tail.slice(slashIndex + 1))
    if (!projectId || !relativePath) {
      throw createWorkspacePreviewError('projectId and path are required', 400, 'PREVIEW_INVALID_PATH')
    }

    const context = await projectContextFromId(projectId)
    const preview = await inspectWorkspacePreviewFile(context, relativePath)
    const etag = buildPreviewEtag(preview.stat)
    if (url.searchParams.get('__quickforge_check') === '1') {
      sendJson(res, 200, {
        ok: true,
        path: relativePath,
        size: preview.stat.size,
        mtimeMs: preview.stat.mtimeMs,
        contentType: preview.contentType,
      })
      return
    }

    const ifNoneMatch = req.headers?.['if-none-match']
    if (typeof ifNoneMatch === 'string' && ifNoneMatchSatisfied(ifNoneMatch, etag)) {
      // 304=未变化零传输：命中协商缓存，不读文件体直接结束
      res.writeHead(304, {
        etag,
        'cache-control': 'private, no-cache',
        'x-content-type-options': 'nosniff',
      })
      res.end()
      return
    }

    // no-cache=每次协商：浏览器每次回源校验，文件变化立即生效
    res.writeHead(200, {
      'content-type': preview.contentType,
      'content-length': String(preview.stat.size),
      'cache-control': 'private, no-cache',
      etag,
      'x-content-type-options': 'nosniff',
    })
    const buffer = await fs.readFile(preview.file)
    res.end(buffer)
  } catch (error) {
    const issue = workspacePreviewIssueFromError(error, relativePath)
    if (issue.status >= 500) logger.error('Workspace preview failed', { error: issue.payload.error, path: relativePath })
    sendJson(res, issue.status, issue.payload)
  }
}

async function handleWorkspaceResolvePath(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  const inputPath = typeof body?.path === 'string' ? body.path.trim() : ''

  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  if (!inputPath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }
  if (!path.isAbsolute(inputPath)) {
    const error = new Error('Only absolute paths are supported')
    error.statusCode = 400
    throw error
  }

  const context = await projectContextFromId(projectId)
  const file = resolveWorkspacePath(inputPath, context)
  await assertSafeWorkspacePath(file, context)
  const stat = await fs.stat(file)
  if (!stat.isFile()) {
    const error = new Error('Path is not a file')
    error.statusCode = 400
    throw error
  }

  sendJson(res, 200, {
    relativePath: toWorkspaceRelative(file, context),
    exists: true,
    isDirectory: false,
  })
}

async function handleWorkspaceOpenExternal(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  sendJson(res, 200, await openWorkspaceExternalPath(context, body?.path, body?.target))
}

async function handleGitStatus(req, res, url) {
  const context = await projectContextFromUrl(url)
  // `light=1`：标题栏/分支徽标只需 branch + counts，跳过 numstat 与行数统计
  const includeFileStats = url.searchParams.get('light') !== '1'
  // 客户端断开（req aborted / res 提前 close）时中止 git 子进程，避免白跑
  const { signal, dispose } = createRequestAbortState(req, res)
  try {
    sendJson(res, 200, await listGitStatus(context, { includeFileStats, signal }))
  } catch (error) {
    // 客户端已断开时不再写响应，静默结束
    if (isAbortError(error)) return
    throw error
  } finally {
    dispose()
  }
}

async function handleGitBranches(req, res, url) {
  const context = await projectContextFromUrl(url)
  // 客户端断开（req aborted / res 提前 close）时中止 git 子进程，避免白跑
  const { signal, dispose } = createRequestAbortState(req, res)
  try {
    sendJson(res, 200, await listGitBranches(context, { signal }))
  } catch (error) {
    // 客户端已断开时不再写响应，静默结束
    if (isAbortError(error)) return
    throw error
  } finally {
    dispose()
  }
}

async function handleGitLog(req, res, url) {
  const context = await projectContextFromUrl(url)
  // 客户端断开（req aborted / res 提前 close）时中止 git 子进程，避免白跑
  const { signal, dispose } = createRequestAbortState(req, res)
  try {
    sendJson(res, 200, await listGitLog(context, { signal }))
  } catch (error) {
    // 客户端已断开时不再写响应，静默结束
    if (isAbortError(error)) return
    throw error
  } finally {
    dispose()
  }
}

async function handleGitCheckout(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  if (!(await isGitRepository(context.workspaceRoot))) {
    const error = new Error('This project is not a Git repository')
    error.statusCode = 400
    throw error
  }
  const branch = await assertValidBranchName(context.workspaceRoot, body?.branch)
  await git(['checkout', branch], context.workspaceRoot)
  sendJson(res, 200, await listGitStatus(context))
}

async function handleGitCreateBranch(req, res) {
  const body = await readJsonBody(req, 16 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  const context = await projectContextFromId(projectId)
  if (!(await isGitRepository(context.workspaceRoot))) {
    const error = new Error('This project is not a Git repository')
    error.statusCode = 400
    throw error
  }
  const branch = await assertValidBranchName(context.workspaceRoot, body?.branch)
  await git(['checkout', '-b', branch], context.workspaceRoot)
  sendJson(res, 200, await listGitStatus(context))
}

async function handleGitFileDiff(req, res, url) {
  const context = await projectContextFromUrl(url)
  const relativePath = url.searchParams.get('path') || ''
  if (!relativePath) {
    const error = new Error('path is required')
    error.statusCode = 400
    throw error
  }

  // 客户端断开（req aborted / res 提前 close）时中止 git 子进程，避免白跑；fs 读取不中止，口径同 status
  const { signal, dispose } = createRequestAbortState(req, res)
  try {
    const statusPayload = await listGitStatus(context, { signal })
    if (!statusPayload.isGitRepository) {
      const error = new Error('This project is not a Git repository')
      error.statusCode = 400
      throw error
    }
    const changedFile = statusPayload.files.find((file) => file.path === relativePath)
    if (!changedFile) {
      const error = new Error('File has no working tree changes')
      error.statusCode = 404
      throw error
    }

    const newRelativePath = changedFile.path
    const oldRelativePath = changedFile.oldPath || changedFile.path
    let oldContent = ''
    let newContent = ''

    if (changedFile.status !== 'added' && changedFile.status !== 'untracked') {
      const oldFile = resolveWorkspacePath(oldRelativePath, context)
      await assertSafeWorkspacePath(oldFile, context, { ignoreMissing: true })
      oldContent = await readGitFile(context.workspaceRoot, 'HEAD', oldRelativePath, signal)
    }
    if (changedFile.status !== 'deleted') {
      newContent = (await readWorkspaceTextFile(context, newRelativePath)).content
    }

    sendJson(res, 200, {
      path: newRelativePath,
      oldPath: changedFile.oldPath,
      status: changedFile.status,
      oldContent,
      newContent,
      language: languageFromPath(newRelativePath),
    })
  } catch (error) {
    // 客户端已断开时不再写响应，静默结束
    if (isAbortError(error)) return
    throw error
  } finally {
    dispose()
  }
}

async function contextFromGitBody(req) {
  const body = await readJsonBody(req, 1024 * 1024)
  const projectId = typeof body?.projectId === 'string' ? body.projectId : ''
  if (!projectId) {
    const error = new Error('projectId is required')
    error.statusCode = 400
    throw error
  }
  return { context: await projectContextFromId(projectId), body }
}

async function handleGitGenerateCommitMessage(req, res, requestContext = {}) {
  const { context, body } = await contextFromGitBody(req)
  const binding = await resolveModelBinding(body, { context: requestContext, legacySnapshot: body?.model })
  const message = await generateGitCommitMessage(context, binding.model, body?.thinkingLevel, Boolean(body?.includeUnstaged))
  sendJson(res, 200, { message })
}

async function handleGitStage(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await stageGitPath(context, body?.path))
}

async function handleGitStageAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await stageAllGitChanges(context))
}

async function handleGitUnstage(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await unstageGitPath(context, body?.path))
}

async function handleGitUnstageAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await unstageAllGitChanges(context))
}

async function handleGitRestore(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await restoreGitPath(context, body?.path))
}

async function handleGitRestoreAll(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await restoreAllGitChanges(context))
}

async function handleGitCommit(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await commitGitChanges(context, body?.message, Boolean(body?.includeUnstaged)))
}

async function handleGitPush(req, res) {
  const { context } = await contextFromGitBody(req)
  sendJson(res, 200, await pushGitBranch(context))
}

async function handleGitCommitAndPush(req, res) {
  const { context, body } = await contextFromGitBody(req)
  sendJson(res, 200, await commitAndPushGitChanges(context, body?.message, Boolean(body?.includeUnstaged)))
}

export async function handleWorkspaceApi(req, res, url, requestContext = {}) {
  if (req.method === 'GET' && url.pathname === '/api/workspace/children') {
    await handleWorkspaceChildren(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/search') {
    await handleWorkspaceSearch(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/mention-children') {
    await handleWorkspaceMentionChildren(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/workspace/file') {
    await handleWorkspaceFile(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/workspace/preview/')) {
    await handleWorkspacePreview(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/workspace/resolve-path') {
    await handleWorkspaceResolvePath(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/workspace/open-external') {
    if (requestContext.isLocalRequest !== true) {
      const error = new Error('Opening applications is only allowed from this computer')
      error.statusCode = 403
      throw error
    }
    await handleWorkspaceOpenExternal(req, res)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}

export async function handleGitApi(req, res, url, requestContext = {}) {
  if (req.method === 'GET' && url.pathname === '/api/git/status') {
    await handleGitStatus(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/branches') {
    await handleGitBranches(req, res, url)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/log') {
    await handleGitLog(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/checkout') {
    await handleGitCheckout(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/create-branch') {
    await handleGitCreateBranch(req, res)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/git/file-diff') {
    await handleGitFileDiff(req, res, url)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/generate-commit-message') {
    await handleGitGenerateCommitMessage(req, res, requestContext)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/stage') {
    await handleGitStage(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/stage-all') {
    await handleGitStageAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/unstage') {
    await handleGitUnstage(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/unstage-all') {
    await handleGitUnstageAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/restore') {
    await handleGitRestore(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/restore-all') {
    await handleGitRestoreAll(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/commit') {
    await handleGitCommit(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/push') {
    await handleGitPush(req, res)
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/git/commit-and-push') {
    await handleGitCommitAndPush(req, res)
    return
  }

  const error = new Error('Not found')
  error.statusCode = 404
  throw error
}
