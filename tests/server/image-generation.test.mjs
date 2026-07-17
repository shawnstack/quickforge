import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDirs = []

async function withTempModules(testFn) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-image-test-'))
  tempDirs.push(tmpDir)
  const previous = process.env.QUICKFORGE_DATA_DIR
  process.env.QUICKFORGE_DATA_DIR = tmpDir
  vi.resetModules()
  try {
    const assets = await import('../../server/session-assets.mjs')
    const storage = await import('../../server/storage.mjs')
    const providers = await import('../../server/provider-config.mjs')
    const generation = await import('../../server/image-generation.mjs')
    await testFn({ assets, storage, providers, generation, tmpDir })
  } finally {
    if (previous === undefined) delete process.env.QUICKFORGE_DATA_DIR
    else process.env.QUICKFORGE_DATA_DIR = previous
    vi.resetModules()
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function fakeImageModels(response, modelId = 'google/gemini-2.5-flash-image') {
  const model = {
    id: modelId,
    provider: 'openrouter',
    api: 'openrouter-images',
    baseUrl: 'https://openrouter.ai/api/v1',
  }
  return {
    getModel: vi.fn((provider, id) => provider === 'openrouter' && id === modelId ? model : undefined),
    generateImages: vi.fn(async () => response),
  }
}

function successfulResponse(output, usage) {
  return {
    output,
    usage,
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

describe('session image assets', () => {
  it('safely writes, reads, and deletes global and project session assets', async () => {
    await withTempModules(async ({ assets, tmpDir }) => {
      const bytes = Buffer.from('small png')
      const globalAsset = await assets.writeSessionAsset(
        { scope: 'global' },
        'session-1',
        { mimeType: 'image/png', data: bytes.toString('base64') },
      )
      expect(globalAsset).toMatchObject({ mimeType: 'image/png', size: bytes.length })
      expect(globalAsset.assetId).toMatch(/^[0-9a-f-]+\.png$/)
      expect(JSON.stringify(globalAsset)).not.toContain(tmpDir)

      const stored = await assets.readSessionAsset({ scope: 'global' }, 'session-1', globalAsset.assetId)
      expect({ assetId: stored.assetId, mimeType: stored.mimeType, size: stored.size }).toEqual(globalAsset)
      expect(stored.data).toEqual(bytes)

      const projectAsset = await assets.writeSessionAsset(
        { scope: 'project', projectId: 'project_a' },
        'session-2',
        { mimeType: 'image/jpeg', data: Buffer.from('jpeg') },
      )
      expect(await fs.readFile(path.join(
        tmpDir,
        'storage',
        'conversations',
        'projects',
        'project_a',
        'assets',
        'session-2',
        projectAsset.assetId,
      ), 'utf8')).toBe('jpeg')

      await assets.deleteSessionAssets({ scope: 'global' }, 'session-1')
      await expect(assets.readSessionAsset({ scope: 'global' }, 'session-1', globalAsset.assetId)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('rejects unsafe paths, illegal MIME types, invalid asset IDs, and oversized images', async () => {
    await withTempModules(async ({ assets }) => {
      await expect(assets.writeSessionAsset(
        { scope: 'project', projectId: '../outside' },
        'session',
        { mimeType: 'image/png', data: 'YQ==' },
      )).rejects.toThrow('Invalid projectId')
      await expect(assets.writeSessionAsset(
        { scope: 'global' },
        '../session',
        { mimeType: 'image/png', data: 'YQ==' },
      )).rejects.toThrow('Invalid sessionId')
      await expect(assets.writeSessionAsset(
        { scope: 'global' },
        'session',
        { mimeType: 'image/svg+xml', data: 'YQ==' },
      )).rejects.toThrow('Unsupported image MIME type')
      await expect(assets.readSessionAsset(
        { scope: 'global' },
        'session',
        '../../secret.png',
      )).rejects.toThrow('Invalid assetId')
      await expect(assets.writeSessionAsset(
        { scope: 'global' },
        'session',
        { mimeType: 'image/webp', data: Buffer.alloc(assets.MAX_SESSION_IMAGE_BYTES + 1) },
      )).rejects.toMatchObject({ statusCode: 413 })
    })
  })
})

describe('OpenRouter provider config', () => {
  it('matches OpenRouter by host and resolves provider-name and case-insensitive keys', async () => {
    await withTempModules(async ({ storage, providers }) => {
      await storage.writeStore('custom-providers', {
        custom: {
          id: 'custom-router',
          name: 'My OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1/',
          models: [{ headers: { 'HTTP-Referer': 'https://quickforge.test', Empty: 3 } }],
        },
      })
      await storage.writeStore('provider-keys', { 'My OpenRouter': 'secret-one' })

      await expect(providers.resolveOpenRouterConfig()).resolves.toEqual({
        apiKey: 'secret-one',
        baseUrl: 'https://openrouter.ai/api/v1',
        headers: { 'HTTP-Referer': 'https://quickforge.test' },
      })

      await storage.writeStore('provider-keys', { OPENROUTER: 'secret-two' })
      await expect(providers.resolveOpenRouterConfig()).resolves.toMatchObject({ apiKey: 'secret-two' })
    })
  })
})

describe('image generation', () => {
  it('generates images with an allowed built-in model and returns asset-only details', async () => {
    await withTempModules(async ({ assets, generation }) => {
      const imageData = Buffer.from('generated png').toString('base64')
      const usage = { input: 10, output: 20, totalTokens: 30 }
      const imagesModels = fakeImageModels(successfulResponse([
        { type: 'text', text: 'A polished result.' },
        { type: 'image', mimeType: 'image/png', data: imageData },
      ], usage))
      const resolveOpenRouterConfig = vi.fn(async () => ({
        apiKey: 'should-never-be-returned',
        baseUrl: 'https://openrouter.ai/api/v1',
        headers: { 'X-Test': 'yes' },
      }))

      const result = await generation.generateSessionImages(
        { prompt: 'draw a lighthouse' },
        { sessionId: 'session-gen', bucket: { scope: 'global' } },
        { imagesModels, resolveOpenRouterConfig },
      )

      expect(result.content).toContain('Generated 1 image.')
      expect(result.details).toMatchObject({
        type: 'generated_image_result',
        sessionId: 'session-gen',
        prompt: 'draw a lighthouse',
        model: generation.DEFAULT_IMAGE_MODEL,
        text: 'A polished result.',
        usage,
      })
      expect(result.details.assets).toHaveLength(1)
      expect(JSON.stringify(result.details)).not.toContain(imageData)
      expect(JSON.stringify(result.details)).not.toContain('should-never-be-returned')
      expect(JSON.stringify(result.details)).not.toMatch(/[A-Z]:\\|\/storage\//)

      const stored = await assets.readSessionAsset(
        { scope: 'global' },
        'session-gen',
        result.details.assets[0].assetId,
      )
      expect(stored.data.toString()).toBe('generated png')
      expect(imagesModels.generateImages).toHaveBeenCalledWith(
        expect.objectContaining({ id: generation.DEFAULT_IMAGE_MODEL }),
        { input: [{ type: 'text', text: 'draw a lighthouse' }] },
        expect.objectContaining({ apiKey: 'should-never-be-returned', headers: { 'X-Test': 'yes' } }),
      )
    })
  })

  it('rejects unknown models, provider errors, no-image responses, illegal MIME, and oversized output', async () => {
    await withTempModules(async ({ assets, generation }) => {
      const config = async () => ({ apiKey: 'key' })
      await expect(generation.generateSessionImages(
        { prompt: 'x', model: 'not/in-catalog' },
        { sessionId: 's1' },
        { imagesModels: fakeImageModels(successfulResponse([])), resolveOpenRouterConfig: config },
      )).rejects.toThrow('Unsupported image model')

      await expect(generation.generateSessionImages(
        { prompt: 'x' },
        { sessionId: 's2' },
        { imagesModels: fakeImageModels({ stopReason: 'error', errorMessage: 'provider failed', output: [] }), resolveOpenRouterConfig: config },
      )).rejects.toThrow('provider failed')

      await expect(generation.generateSessionImages(
        { prompt: 'x' },
        { sessionId: 's3' },
        { imagesModels: fakeImageModels(successfulResponse([{ type: 'text', text: 'only text' }])), resolveOpenRouterConfig: config },
      )).rejects.toThrow('returned no images')

      await expect(generation.generateSessionImages(
        { prompt: 'x' },
        { sessionId: 's4' },
        { imagesModels: fakeImageModels(successfulResponse([{ type: 'image', mimeType: 'image/svg+xml', data: 'YQ==' }])), resolveOpenRouterConfig: config },
      )).rejects.toThrow('Unsupported image MIME type')

      const tooLarge = Buffer.alloc(generation.MAX_GENERATED_IMAGE_BYTES + 1).toString('base64')
      await expect(generation.generateSessionImages(
        { prompt: 'x' },
        { sessionId: 's5' },
        { imagesModels: fakeImageModels(successfulResponse([{ type: 'image', mimeType: 'image/png', data: tooLarge }])), resolveOpenRouterConfig: config },
      )).rejects.toMatchObject({ statusCode: 413 })

      await expect(fs.readdir(path.join(
        process.env.QUICKFORGE_DATA_DIR,
        'storage',
        'conversations',
        'global',
        'assets',
        's4',
      ))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(assets.MAX_SESSION_IMAGE_BYTES).toBe(25 * 1024 * 1024)
    })
  })

  it('cleans up assets already written when a later write fails', async () => {
    await withTempModules(async ({ assets, generation }) => {
      const png = Buffer.from('first').toString('base64')
      const imagesModels = fakeImageModels(successfulResponse([
        { type: 'image', mimeType: 'image/png', data: png },
        { type: 'image', mimeType: 'image/svg+xml', data: png },
      ]))

      await expect(generation.generateSessionImages(
        { prompt: 'two images' },
        { sessionId: 'cleanup-session', bucket: { scope: 'global' } },
        { imagesModels, resolveOpenRouterConfig: async () => ({ apiKey: 'key' }) },
      )).rejects.toThrow('Unsupported image MIME type')

      await expect(fs.readdir(path.join(
        process.env.QUICKFORGE_DATA_DIR,
        'storage',
        'conversations',
        'global',
        'assets',
        'cleanup-session',
      ))).resolves.toEqual([])
      await assets.deleteSessionAssets({ scope: 'global' }, 'cleanup-session')
    })
  })
})
