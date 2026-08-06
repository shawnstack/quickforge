import { CloudClientError } from './cloud-client'
import { getAppLanguage, t } from './i18n'

export type CloudErrorFallback = 'cloudLoadFailed' | 'cloudConnectionFailed' | 'cloudRequestFailed'

export function cloudErrorMessage(error: unknown, fallback: CloudErrorFallback = 'cloudRequestFailed') {
  if (!(error instanceof CloudClientError)) return t(fallback)
  if (error.code === 'cloud_session_active') return t('cloudSessionActiveGuidance')
  if (error.code === 'cloud_local_only') return t('cloudLocalOnlyError')
  if (error.code === 'cloud_configuration_error' || error.code === 'cloud_not_configured') return t('cloudConfigurationError')
  if (error.code === 'cloud_session_service_mismatch') return t('cloudSessionServiceMismatch')
  if (['expired_token', 'device_code_expired', 'expired'].includes(error.code)) return t('cloudDeviceFlowExpiredError')
  if (['access_denied', 'authorization_declined', 'denied'].includes(error.code)) return t('cloudDeviceFlowDeniedError')
  if (['refresh_token_reused', 'installation_revoked', 'invalid_refresh_token', 'cloud_not_connected'].includes(error.code)) {
    return t('cloudSessionExpired')
  }
  if (getAppLanguage() === 'en' && error.message.trim()) return error.message
  return error.status > 0 ? t('cloudRequestFailedWithStatus', { status: error.status }) : t(fallback)
}
