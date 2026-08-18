// 短时、一次性的远程 Agent 自动批准意图（仅内存态）。
//
// 安全边界：
// - 意图（arm）仅在两种情况下创建：① 本机用户在 Cloud 设置页显式将服务从
//   disabled 切换为 enabled 时由 routes/cloud.mjs 创建；② qf-agent 首次进入
//   authorizing 且当前无有效意图（none/expired）时，由 qf-agent-process 在
//   “本机生命周期启动 + 本机存在有效 desktop 云会话”时自动创建
//   （见 beginAgentAutoApprovalWithDesktopSession）。
// - 认证远程客户端（非本机请求）触发的云服务开关切换/配置变更以
//   autoApprovalPolicy: 'manual' 启动 agent，该生命周期内（含其自动重启）
//   不会自动创建意图，也不会自动批准，仍需本机操作。
// - 意图绝不落盘：不写 agent identity，也不触碰 storage/security/cloud-identity.json。
// - user_code 只在 Node 内存中流转，用于调用云端 authorize API，不进入公开状态；
//   desktop Access Token 仅由 CloudIdentityManager 内存持有并注入请求，不复制、不暴露。
// - 一次性：意图只批准第一个捕获的 user_code；成功后即消耗，失败需显式重试。
import { CloudApiError } from './client.mjs'
import { getCloudRuntime } from './runtime.mjs'

export const AGENT_AUTO_APPROVAL_TTL_MS = 10 * 60_000

let intent = null // { expiresAt, status: 'armed'|'pending'|'consumed'|'failed', userCode, error }
let inflight = null

function safeErrorText(value) {
  const text = String(value?.message || value || '').trim()
  if (!text) return null
  return text
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 300)
}

// 返回公开可展示的意图状态；不包含 user_code、token 或身份信息。
export function getAgentAutoApprovalState({ now = Date.now() } = {}) {
  if (!intent) return { status: 'none' }
  if (Number(intent.expiresAt) <= now) return { status: 'expired' }
  if (intent.status === 'failed') return { status: 'failed', error: intent.error }
  return { status: intent.status }
}

export function armAgentAutoApproval({ ttlMs = AGENT_AUTO_APPROVAL_TTL_MS, now = Date.now() } = {}) {
  intent = {
    expiresAt: now + Math.max(1_000, Number(ttlMs) || AGENT_AUTO_APPROVAL_TTL_MS),
    status: 'armed',
    userCode: null,
    error: null,
  }
  inflight = null
  return getAgentAutoApprovalState({ now })
}

export function clearAgentAutoApproval() {
  intent = null
  inflight = null
}

// 默认执行器：复用桌面端 CloudIdentityManager.withAccessToken 调云端固定接口
// POST /v1/remote/agents/authorize，Bearer desktop access token，body { userCode }。
export async function defaultAuthorizeAgent(userCode, { signal } = {}) {
  const runtime = await getCloudRuntime()
  if (!runtime?.identity || !runtime?.client) {
    throw new CloudApiError('QuickForge Cloud is not connected.', { status: 401, code: 'cloud_not_connected' })
  }
  return runtime.identity.withAccessToken((token) => runtime.client.authorizeRemoteAgent(token, userCode, signal), { signal })
}

// qf-agent 进入 authorizing 并捕获 user_code 时调用；意图未 armed/已过期/已处理时跳过。
// 并发去重：同一意图在途调用合并为同一个 Promise；一次性消费由状态机保证。
export function beginAgentAutoApproval(userCode, { now = Date.now(), authorize = defaultAuthorizeAgent } = {}) {
  const state = getAgentAutoApprovalState({ now })
  if (state.status === 'none' || state.status === 'expired' || state.status === 'consumed' || state.status === 'failed') {
    return Promise.resolve({ status: state.status, error: state.error })
  }
  if (intent.status === 'armed') {
    const code = String(userCode || '').trim()
    if (!code) return Promise.resolve({ status: 'skipped' })
    intent.status = 'pending'
    intent.userCode = code
  }
  if (inflight) return inflight
  const activeIntent = intent
  inflight = (async () => {
    try {
      const response = await authorize(activeIntent.userCode)
      if (response && typeof response === 'object' && response.ok !== true) {
        throw new CloudApiError('QuickForge Cloud did not confirm the agent authorization.', { code: 'invalid_authorize_response' })
      }
      if (intent === activeIntent) activeIntent.status = 'consumed'
      return { status: 'consumed' }
    } catch (error) {
      const errorText = safeErrorText(error)
      if (intent === activeIntent) {
        activeIntent.status = 'failed'
        activeIntent.error = errorText
      }
      return { status: 'failed', error: errorText }
    } finally {
      if (intent === activeIntent) inflight = null
    }
  })()
  return inflight
}

// 仅允许对 failed 意图重试（保留原 user_code，用户无需打开授权页/输入码）。
export function retryAgentAutoApproval({ now = Date.now(), authorize = defaultAuthorizeAgent } = {}) {
  if (!intent || intent.status !== 'failed') {
    return Promise.resolve(getAgentAutoApprovalState({ now }))
  }
  intent.status = 'pending'
  return beginAgentAutoApproval(intent.userCode, { now, authorize })
}

// 默认 desktop 会话检查：runtime 已配置 identity，且本地凭据公开状态含有效
// Session（hasSession）并未绑定到其他 Cloud URL（无 sessionServiceMismatch）。
// 只读公开状态，不触发 refresh，也不发起网络请求。
async function defaultHasDesktopSession() {
  try {
    const runtime = await getCloudRuntime()
    if (!runtime?.identity) return false
    const status = await runtime.identity.status()
    return Boolean(status?.hasSession) && status?.sessionServiceMismatch !== true
  } catch {
    return false
  }
}

// qf-agent 首次进入 authorizing 且无有效意图（begin 返回 none/expired）时调用：
// 由本机生命周期启动（policy !== 'manual'）且存在有效 desktop 云会话时，自动
// 创建同样短时、一次性的意图并立即尝试批准；否则保持原有状态。已有
// armed/pending/consumed/failed 意图时直接返回现有结果，不重复 arm。
export async function beginAgentAutoApprovalWithDesktopSession(userCode, {
  policy = 'auto',
  now = Date.now(),
  authorize = defaultAuthorizeAgent,
  hasDesktopSession = defaultHasDesktopSession,
} = {}) {
  const first = await beginAgentAutoApproval(userCode, { now, authorize })
  if (first.status !== 'none' && first.status !== 'expired') return first
  if (policy === 'manual') return first
  let eligible = false
  try {
    eligible = (await hasDesktopSession()) === true
  } catch {
    // 会话检查失败视为无有效 desktop 会话，不自动 arm
  }
  if (!eligible) return first
  armAgentAutoApproval({ now })
  return beginAgentAutoApproval(userCode, { now, authorize })
}

export function resetAgentAutoApprovalForTests() {
  intent = null
  inflight = null
}
