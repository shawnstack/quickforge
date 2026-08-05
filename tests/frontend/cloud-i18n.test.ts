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
