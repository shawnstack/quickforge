import { useEffect, useRef, type RefObject } from 'react'

/**
 * 弹窗焦点陷阱：`aria-modal` 声明了「弹窗之外的界面不可交互」，键盘就必须跟着守住——
 * Tab / Shift+Tab 在弹窗内部循环，焦点若已被程序或浏览器挪到弹窗外，下一次 Tab 拉回来。
 *
 * 这套判断原样搬自 `ui/confirm-dialog`（原来内联在它的键盘 effect 里），
 * 所以对既有弹窗来说行为是**逐字等价**的替换，只是换了个位置让别的弹窗也能用：
 *
 * - 只在 Tab 上介入，其它键（Esc / Enter）仍然由调用方自己的 handler 处理；
 * - 可聚焦集合按固定选择器收集，`offsetParent === null` 视为不可见并跳过
 *   （当前焦点除外，否则焦点停在 `position: fixed` 的控件上会被判成不可见而失效）；
 * - 焦点在弹窗外时，Tab 落到第一个、Shift+Tab 落到最后一个，都 `preventDefault`。
 */
export const DIALOG_FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type DialogFocusTrapOptions = {
  /** 是否生效。受控弹窗在关闭态仍挂着钩子时用它与 `open` 联动，默认 true。 */
  enabled?: boolean
  /**
   * 卸载时把焦点还给打开前的元素。默认 false：
   * `ui/confirm-dialog` 自己在容器销毁后统一归还，若这里再还一次会重复聚焦。
   */
  restoreFocus?: boolean
}

export function useDialogFocusTrap<T extends HTMLElement>(
  dialogRef: RefObject<T | null>,
  options: DialogFocusTrapOptions = {},
): void {
  const { enabled = true, restoreFocus = false } = options
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!enabled || !restoreFocus) return undefined
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const previous = previousFocusRef.current
      previousFocusRef.current = null
      if (!previous) return
      // 延到下一个宏任务：卸载瞬间弹窗节点可能还在文档里，此刻聚焦会被随后的移除吞掉。
      setTimeout(() => {
        if (previous.isConnected) previous.focus()
      }, 0)
    }
  }, [enabled, restoreFocus])

  useEffect(() => {
    if (!enabled) return undefined
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      const focusInsideDialog = active instanceof HTMLElement && dialog.contains(active)
      if (event.shiftKey) {
        if (active === first || !focusInsideDialog) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !focusInsideDialog) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [enabled, dialogRef])
}
