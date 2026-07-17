import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all'
import { resolveOpenRouterConfig } from './provider-config.mjs'
import { deleteSessionAsset, writeSessionAsset } from './session-assets.mjs'

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image'
export const MAX_GENERATED_IMAGES = 4
export const MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024

function requestError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function normalizeBucket(value) {
  if (value?.scope === 'project') return { scope: 'project', projectId: value.projectId }
  return { scope: 'global' }
}

function resolveImagesModels(runtime) {
  const candidate = runtime.imagesModels
  if (candidate && typeof candidate.getModel === 'function') return candidate
  if (typeof candidate === 'function') return candidate()
  return builtinImagesModels()
}

function imageByteLength(data) {
  const normalized = typeof data === 'string' ? data.replace(/\s+/g, '') : ''
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw requestError('Image provider returned invalid base64 data')
  }
  const buffer = Buffer.from(normalized, 'base64')
  if (buffer.toString('base64') !== normalized) {
    throw requestError('Image provider returned invalid base64 data')
  }
  return buffer.byteLength
}

function resultText(output) {
  return output
    .filter((item) => item?.type === 'text' && typeof item.text === 'string' && item.text.trim())
    .map((item) => item.text.trim())
    .join('\n\n')
}

function contentSummary(count, text) {
  const generated = `Generated ${count} image${count === 1 ? '' : 's'}.`
  return text ? `${generated}\n\n${text}` : generated
}

export async function generateSessionImages(params, context = {}, runtime = {}) {
  const prompt = typeof params?.prompt === 'string' ? params.prompt.trim() : ''
  if (!prompt) throw requestError('prompt is required')

  const sessionId = typeof context.sessionId === 'string' ? context.sessionId : params?.sessionId
  if (!sessionId) throw requestError('sessionId is required')
  const bucket = normalizeBucket(context.bucket || context.sessionBucket || params?.bucket || {
    scope: context.scope,
    projectId: context.projectId,
  })
  const requestedModel = typeof params?.model === 'string' && params.model.trim()
    ? params.model.trim()
    : DEFAULT_IMAGE_MODEL

  const imagesModels = resolveImagesModels(runtime)
  const model = imagesModels.getModel('openrouter', requestedModel)
  if (!model || model.api !== 'openrouter-images') {
    throw requestError(`Unsupported image model: ${requestedModel}`)
  }

  const resolveConfig = runtime.resolveOpenRouterConfig || resolveOpenRouterConfig
  const config = await resolveConfig(runtime)
  const requestModel = config.baseUrl ? { ...model, baseUrl: config.baseUrl } : model
  const response = await imagesModels.generateImages(
    requestModel,
    { input: [{ type: 'text', text: prompt }] },
    {
      apiKey: config.apiKey,
      ...(config.headers ? { headers: config.headers } : {}),
      ...(runtime.signal || context.signal ? { signal: runtime.signal || context.signal } : {}),
    },
  )

  if (response?.stopReason !== 'stop') {
    throw new Error(response?.errorMessage || `Image generation stopped: ${response?.stopReason || 'unknown'}`)
  }

  const output = Array.isArray(response.output) ? response.output : []
  const images = output.filter((item) => item?.type === 'image')
  if (!images.length) throw new Error('Image generation returned no images')
  if (images.length > MAX_GENERATED_IMAGES) {
    throw requestError(`Image generation returned more than ${MAX_GENERATED_IMAGES} images`, 413)
  }

  let totalBytes = 0
  for (const image of images) {
    totalBytes += imageByteLength(image.data)
    if (totalBytes > MAX_GENERATED_IMAGE_BYTES) {
      throw requestError(`Generated images exceed the ${MAX_GENERATED_IMAGE_BYTES} byte limit`, 413)
    }
  }

  const writeAsset = runtime.writeSessionAsset || writeSessionAsset
  const deleteAsset = runtime.deleteSessionAsset || deleteSessionAsset
  const assets = []
  try {
    for (const image of images) {
      assets.push(await writeAsset(bucket, sessionId, image))
    }
  } catch (error) {
    await Promise.allSettled(assets.map((asset) => deleteAsset(bucket, sessionId, asset.assetId)))
    throw error
  }

  const text = resultText(output)
  return {
    content: contentSummary(assets.length, text),
    details: {
      type: 'generated_image_result',
      sessionId,
      prompt,
      model: requestedModel,
      assets,
      text,
      usage: response.usage,
    },
  }
}

export const generateImages = generateSessionImages
