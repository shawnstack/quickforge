import { describe, expect, it } from 'vitest'
import { isManagedQuickForgeCloudModel } from '../../src/lib/managed-cloud-model'

describe('managed QuickForge Cloud model detection', () => {
  it('accepts only server-managed QuickForge Cloud models', () => {
    expect(isManagedQuickForgeCloudModel({
      provider: 'quickforge-cloud',
      quickforgeModelSource: 'cloud',
    })).toBe(true)
  })

  it('does not bypass key checks for provider-name-only or ordinary models', () => {
    expect(isManagedQuickForgeCloudModel({ provider: 'quickforge-cloud' })).toBe(false)
    expect(isManagedQuickForgeCloudModel({
      provider: 'openai',
      quickforgeModelSource: 'cloud',
    })).toBe(false)
    expect(isManagedQuickForgeCloudModel(null)).toBe(false)
  })
})
