import { useEffect, useState } from 'react'
import type { MascotStateId } from './mascot-geometry'
import { resolveMascotState, type MascotSignals } from './mascot-state'

/**
 * 在 `resolveMascotState` 之上加一条：跑完一轮先开心一小会儿再回到真实状态。
 *
 * 开关都放在定时器回调里，不在 effect 体内同步 setState ——
 * 同步 setState 会立刻触发一次额外的渲染，这条状态又只是装饰，不值得。
 */
export function useMascotState(signals: MascotSignals, holdMs = 1800): MascotStateId {
  const completed = Boolean(signals.justCompleted)
  const [holding, setHolding] = useState(false)

  useEffect(() => {
    if (!completed) return
    const startId = window.setTimeout(() => setHolding(true), 0)
    const endId = window.setTimeout(() => setHolding(false), holdMs)
    return () => {
      window.clearTimeout(startId)
      window.clearTimeout(endId)
    }
  }, [completed, holdMs])

  const base = resolveMascotState({ ...signals, justCompleted: false })
  return holding && base === 'idle' ? 'happy' : base
}
