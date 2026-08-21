import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  setWorkspaceRoot,
  getWorkspaceRoot,
  getToolWorkspaceRoot,
  createWorkspacePathValidator,
  isInside,
  resolveWorkspacePath,
  toWorkspaceRelative,
  isSensitiveWorkspacePath,
  truncateText,
  splitLines,
  shouldSkipSearchDir,
  shouldSearchFile,
} from '../../../server/utils/workspace.mjs'

// path.resolve is platform-aware; use it to build expected values.
const r = (p) => path.resolve(p)

describe('workspace', () => {
  beforeEach(() => {
    setWorkspaceRoot('/test/project')
  })

  describe('setWorkspaceRoot / getWorkspaceRoot', () => {
    it('stores the workspace root as an absolute path', () => {
      setWorkspaceRoot('relative/path')
      expect(getWorkspaceRoot()).toBeTruthy()
      expect(path.isAbsolute(getWorkspaceRoot())).toBe(true)
    })

    it('overwrites previous value', () => {
      setWorkspaceRoot('/first')
      expect(getWorkspaceRoot()).toBe(r('/first'))
      setWorkspaceRoot('/second')
      expect(getWorkspaceRoot()).toBe(r('/second'))
    })
  })

  describe('getToolWorkspaceRoot', () => {
    it('returns context.workspaceRoot when provided', () => {
      expect(getToolWorkspaceRoot({ workspaceRoot: '/ctx/path' })).toBe('/ctx/path')
    })

    it('falls back to getWorkspaceRoot', () => {
      expect(getToolWorkspaceRoot()).toBe(r('/test/project'))
    })

    it('falls back when context has no workspaceRoot', () => {
      expect(getToolWorkspaceRoot({})).toBe(r('/test/project'))
    })
  })

  describe('createWorkspacePathValidator', () => {
    it('reuses a safe root while validating files inside the workspace', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-workspace-validator-'))
      try {
        const file = path.join(workspaceRoot, 'file.txt')
        await fs.writeFile(file, 'ok')
        const validateWorkspacePath = await createWorkspacePathValidator({ workspaceRoot })
        await expect(validateWorkspacePath(file)).resolves.toBeUndefined()
      } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true })
      }
    })

    it('rejects targets that resolve outside the workspace', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-workspace-root-'))
      const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-workspace-outside-'))
      try {
        const outsideFile = path.join(outsideRoot, 'outside.txt')
        const link = path.join(workspaceRoot, 'outside-link')
        await fs.writeFile(outsideFile, 'outside')
        await fs.symlink(outsideRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
        const validateWorkspacePath = await createWorkspacePathValidator({ workspaceRoot })
        await expect(validateWorkspacePath(path.join(link, 'outside.txt'))).rejects.toMatchObject({ statusCode: 403 })
      } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true })
        await fs.rm(outsideRoot, { recursive: true, force: true })
      }
    })

    it('rejects a safe-looking symlink whose real target is sensitive unless explicitly allowed', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-workspace-sensitive-link-'))
      try {
        const sensitive = path.join(workspaceRoot, '.ENV.LOCAL')
        const link = path.join(workspaceRoot, 'safe-name.txt')
        await fs.writeFile(sensitive, 'secret')
        try {
          await fs.symlink(sensitive, link, 'file')
        } catch (error) {
          if (error?.code === 'EPERM' || error?.code === 'EACCES') return
          throw error
        }
        const validateWorkspacePath = await createWorkspacePathValidator({ workspaceRoot })
        await expect(validateWorkspacePath(link)).rejects.toMatchObject({ statusCode: 403, errorCode: 'WORKSPACE_SENSITIVE_PATH' })
        await expect(validateWorkspacePath(link, { allowSensitive: true })).resolves.toBeUndefined()
      } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true })
      }
    })
  })

  describe('isInside', () => {
    it('returns true when child is inside parent', () => {
      expect(isInside('/parent', '/parent/child')).toBe(true)
    })

    it('returns true when child equals parent', () => {
      expect(isInside('/same', '/same')).toBe(true)
    })

    it('returns false when child is outside parent', () => {
      expect(isInside('/parent', '/other/child')).toBe(false)
    })

    it('returns false when child is a parent of parent', () => {
      expect(isInside('/parent/child', '/parent')).toBe(false)
    })
  })

  describe('resolveWorkspacePath', () => {
    it('resolves a relative path against the workspace root', () => {
      const result = resolveWorkspacePath('src/index.ts')
      expect(result).toMatch(/src[\\/]index\.ts$/)
    })

    it('resolves "." to workspace root', () => {
      const result = resolveWorkspacePath('.')
      expect(result).toBe(r('/test/project'))
    })

    it('uses context.workspaceRoot when provided', () => {
      const result = resolveWorkspacePath('file.txt', { workspaceRoot: '/custom' })
      expect(result).toMatch(/custom[\\/]file\.txt$/)
    })

    it('throws 403 for path traversal attempts', () => {
      expect(() => resolveWorkspacePath('../../etc/passwd')).toThrow('Path is outside the selected project')
      try {
        resolveWorkspacePath('../../etc/passwd')
      } catch (error) {
        expect(error.statusCode).toBe(403)
      }
    })

    it('accepts absolute paths inside workspace', () => {
      const result = resolveWorkspacePath('/test/project/lib/file.js')
      expect(result).toBe(r('/test/project/lib/file.js'))
    })

    it('rejects absolute paths outside workspace', () => {
      expect(() => resolveWorkspacePath('/etc/passwd')).toThrow('Path is outside the selected project')
    })
  })

  describe('toWorkspaceRelative', () => {
    it('converts absolute path to relative', () => {
      expect(toWorkspaceRelative('/test/project/src/index.ts')).toBe('src/index.ts')
    })

    it('returns "." for workspace root itself', () => {
      expect(toWorkspaceRelative('/test/project')).toBe('.')
    })

    it('uses context workspace root', () => {
      expect(toWorkspaceRelative('/custom/file.txt', { workspaceRoot: '/custom' })).toBe('file.txt')
    })

    it('normalizes backslashes to forward slashes', () => {
      // On Windows-style paths, result should use forward slashes
      const result = toWorkspaceRelative('/test/project/a\\b\\c')
      // path.relative on posix will not produce backslashes, but test the function's replace
      expect(result).not.toContain('\\')
    })
  })

  describe('isSensitiveWorkspacePath', () => {
    it('flags .git directory as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/.git/config')).toBe(true)
    })

    it('flags .env files as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/.env')).toBe(true)
    })

    it('flags .env.* files as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/.env.local')).toBe(true)
    })

    it('flags .pem files as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/cert.pem')).toBe(true)
    })

    it('flags .key files as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/server.key')).toBe(true)
    })

    it('flags credentials.json as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/credentials.json')).toBe(true)
    })

    it('flags secrets.json as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/secrets.json')).toBe(true)
    })

    it('flags id_rsa as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/id_rsa')).toBe(true)
    })

    it('flags id_ed25519 as sensitive', () => {
      expect(isSensitiveWorkspacePath('/test/project/id_ed25519')).toBe(true)
    })

    it('matches sensitive names case-insensitively', () => {
      expect(isSensitiveWorkspacePath('/test/project/.GIT/config')).toBe(true)
      expect(isSensitiveWorkspacePath('/test/project/.ENV.LOCAL')).toBe(true)
      expect(isSensitiveWorkspacePath('/test/project/CREDENTIALS.JSON')).toBe(true)
      expect(isSensitiveWorkspacePath('/test/project/SERVER.KEY')).toBe(true)
    })

    it('does not flag normal files', () => {
      expect(isSensitiveWorkspacePath('/test/project/src/index.ts')).toBe(false)
    })

    it('does not flag package.json', () => {
      expect(isSensitiveWorkspacePath('/test/project/package.json')).toBe(false)
    })
  })

  describe('truncateText', () => {
    it('returns text unchanged when within limit', () => {
      expect(truncateText('hello', 100)).toBe('hello')
    })

    it('truncates and appends notice when over limit', () => {
      const text = 'a'.repeat(200)
      const result = truncateText(text, 100)
      expect(result.length).toBeLessThan(text.length)
      expect(result).toContain('[truncated')
    })

    it('uses default maxChars of 50000', () => {
      const text = 'x'.repeat(50001)
      const result = truncateText(text)
      expect(result).toContain('[truncated')
    })

    it('exact boundary — text at maxChars is not truncated', () => {
      const text = 'a'.repeat(50)
      expect(truncateText(text, 50)).toBe(text)
    })
  })

  describe('splitLines', () => {
    it('splits on \\n', () => {
      expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
    })

    it('splits on \\r\\n', () => {
      expect(splitLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
    })

    it('handles mixed line endings', () => {
      expect(splitLines('a\nb\r\nc')).toEqual(['a', 'b', 'c'])
    })

    it('returns single-element array for no newlines', () => {
      expect(splitLines('single')).toEqual(['single'])
    })

    it('handles empty string', () => {
      expect(splitLines('')).toEqual([''])
    })
  })

  describe('shouldSkipSearchDir', () => {
    it('skips .git', () => {
      expect(shouldSkipSearchDir('.git')).toBe(true)
    })

    it('skips node_modules', () => {
      expect(shouldSkipSearchDir('node_modules')).toBe(true)
    })

    it('skips dist', () => {
      expect(shouldSkipSearchDir('dist')).toBe(true)
    })

    it('does not skip src', () => {
      expect(shouldSkipSearchDir('src')).toBe(false)
    })
  })

  describe('shouldSearchFile', () => {
    it('searches .ts files', () => {
      expect(shouldSearchFile('index.ts')).toBe(true)
    })

    it('searches .js files', () => {
      expect(shouldSearchFile('app.js')).toBe(true)
    })

    it('skips .png files', () => {
      expect(shouldSearchFile('image.png')).toBe(false)
    })

    it('skips .exe files', () => {
      expect(shouldSearchFile('setup.exe')).toBe(false)
    })

    it('skips .zip files', () => {
      expect(shouldSearchFile('archive.zip')).toBe(false)
    })

    it('case-insensitive extension check', () => {
      expect(shouldSearchFile('photo.PNG')).toBe(false)
      expect(shouldSearchFile('photo.JpG')).toBe(false)
    })
  })
})
