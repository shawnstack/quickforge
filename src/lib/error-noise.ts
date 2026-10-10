// ResizeObserver loop 报错（"ResizeObserver loop completed with undelivered
// notifications." / 旧版 "ResizeObserver loop limit exceeded"）是浏览器在单帧内
// 再次派发尺寸回调后的良性噪音：滚动同步、跑马灯等观察器在一帧内观察并改写
// 同批元素尺寸时常触发，不代表真实故障。全局错误入口据此降级，避免刷屏淹没
// 真实错误；调试时可开 localStorage `quickforge_debug=1` 查看被忽略的条目。

const RESIZE_OBSERVER_LOOP_PATTERN = /ResizeObserver loop/

export function isResizeObserverLoopError(value: unknown): boolean {
  if (typeof value === 'string') return RESIZE_OBSERVER_LOOP_PATTERN.test(value)
  if (value instanceof Error) return RESIZE_OBSERVER_LOOP_PATTERN.test(value.message)
  return false
}
