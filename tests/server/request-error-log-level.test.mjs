// 「请求错误」该记 ERROR 还是 WARN。
//
// 改前：`server/index.mjs` 的请求级 catch 一律 `reqLogger.error(...)`，于是 400（参数
// 缺失、body 太大、JSON 坏）、409（会话写租约冲突）、403/404 全部以 ERROR 落盘。
// 当天 13 条 ERROR 逐条读完全是 4xx 噪音——而 ERROR 计数正是我每跳判断「有没有真
// 问题」的第一眼指标，它一旦全被噪音占满就等于没有（decisions §42）。
//
// 口径：4xx = 客户端/协议错 → WARN；5xx 与「没有 statusCode 的异常」→ ERROR，那些才
// 是服务端自己出错。非数字 / 非 4xx 的 statusCode 一律按 ERROR（保守：宁可吵，不可漏）。
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { requestErrorLogLevel } from '../../server/utils/response.mjs'

function withStatus(statusCode) {
  const error = new Error('boom')
  if (statusCode !== undefined) error.statusCode = statusCode
  return error
}

describe('requestErrorLogLevel：4xx 记 WARN、5xx 记 ERROR', () => {
  it('客户端错（4xx）不该冒充服务端出错', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 423, 429]) {
      expect(requestErrorLogLevel(withStatus(status))).toBe('warn')
    }
  })

  it('服务端错（5xx）仍是 ERROR', () => {
    for (const status of [500, 502, 503]) {
      expect(requestErrorLogLevel(withStatus(status))).toBe('error')
    }
  })

  it('没有 statusCode 的异常按 ERROR（sendError 也会把它当 500 写出）', () => {
    expect(requestErrorLogLevel(withStatus(undefined))).toBe('error')
    expect(requestErrorLogLevel(undefined)).toBe('error')
    expect(requestErrorLogLevel(null)).toBe('error')
  })

  it('非数字 / 非 4xx 的 statusCode 一律 ERROR——宁可吵，不可漏', () => {
    expect(requestErrorLogLevel({ statusCode: '400' })).toBe('error')
    expect(requestErrorLogLevel({ statusCode: 0 })).toBe('error')
    expect(requestErrorLogLevel({ statusCode: 200 })).toBe('error')
    expect(requestErrorLogLevel({ statusCode: Number.NaN })).toBe('error')
  })

  it('接线：index.mjs 的请求级 catch 必须走这个函数', async () => {
    // 这一条是「读源码文本钉」——仓库里已有同款先例（如 session-index-lifecycle）。
    // 纯函数的 4 条断言管不住「有人在 index.mjs 里改回 reqLogger.error」。
    const source = await readFile(new URL('../../server/index.mjs', import.meta.url), 'utf8')
    expect(source).toContain('requestErrorLogLevel(error)')
  })
})
