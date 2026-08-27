/**
 * 更新检查轮询助手：`GET /api/system/update/check` 是非阻塞接口，立即返回
 * `{ status: 'checking' | 'ok' | 'error' }` 快照，registry 请求由服务端后台刷新。
 * 这里负责有界轮询直到终态；任何失败都以 error outcome 返回，绝不抛出，
 * 调用方（启动静默检查 / About 手动检查）自行决定是否提示用户。
 */

export type UpdateCheckPayload = {
  status?: 'checking' | 'ok' | 'error'
  checkError?: string
  channel?: 'npm-runtime'
  distribution?: 'npm'
  currentVersion?: string
  latestVersion?: string
  updateAvailable?: boolean
  localVersionIsNewer?: boolean
  checkedAt?: string
}

export type UpdateCheckOutcome =
  | { kind: 'ok'; payload: UpdateCheckPayload }
  | { kind: 'error'; message?: string }

const DEFAULT_ATTEMPTS = 10
const DEFAULT_INTERVAL_MS = 1000

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function requestUpdateCheck(
  options: {
    /** 手动检查：首次请求带 force=1，跳过服务端缓存与失败退避。 */
    force?: boolean
    attempts?: number
    intervalMs?: number
    fetchImpl?: typeof fetch
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<UpdateCheckOutcome> {
  const {
    force = false,
    attempts = DEFAULT_ATTEMPTS,
    intervalMs = DEFAULT_INTERVAL_MS,
    fetchImpl = fetch,
    sleep = defaultSleep,
  } = options

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs)

    let payload: UpdateCheckPayload | null
    try {
      const query = force && attempt === 0 ? '?force=1' : ''
      const response = await fetchImpl(`/api/system/update/check${query}`, { cache: 'no-store' })
      if (!response.ok) return { kind: 'error' }
      payload = (await response.json().catch(() => null)) as UpdateCheckPayload | null
    } catch {
      return { kind: 'error' }
    }
    if (!payload || typeof payload !== 'object') return { kind: 'error' }

    // 兼容未携带 status 字段的旧服务端：有版本信息视为终态成功。
    const status = payload.status ?? (payload.currentVersion ? 'ok' : 'error')
    if (status === 'ok') return { kind: 'ok', payload }
    if (status === 'error') return { kind: 'error', message: payload.checkError }
    // status === 'checking' → 继续轮询
  }

  return { kind: 'error' }
}
