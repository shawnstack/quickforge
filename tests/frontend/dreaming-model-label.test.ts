import { describe, expect, it } from 'vitest'
import { formatModelOptionLabel } from '../../src/components/dreaming/dreaming-data'

describe('formatModelOptionLabel', () => {
  it('appends the provider when the name does not already carry it', () => {
    expect(formatModelOptionLabel('glm-4-plus', '智谱')).toBe('glm-4-plus (智谱)')
  })

  it('does not repeat a provider that is part of the model name', () => {
    // Custom models are often named "GLM-4.6V (智谱)", which used to render as
    // "GLM-4.6V (智谱) (智谱)" in the selector.
    expect(formatModelOptionLabel('GLM-4.6V (智谱)', '智谱')).toBe('GLM-4.6V (智谱)')
    expect(formatModelOptionLabel('智谱 GLM-4.6V', '智谱')).toBe('智谱 GLM-4.6V')
  })

  it('matches the provider case-insensitively and ignores surrounding spaces', () => {
    expect(formatModelOptionLabel('  deepseek-chat (DeepSeek) ', 'deepseek')).toBe('deepseek-chat (DeepSeek)')
  })

  it('falls back to whichever side exists', () => {
    expect(formatModelOptionLabel('', '智谱')).toBe('智谱')
    expect(formatModelOptionLabel('glm-4-plus', '')).toBe('glm-4-plus')
    expect(formatModelOptionLabel(null, undefined)).toBe('')
  })
})
