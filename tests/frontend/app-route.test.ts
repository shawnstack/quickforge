import { describe, expect, it } from 'vitest'
import { resolveShareRouteId } from '../../src/lib/app-route'

// 分享链接的顶层路由判别。用户能从地址栏、聊天工具里的链接、书签三种途径进来，
// 所以「什么样的 pathname 算分享链接」必须是可测的纯函数，而不是渲染函数里的一段内联正则。
describe('share route resolution', () => {
  it('takes the session id out of a well-formed share path', () => {
    expect(resolveShareRouteId('/share/6b1d9a0e')).toBe('6b1d9a0e')
    // 复制粘贴时常带上尾斜杠
    expect(resolveShareRouteId('/share/6b1d9a0e/')).toBe('6b1d9a0e')
  })

  it('decodes percent-escaped ids exactly once', () => {
    expect(resolveShareRouteId('/share/a%20b')).toBe('a b')
    expect(resolveShareRouteId('/share/100%25')).toBe('100%')
  })

  it('leaves every other path to the main app', () => {
    for (const pathname of ['/', '/share', '/share/', '/share/a/b', '/x/share/a', '']) {
      expect(resolveShareRouteId(pathname), `pathname=${JSON.stringify(pathname)}`).toBeUndefined()
    }
  })

  it('treats an undecodable share id as "not a share link" instead of throwing', () => {
    // 畸形的百分号转义（链接被聊天工具截断/改写、手工编辑地址栏）会让 decodeURIComponent 抛 URIError。
    // 抛出点位于渲染函数里，整个应用会被 ErrorBoundary 接成错误页，且刷新还是同一个地址。
    expect(() => resolveShareRouteId('/share/100%')).not.toThrow()
    expect(resolveShareRouteId('/share/100%')).toBeUndefined()
    expect(resolveShareRouteId('/share/%E0%A4%A')).toBeUndefined()
  })
})
