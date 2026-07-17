import { describe, expect, it } from 'vitest'
import { generatedImageAssetUrl, parseGeneratedImageDetails } from '../../src/lib/generated-image-assets'

const details = {
  type: 'generated_image_result',
  sessionId: 'session-1',
  prompt: 'draw a lighthouse',
  model: 'google/gemini-2.5-flash-image',
  assets: [{
    assetId: '123e4567-e89b-42d3-a456-426614174000.png',
    mimeType: 'image/png',
    size: 123,
  }],
}

describe('generated image assets', () => {
  it('parses only controlled generated-image metadata', () => {
    expect(parseGeneratedImageDetails(details)).toEqual(details)
    expect(parseGeneratedImageDetails({ ...details, assets: [{ ...details.assets[0], assetId: '../bad.png' }] })).toBeNull()
    expect(parseGeneratedImageDetails({ ...details, assets: [{ ...details.assets[0], mimeType: 'image/svg+xml' }] })).toBeNull()
  })

  it('builds local and shared same-origin asset URLs', () => {
    const parsed = parseGeneratedImageDetails(details)!
    expect(generatedImageAssetUrl(parsed, parsed.assets[0], '/')).toBe(
      '/api/session-assets/session-1/123e4567-e89b-42d3-a456-426614174000.png',
    )
    expect(generatedImageAssetUrl(parsed, parsed.assets[0], '/share/share-id')).toBe(
      '/api/shared/share-id/assets/123e4567-e89b-42d3-a456-426614174000.png',
    )
  })
})
