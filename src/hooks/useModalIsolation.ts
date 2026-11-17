import { useEffect, type RefObject } from 'react'

export type ModalIsolationOptions = {
  /** 是否生效。受控弹层在关闭态仍挂着钩子时用它与 `open` 联动，默认 true。 */
  enabled?: boolean
}

/**
 * module 级引用计数表：两个弹层同时挂载时会游走到同一批兄弟节点，
 * 每个实例只认领自己那一份，减到 0 才真正摘 `inert`；`prev` 记住兄弟本来就带
 * `inert` 的情况——那是别人设的状态，卸载时不能替它摘掉。
 */
const adopted = new Map<Element, { count: number; prev: boolean }>()

/**
 * 弹层背景隔离：`aria-modal` 声明了「弹层以外的界面不可交互」，本钩子负责在
 * 无障碍树上兑现——挂载期间把弹层沿途每一层的**兄弟**设为 `inert`，卸载时按引用计数还原。
 *
 * - 只隔兄弟、不碰祖先链：祖先 inert 了，弹层自己也进不去；
 * - `SCRIPT` 兄弟跳过：脚本节点不需要（也没意义）被隔；
 * - cleanup 必须同步摘，不许 setTimeout：`useDialogFocusTrap` 的焦点归还是
 *   `setTimeout(0)`，`inert` 若不先摘，那个宏任务跑的时候归还目标还不可聚焦——
 *   jsdom 不实现 `inert` 语义，这颗雷只有靠写法守住，测试抓不到；
 * - cleanup 不读 `dialogRef.current`：React 卸载时先把 ref 置空、再跑 passive
 *   effect 的 cleanup，那一刻它多半已是 null——`touched` 必须在 effect 体里捕获好；
 * - 只写 `inert`，不加 `aria-hidden`（决策 D2：叠加只会让调试噪音变多）。
 *
 * 键盘那条线（Tab 循环 / 焦点归还）归 `useDialogFocusTrap` 管，两边别合并：
 * 一个管键盘、一个管无障碍树。
 */
export function useModalIsolation<T extends HTMLElement>(
  dialogRef: RefObject<T | null>,
  options: ModalIsolationOptions = {},
): void {
  const { enabled = true } = options

  useEffect(() => {
    if (!enabled) return undefined
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const touched: Element[] = []
    for (
      let node: Element | null = dialog;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const parent: HTMLElement | null = node.parentElement
      if (!parent) break
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || sibling.tagName === 'SCRIPT') continue
        const record = adopted.get(sibling)
        if (record) {
          // 已有别的弹层认领过：我只加计数，但 cleanup 时同样要还我这一份——
          // 若只有创建者记账，创建者先卸载、我后卸载时，最后一份认领没人减，
          // 计数净漏 1，inert 就永远摘不掉（第 3 例按 A→B 卸载实测抓到过）。
          record.count += 1
        } else {
          adopted.set(sibling, { count: 1, prev: sibling.hasAttribute('inert') })
          sibling.setAttribute('inert', '')
        }
        touched.push(sibling)
      }
    }
    return () => {
      for (const node of touched) {
        const record = adopted.get(node)
        if (!record) continue
        record.count -= 1
        if (record.count > 0) continue
        adopted.delete(node)
        if (!record.prev) node.removeAttribute('inert')
      }
    }
  }, [enabled, dialogRef])
}
