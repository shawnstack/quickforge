/**
 * 工具卡片 ±行数里程计（odometer）的 DOM 更新逻辑（纯逻辑，元素创建与媒体查询通过参数注入，便于单元测试）。
 *
 * 行为约定：
 * - 每位数字一列，列内 0-9 垂直堆叠，通过 strip 的 translateY 滚动（过渡由 CSS transition 完成）；
 * - 位数增长时新列出现在左侧并标记 enter（入场动画），动画结束后移除标记避免重放；
 * - 位数减少时从左侧移除多余列；
 * - running 时根元素标记 running（呼吸动画），结束定格；
 * - prefers-reduced-motion 时标记 reduced，CSS 关闭所有动画。
 */

export const ODOMETER_ENTER_MS = 380

export type OdometerElementLike = {
  className: string
  textContent: string
  style: { transform: string }
  children: OdometerElementLike[]
  appendChild(child: OdometerElementLike): unknown
  insertBefore(child: OdometerElementLike, ref: OdometerElementLike | null): unknown
  removeChild(child: OdometerElementLike): unknown
}

export type OdometerEnv = {
  prefersReducedMotion(): boolean
  createElement(tag: string): OdometerElementLike
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(token: unknown): void
}

type OdometerSideState = {
  group: OdometerElementLike
  sign: OdometerElementLike
  digits: Array<{ holder: OdometerElementLike; strip: OdometerElementLike; enterTimer: unknown }>
}

function normalizeCount(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

export class OdometerDiffCounterController {
  private root: OdometerElementLike
  private env: OdometerEnv
  private addSide: OdometerSideState | undefined
  private delSide: OdometerSideState | undefined

  constructor(root: OdometerElementLike, env: OdometerEnv) {
    this.root = root
    this.env = env
    // 元素可能被装饰层搬移（disconnect→connect）或整棵 cloneNode 后重挂，
    // 每次新建 controller 前清掉既有子节点，避免 +/− 列叠加重复。
    while (root.children.length > 0) {
      root.removeChild(root.children[0])
    }
  }

  /** 元素断开时调用：清理未触发的入场标记定时器。 */
  dispose() {
    for (const side of [this.addSide, this.delSide]) {
      for (const digit of side?.digits ?? []) {
        if (digit.enterTimer !== undefined) this.env.clearTimeout(digit.enterTimer)
      }
    }
  }

  /** 同步 ±行数与运行状态；计数变化时对应数字列滚动到位。 */
  sync(added: number, removed: number, running: boolean) {
    const reduced = this.env.prefersReducedMotion()
    this.root.className = [
      'quickforge-diff-counter',
      running ? 'quickforge-diff-counter-running' : '',
      reduced ? 'quickforge-odometer-reduced' : '',
    ].filter(Boolean).join(' ')

    this.syncSide(this.addSide ??= this.createSide('add', '+'), normalizeCount(added))
    this.syncSide(this.delSide ??= this.createSide('del', '−'), normalizeCount(removed))
  }

  private createSide(kind: 'add' | 'del', sign: string): OdometerSideState {
    const group = this.env.createElement('span')
    group.className = `quickforge-odometer-side ${kind}`
    const signEl = this.env.createElement('span')
    signEl.className = 'quickforge-odometer-sign'
    signEl.textContent = sign
    group.appendChild(signEl)
    this.root.appendChild(group)
    return { group, sign: signEl, digits: [] }
  }

  private createDigitColumn(digit: number) {
    const holder = this.env.createElement('span')
    holder.className = 'quickforge-odometer-digit enter'
    const strip = this.env.createElement('span')
    strip.className = 'quickforge-odometer-strip'
    for (let i = 0; i <= 9; i++) {
      const span = this.env.createElement('span')
      span.textContent = String(i)
      strip.appendChild(span)
    }
    strip.style.transform = `translateY(-${digit}em)`
    holder.appendChild(strip)
    return { holder, strip, enterTimer: undefined as unknown }
  }

  private syncSide(side: OdometerSideState, count: number) {
    const next = String(count).split('').map(Number)

    // 位数减少时移除左侧多余列（右侧数位保持 DOM 稳定，transition 不被打断）。
    while (side.digits.length > next.length) {
      const removed = side.digits.shift()
      if (!removed) break
      if (removed.enterTimer !== undefined) this.env.clearTimeout(removed.enterTimer)
      side.group.removeChild(removed.holder)
    }
    // 位数增长时新列插到最左（符号之后），标记 enter 触发入场动画。
    while (side.digits.length < next.length) {
      const column = this.createDigitColumn(0)
      side.group.insertBefore(column.holder, side.group.children[1] ?? null)
      column.enterTimer = this.env.setTimeout(() => {
        column.enterTimer = undefined
        column.holder.className = 'quickforge-odometer-digit'
      }, ODOMETER_ENTER_MS)
      side.digits.unshift(column)
    }

    side.digits.forEach((column, i) => {
      column.strip.style.transform = `translateY(-${next[i]}em)`
    })
  }
}
