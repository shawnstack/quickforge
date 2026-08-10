import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * 云 API 默认地址。登录页可临时修改 baseURL（仅内存，不持久化）。
 * 直连模式：原生平台走 CapacitorHttp（原生请求绕 CORS），Web 降级 fetch。
 */
export const CLOUD_API_DEFAULT_BASE_URL = 'http://42.194.187.88:8080'

/** 手机端 OAuth Device Flow 常量（与云侧 clientId/platform 白名单对齐）。 */
export const CLOUD_MOBILE_CLIENT_ID = 'quickforge-mobile'
export const CLOUD_MOBILE_CLIENT_VERSION = '1.0.0'
export const CLOUD_MOBILE_INSTALLATION_NAME = '手机 (Android)'
export const CLOUD_MOBILE_PLATFORM = 'android'

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REFRESH_GRANT_TYPE = 'refresh_token'
const DEVICE_FLOW_DEFAULT_INTERVAL = 5
const DEVICE_FLOW_MAX_INTERVAL = 60
const DEVICE_FLOW_MAX_WAIT_MS = 10 * 60 * 1000 // 授权默认有效期 600s，超时停止轮询

/** 云账户信息（GET /v1/me；login/register 响应中的 account 部分）。 */
export type Account = {
  id: string
  email: string
  mode?: string
  plan?: string
  [key: string]: unknown
}

/**
 * 登录/注册结果。云侧现状：POST /v1/accounts/login|register 仅确认设备授权并返回账号信息
 * （无令牌），令牌由 device flow 发起方经 /oauth/token 兑换，故 accessToken/refreshToken 为空。
 */
export type CloudRemoteSession = {
  accessToken: string
  refreshToken: string
  expiresIn?: number
  account?: Account
  bound: boolean
}

/** 手机端发起的 Device Flow 授权上下文；私钥仅内存持有（不落盘），供后续 PoP 签名使用。 */
export type CloudRemoteDeviceAuthorization = {
  deviceCode: string
  userCode: string
  interval: number
  /** Ed25519 私钥（Web Crypto CryptoKey，仅内存持有）。 */
  privateKey: CryptoKey
}

/** /oauth/token（device_code / refresh_token grant）成功响应（TokenSet）。 */
export type CloudRemoteTokenSet = {
  accessToken: string
  refreshToken: string
  tokenType: string
  expiresIn: number
  refreshTokenExpiresIn: number
  installationId: string
  identityMode: string
}

/** 云账户远程设备（GET /v1/remote/devices）。 */
export type CloudRemoteDevice = {
  installationId: string
  name?: string
  online: boolean
  services?: Array<{ id: number; name: string; port: number; protocol: string }>
}

/** TURN 临时凭据（POST /v1/remote/turn-credentials）。 */
export type CloudRemoteTurnCredentials = {
  urls: string[]
  username: string
  credential: string
  ttl: number
}

export class CloudRemoteClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'cloud_remote_request_failed') {
    super(message)
    this.name = 'CloudRemoteClientError'
    this.status = status
    this.code = code
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

type TokenPayload = {
  access_token?: unknown
  accessToken?: unknown
  refresh_token?: unknown
  refreshToken?: unknown
  expires_in?: unknown
  expiresIn?: unknown
  token_type?: unknown
  tokenType?: unknown
  refresh_token_expires_in?: unknown
  refreshTokenExpiresIn?: unknown
  installation_id?: unknown
  installationId?: unknown
  identity_mode?: unknown
  identityMode?: unknown
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
}

/** 提取错误响应中的 message/code（兼容 {error:{code,message}} 与 {error, code} 两种结构）。 */
function extractError(payload: unknown): { message: string; code: string } {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    const error = record.error
    if (typeof error === 'string') {
      return { message: error, code: typeof record.code === 'string' ? record.code : 'cloud_remote_request_failed' }
    }
    if (typeof error === 'object' && error !== null) {
      const detail = error as Record<string, unknown>
      return {
        message: typeof detail.message === 'string' ? detail.message : '云服务请求失败',
        code: typeof detail.code === 'string' ? detail.code : 'cloud_remote_request_failed',
      }
    }
  }
  return { message: '云服务请求失败', code: 'cloud_remote_request_failed' }
}

/** 生成 RFC 4122 v4 UUID（优先 crypto.randomUUID，非安全上下文降级 getRandomValues）。 */
function randomUUID(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 生成 Ed25519 密钥对；Web Crypto 不支持时抛可读错误。 */
async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
    throw new CloudRemoteClientError('当前设备不支持安全登录，请升级系统', 0, 'cloud_remote_unsupported_crypto')
  }
  try {
    // 较新 Chromium/Android WebView 支持 Ed25519；NotSupportedError 按不支持处理。
    return await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  } catch {
    throw new CloudRemoteClientError('当前设备不支持安全登录，请升级系统', 0, 'cloud_remote_unsupported_crypto')
  }
}

/** 导出 Ed25519 公钥为 rawurl base64（base64url 去 '='，与云侧校验一致）。 */
async function exportPublicKeyRawUrl(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', key))
  let binary = ''
  for (const byte of raw) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

/** 底层 HTTP 传输：原生平台走 CapacitorHttp（原生栈绕 CORS），Web 降级 fetch。 */
async function requestCloudApi(baseUrl: string, path: string, options: RequestOptions, accessToken?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...options.headers,
  }

  if (typeof Capacitor !== 'undefined' && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url: `${baseUrl}${path}`,
      method: options.method ?? 'GET',
      headers,
      data: options.body,
      connectTimeout: 15000,
      readTimeout: 30000,
    })
    if (response.status < 200 || response.status >= 300) {
      const detail = extractError(response.data)
      throw new CloudRemoteClientError(detail.message, response.status, detail.code)
    }
    return response.data
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  })
  if (!response.ok) {
    let payload: Record<string, unknown> = {}
    try {
      payload = (await response.json()) as Record<string, unknown>
    } catch {
      // 保留状态码兜底文案。
    }
    const detail = extractError(payload)
    throw new CloudRemoteClientError(
      detail.message === '云服务请求失败' ? `云服务请求失败 (${response.status})` : detail.message,
      response.status,
      detail.code,
    )
  }
  return response.json()
}

export class CloudRemoteClient {
  private readonly baseUrl: string
  private accessToken = ''
  private refreshToken = ''
  private refreshPromise: Promise<CloudRemoteTokenSet> | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  /** 当前云服务地址（去尾斜杠）。 */
  get cloudUrl(): string {
    return this.baseUrl
  }

  /** 清空内存令牌（退出登录时调用；令牌仅进程内存，不落盘）。 */
  clearTokens(): void {
    this.accessToken = ''
    this.refreshToken = ''
  }

  /** 发起 Device Flow：生成 Ed25519 密钥对并请求设备授权码。 */
  async deviceAuthorization(): Promise<CloudRemoteDeviceAuthorization> {
    const installationId = randomUUID()
    const keyPair = await generateEd25519KeyPair()
    const publicKey = await exportPublicKeyRawUrl(keyPair.publicKey)
    const payload = await this.request('POST', '/oauth/device_authorization', {
      installationId,
      clientId: CLOUD_MOBILE_CLIENT_ID,
      publicKey,
      installationName: CLOUD_MOBILE_INSTALLATION_NAME,
      platform: CLOUD_MOBILE_PLATFORM,
      clientVersion: CLOUD_MOBILE_CLIENT_VERSION,
    })
    const record = asRecord(payload)
    const deviceCode = record.deviceCode
    const userCode = record.userCode
    if (typeof deviceCode !== 'string' || deviceCode === '' || typeof userCode !== 'string' || userCode === '') {
      throw new CloudRemoteClientError('无法获取设备授权码，请稍后重试', 0, 'cloud_remote_request_failed')
    }
    const interval = typeof record.interval === 'number' && record.interval > 0 ? record.interval : DEVICE_FLOW_DEFAULT_INTERVAL
    return {
      deviceCode,
      userCode,
      interval,
      privateKey: keyPair.privateKey,
    }
  }

  /** 登录：确认设备授权并返回会话（云侧无令牌时需再经 pollDeviceToken 兑换）。 */
  async login(email: string, password: string, userCode = ''): Promise<CloudRemoteSession> {
    const payload = await this.request('POST', '/v1/accounts/login', { userCode, email, password })
    return this.consumeSession(payload)
  }

  /** 注册并确认设备授权。 */
  async register(email: string, password: string, userCode = ''): Promise<CloudRemoteSession> {
    const payload = await this.request('POST', '/v1/accounts/register', { userCode, email, password })
    return this.consumeSession(payload)
  }

  /** 轮询设备授权状态并兑换令牌：首次立即请求；authorization_pending 继续，slow_down 间隔 +5s（上限 60s），总超时 600s。 */
  async pollDeviceToken(deviceCode: string, interval: number): Promise<CloudRemoteTokenSet> {
    let currentInterval = interval > 0 ? interval : DEVICE_FLOW_DEFAULT_INTERVAL
    const deadline = Date.now() + DEVICE_FLOW_MAX_WAIT_MS
    for (;;) {
      if (Date.now() > deadline) {
        throw new CloudRemoteClientError('登录超时，请重新发起登录', 0, 'device_flow_timeout')
      }
      try {
        const payload = await this.request('POST', '/oauth/token', {
          grantType: DEVICE_GRANT_TYPE,
          deviceCode,
          clientId: CLOUD_MOBILE_CLIENT_ID,
        })
        const tokens = this.parseTokenSet(payload)
        this.accessToken = tokens.accessToken
        this.refreshToken = tokens.refreshToken
        return tokens
      } catch (error) {
        if (!(error instanceof CloudRemoteClientError) || error.status !== 400) {
          throw error
        }
        if (error.code === 'authorization_pending') {
          // 用户尚未批准，继续轮询。
        } else if (error.code === 'slow_down') {
          currentInterval = Math.min(currentInterval + 5, DEVICE_FLOW_MAX_INTERVAL)
        } else if (error.code === 'expired_token') {
          throw new CloudRemoteClientError('设备授权已过期，请重新发起登录', 400, 'expired_token')
        } else if (error.code === 'access_denied') {
          throw new CloudRemoteClientError('设备授权已被拒绝', 400, 'access_denied')
        } else if (error.code === 'invalid_grant') {
          throw new CloudRemoteClientError('授权请求无效，请重新登录', 400, 'invalid_grant')
        } else {
          throw error
        }
        await sleep(currentInterval * 1000)
      }
    }
  }

  /** 用 refresh_token 兑换新令牌；并发调用共享同一底层请求（互斥防并发）。 */
  refresh(): Promise<CloudRemoteTokenSet> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null
      })
    }
    return this.refreshPromise
  }

  private async doRefresh(): Promise<CloudRemoteTokenSet> {
    if (this.refreshToken === '') {
      throw new CloudRemoteClientError('登录已过期，请重新登录', 0, 'auth_expired')
    }
    const payload = await this.request('POST', '/oauth/token', {
      grantType: REFRESH_GRANT_TYPE,
      refreshToken: this.refreshToken,
      clientId: CLOUD_MOBILE_CLIENT_ID,
    })
    const tokens = this.parseTokenSet(payload)
    this.accessToken = tokens.accessToken
    if (tokens.refreshToken !== '') {
      this.refreshToken = tokens.refreshToken
    }
    return tokens
  }

  /** 获取当前账号信息（GET /v1/me）。 */
  async getMe(): Promise<Account> {
    const payload = asRecord(await this.request('GET', '/v1/me', undefined, true))
    const record = asRecord(payload.account ?? payload)
    return {
      id: typeof record.id === 'string' ? record.id : '',
      email: typeof record.email === 'string' ? record.email : '',
      mode: typeof record.mode === 'string' ? record.mode : undefined,
      plan: typeof record.plan === 'string' ? record.plan : undefined,
    }
  }

  /** 列出云账户可远程访问的设备（GET /v1/remote/devices）。 */
  async listDevices(): Promise<{ items: CloudRemoteDevice[] }> {
    const payload = asRecord(await this.request('GET', '/v1/remote/devices', undefined, true))
    const items = payload.items
    if (!Array.isArray(items)) {
      return { items: [] }
    }
    return {
      items: items.map((item) => {
        const record = asRecord(item)
        const services = Array.isArray(record.services)
          ? record.services.map((service): { id: number; name: string; port: number; protocol: string } => {
              const serviceRecord = asRecord(service)
              return {
                id: typeof serviceRecord.id === 'number' ? serviceRecord.id : 0,
                name: typeof serviceRecord.name === 'string' ? serviceRecord.name : '',
                port: typeof serviceRecord.port === 'number' ? serviceRecord.port : 0,
                protocol: typeof serviceRecord.protocol === 'string' ? serviceRecord.protocol : '',
              }
            })
          : undefined
        return {
          installationId: typeof record.installationId === 'string' ? record.installationId : typeof record.id === 'string' ? record.id : '',
          name: typeof record.name === 'string' ? record.name : undefined,
          online: record.online === true,
          services,
        }
      }),
    }
  }

  /** 获取 TURN 临时凭据（POST /v1/remote/turn-credentials）。 */
  async turnCredentials(): Promise<CloudRemoteTurnCredentials> {
    const payload = asRecord(await this.request('POST', '/v1/remote/turn-credentials', undefined, true))
    const urls = Array.isArray(payload.urls) ? payload.urls.filter((url): url is string => typeof url === 'string') : []
    return {
      urls,
      username: typeof payload.username === 'string' ? payload.username : '',
      credential: typeof payload.credential === 'string' ? payload.credential : '',
      ttl: typeof payload.ttl === 'number' ? payload.ttl : 0,
    }
  }

  /** 统一请求入口：authed 请求带 Bearer；401 时自动刷新（互斥）后重试一次；网络异常转 network_error。 */
  private async request(method: string, path: string, body?: unknown, authed = false): Promise<unknown> {
    try {
      return await requestCloudApi(this.baseUrl, path, { method, body }, authed ? this.accessToken || undefined : undefined)
    } catch (error) {
      if (authed && error instanceof CloudRemoteClientError && error.status === 401) {
        try {
          await this.refresh()
        } catch {
          throw new CloudRemoteClientError('登录已过期，请重新登录', 0, 'auth_expired')
        }
        return requestCloudApi(this.baseUrl, path, { method, body }, this.accessToken || undefined)
      }
      if (error instanceof CloudRemoteClientError) {
        throw error
      }
      // fetch / CapacitorHttp 抛出的网络异常统一转为可读错误。
      throw new CloudRemoteClientError('无法连接云服务，请检查网络或云服务地址', 0, 'network_error')
    }
  }

  private parseTokenSet(payload: unknown): CloudRemoteTokenSet {
    const tokenPayload = asRecord(payload) as TokenPayload
    const accessToken = tokenPayload.access_token ?? tokenPayload.accessToken
    const refreshToken = tokenPayload.refresh_token ?? tokenPayload.refreshToken
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new CloudRemoteClientError('云服务返回了无效的令牌', 0, 'cloud_remote_request_failed')
    }
    const tokenTypeValue = tokenPayload.token_type ?? tokenPayload.tokenType
    const expiresInValue = tokenPayload.expires_in ?? tokenPayload.expiresIn
    const refreshExpiresInValue = tokenPayload.refresh_token_expires_in ?? tokenPayload.refreshTokenExpiresIn
    const installationIdValue = tokenPayload.installation_id ?? tokenPayload.installationId
    const identityModeValue = tokenPayload.identity_mode ?? tokenPayload.identityMode
    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : '',
      tokenType: typeof tokenTypeValue === 'string' ? tokenTypeValue : 'Bearer',
      expiresIn: typeof expiresInValue === 'number' ? expiresInValue : 0,
      refreshTokenExpiresIn: typeof refreshExpiresInValue === 'number' ? refreshExpiresInValue : 0,
      installationId: typeof installationIdValue === 'string' ? installationIdValue : '',
      identityMode: typeof identityModeValue === 'string' ? identityModeValue : '',
    }
  }

  private consumeSession(payload: unknown): CloudRemoteSession {
    const record = asRecord(payload)
    const tokenPayload = (typeof record.token === 'object' && record.token !== null ? record.token : record) as TokenPayload
    const accessToken = tokenPayload.access_token ?? tokenPayload.accessToken
    const refreshToken = tokenPayload.refresh_token ?? tokenPayload.refreshToken
    const accountRecord = asRecord(record.account ?? record.user)
    const account: Account | undefined = Object.keys(accountRecord).length > 0
      ? {
          id: typeof accountRecord.id === 'string' ? accountRecord.id : '',
          email: typeof accountRecord.email === 'string' ? accountRecord.email : '',
          mode: typeof accountRecord.mode === 'string' ? accountRecord.mode : undefined,
          plan: typeof accountRecord.plan === 'string' ? accountRecord.plan : undefined,
        }
      : undefined

    if (typeof accessToken === 'string' && accessToken !== '' && typeof refreshToken === 'string' && refreshToken !== '') {
      const expiresInValue = tokenPayload.expires_in ?? tokenPayload.expiresIn
      this.accessToken = accessToken
      this.refreshToken = refreshToken
      return {
        accessToken,
        refreshToken,
        expiresIn: typeof expiresInValue === 'number' ? expiresInValue : undefined,
        account,
        bound: true,
      }
    }

    return {
      accessToken: '',
      refreshToken: '',
      account,
      bound: true,
    }
  }
}
