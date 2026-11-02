/**
 * 内嵌浏览器原生视图的几何计算（纯函数）。
 *
 * 单独成模块的原因：宿主 browser-host.mjs 依赖 electron，测试无法直接导入；
 * 而「错误的矩形绝不能盖住整个应用」是保住现有交互的关键不变量，必须可单测。
 * 这里只做数学，不碰任何 Electron API。
 */

export const MIN_VIEW_SIZE = 120
export const DEFAULT_BOUNDS = { x: 0, y: 0, width: 900, height: 720 }

/** 四个分量都是有限数才算有效矩形；缺字段或 NaN 一律丢弃。 */
export function isFiniteRect(value) {
  return Boolean(value)
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))
}

/**
 * 把渲染进程上报的矩形夹进窗口内容区：
 * - 左上角不为负，也不越过「窗口尺寸减去最小视图尺寸」；
 * - 宽高不小于 MIN_VIEW_SIZE，且不超出窗口剩余空间；
 * - 统一取整，避免每帧亚像素抖动触发原生层重排。
 */
export function clampBounds(rect, windowSize) {
  const maxWidth = Math.max(MIN_VIEW_SIZE, windowSize?.width || DEFAULT_BOUNDS.width)
  const maxHeight = Math.max(MIN_VIEW_SIZE, windowSize?.height || DEFAULT_BOUNDS.height)
  const x = Math.max(0, Math.min(Math.round(rect.x), maxWidth - MIN_VIEW_SIZE))
  const y = Math.max(0, Math.min(Math.round(rect.y), maxHeight - MIN_VIEW_SIZE))
  const width = Math.max(MIN_VIEW_SIZE, Math.min(Math.round(rect.width), maxWidth - x))
  const height = Math.max(MIN_VIEW_SIZE, Math.min(Math.round(rect.height), maxHeight - y))
  return { x, y, width, height }
}
