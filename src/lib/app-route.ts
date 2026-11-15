/**
 * 顶层路由判别：分享链接 `/share/<id>` 的解码规则只此一处。
 *
 * 单独成模块是为了让它可测——原来这段正则与解码内联在 App 的渲染函数里，
 * 只能靠读源码断言，写不出行为测试。
 */
export const SHARE_ROUTE_PATH_PATTERN = /^\/share\/([^/]+)\/?$/

/**
 * 命中 `/share/<id>` 时返回解码后的分享 id，其余路径返回 undefined（渲染主应用）。
 * 只匹配单段 id：`/share/a/b` 不是分享链接，回落主应用而不是把 `a` 当 id。
 */
export function resolveShareRouteId(pathname: string): string | undefined {
  const rawShareId = pathname.match(SHARE_ROUTE_PATH_PATTERN)?.[1]
  if (!rawShareId) return undefined
  try {
    return decodeURIComponent(rawShareId)
  } catch {
    // 畸形的百分号转义（链接被截断/改写、手工编辑地址栏）在这里只当作「不是分享链接」，
    // 回落主应用；抛出点若留在渲染函数里，整个应用会被 ErrorBoundary 接成错误页。
    return undefined
  }
}
