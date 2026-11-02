/**
 * 渲染进程 → 主进程浏览器窄桥的请求解析（纯函数）。
 *
 * 这是安全边界：渲染进程里任何代码都能调桥，所以按白名单逐字段校验 —— 多一个键、
 * 少一个键、类型不对、矩形非有限数或尺寸小于 1 一律丢弃，主进程只处理解析成功的请求。
 *
 * 单独成模块的原因与 layout.mjs 相同：electron-main.mjs 依赖 electron，无法被单测直接导入。
 */
const RECT_KEYS = ['x', 'y', 'width', 'height']

export function parseBrowserRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.type === 'is-available' || value.type === 'get-state') {
    return Object.keys(value).length === 1 ? { type: value.type } : null
  }
  if (value.type === 'set-visible') {
    if (Object.keys(value).length !== 2 || typeof value.visible !== 'boolean') return null
    return { type: 'set-visible', visible: value.visible }
  }
  if (value.type === 'set-bounds') {
    const rect = value.rect
    if (Object.keys(value).length !== 2 || !rect || typeof rect !== 'object' || Array.isArray(rect)) return null
    const keys = Object.keys(rect)
    if (keys.length !== 4 || keys.some((key) => !RECT_KEYS.includes(key))) return null
    if (!RECT_KEYS.every((key) => Number.isFinite(rect[key]))) return null
    if (rect.width < 1 || rect.height < 1) return null
    return { type: 'set-bounds', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  }
  return null
}
