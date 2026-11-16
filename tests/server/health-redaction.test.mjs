import { describe, expect, it } from 'vitest'
import { redactHostPathsForRemote } from '../../server/health-redaction.mjs'

// `/api/health` 在局域网免密路径里（`isLanAccessBootstrapPath`），所以它返回的
// **本机绝对路径**必须按 `isLocalRequest` 收口：远程看到 null，本地照旧。
// 同一份 payload 里 `capabilities.*` 早就是这个规矩，这组用例把那半边的规则补齐。
const HOST_PATH_FIELDS = ['dataDir', 'configDir', 'storageDir', 'cacheDir', 'logsDir', 'workspaceRoot']

const remoteStatus = () => ({
  ok: true,
  mode: 'production',
  pid: 4242,
  bootId: 'boot-1',
  version: '2.4.2',
  isLocalRequest: false,
  capabilities: { restart: false, openLocalApps: false, terminal: false },
  dataDir: 'C:\\Users\\alice\\.quickforge',
  configDir: 'C:\\Users\\alice\\.quickforge\\config',
  storageDir: 'C:\\Users\\alice\\.quickforge\\storage',
  cacheDir: 'C:\\Users\\alice\\.quickforge\\cache',
  logsDir: 'C:\\Users\\alice\\.quickforge\\logs',
  workspaceRoot: 'D:\\work\\demo',
  project: { id: 'p1', name: 'demo', path: 'D:\\work\\demo' },
})

describe('redactHostPathsForRemote', () => {
  it('局域网请求：六个路径字段与 project.path 一律 null，其余字段原样', () => {
    const status = remoteStatus()
    const redacted = redactHostPathsForRemote(status)
    for (const key of HOST_PATH_FIELDS) {
      expect(redacted[key], `${key} 不该回给局域网客户端`).toBe(null)
    }
    expect(redacted.project.path, 'project.path 也是本机绝对路径').toBe(null)
    // 非路径字段一个都不能被动到，否则 UI 与 CLI 的探测会跟着坏。
    expect(redacted.ok).toBe(true)
    expect(redacted.pid).toBe(4242)
    expect(redacted.version).toBe('2.4.2')
    expect(redacted.isLocalRequest).toBe(false)
    expect(redacted.capabilities).toEqual({ restart: false, openLocalApps: false, terminal: false })
    expect(redacted.project.name).toBe('demo')
    expect(redacted.project.id).toBe('p1')
  })

  it('本地请求：路径原样保留（本地界面要显示数据目录与工作区）', () => {
    const status = { ...remoteStatus(), isLocalRequest: true }
    const redacted = redactHostPathsForRemote(status)
    expect(redacted.dataDir).toBe('C:\\Users\\alice\\.quickforge')
    expect(redacted.workspaceRoot).toBe('D:\\work\\demo')
    expect(redacted.project.path).toBe('D:\\work\\demo')
  })

  it('没有 isLocalRequest 时按远程处理（缺字段要往安全那边倒）', () => {
    const status = remoteStatus()
    delete status.isLocalRequest
    const redacted = redactHostPathsForRemote(status)
    expect(redacted.dataDir).toBe(null)
    expect(redacted.workspaceRoot).toBe(null)
  })

  it('纯函数：不改调用方传进来的那个对象', () => {
    const status = remoteStatus()
    redactHostPathsForRemote(status)
    expect(status.dataDir).toBe('C:\\Users\\alice\\.quickforge')
    expect(status.project.path).toBe('D:\\work\\demo')
  })
})
