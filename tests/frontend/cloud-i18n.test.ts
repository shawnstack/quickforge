import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CloudClientError } from '../../src/lib/cloud-client'

vi.mock('../../src/lib/i18n', () => ({
  getAppLanguage: () => 'zh',
  t: (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      key,
    )
  },
}))

import { cloudErrorMessage } from '../../src/lib/cloud-error-message'

const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const emptyStateSource = readFileSync(new URL('../../src/components/chat/ModelSetupEmptyState.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

describe('QuickForge Cloud internationalization', () => {
  it('defines critical Cloud copy in English and Chinese', () => {
    expect(i18nSource.match(/cloudConnecting:/g)).toHaveLength(2)
    expect(i18nSource).toContain("cloudConnecting: 'Connecting…'")
    expect(i18nSource).toContain("cloudConnecting: '正在连接…'")
    expect(i18nSource).toContain("cloudConnectionFailed: 'Failed to connect to QuickForge Cloud.'")
    expect(i18nSource).toContain("cloudConnectionFailed: '无法连接 QuickForge Cloud。'")
    expect(i18nSource).toContain("cloudIdentityRebuiltUrlSaveFailed: 'The cloud identity was rebuilt, but the new Cloud API URL was not saved. The previous saved URL is still active; review the URL above and retry saving.'")
    expect(i18nSource).toContain("cloudIdentityRebuiltUrlSaveFailed: '云身份已重建，但新的 Cloud API 地址保存失败。之前保存的地址仍然有效，请检查上方地址后重试保存。'")
    expect(i18nSource).toContain("cloudUsageLoadFailed: 'Failed to load cloud usage. Retry to refresh the quota.'")
    expect(i18nSource).toContain("cloudUsageLoadFailed: '加载云额度失败，请重试刷新额度。'")
    expect(i18nSource).toContain("cloudModelsLoadFailed: 'Failed to load the cloud model catalog. Retry to refresh it.'")
    expect(i18nSource).toContain("cloudModelsLoadFailed: '加载云模型目录失败，请重试刷新。'")
    expect(i18nSource).toContain("cloudDevicesLoadFailed: 'Failed to load connected devices. Retry to refresh them.'")
    expect(i18nSource).toContain("cloudDevicesLoadFailed: '加载已连接设备失败，请重试刷新。'")
    expect(i18nSource).toContain("cloudUrl: 'Cloud API URL'")
    expect(i18nSource).toContain("cloudUrl: 'Cloud API 地址'")
  })

  it('uses translation keys for the first Cloud experience flow', () => {
    expect(emptyStateSource).toContain("guestStarting ? t('cloudConnecting') : t('cloudTryModels')")
    expect(appSource).toContain("title: t('cloudStartGuestTitle')")
    expect(appSource).toContain("description: t('cloudDataConsentDescription')")
    expect(appSource).toContain("confirmLabel: t('cloudAgreeAndStart')")
  })

  it('keeps product and technical terms while avoiding mixed Chinese UI terms', () => {
    expect(i18nSource).toContain("cloudAccount: 'QuickForge Cloud'")
    expect(i18nSource).toContain('API Key')
    expect(i18nSource).not.toMatch(/Cloud Session|Cloud 身份|Cloud 模型目录|上游 Provider|或 Key/)
  })

  it('localizes stable Cloud error codes instead of displaying server text', () => {
    const error = new CloudClientError('A QuickForge Cloud session is active.', {
      status: 409,
      code: 'cloud_session_active',
    })

    expect(cloudErrorMessage(error)).toBe('cloudSessionActiveGuidance')
  })
})
