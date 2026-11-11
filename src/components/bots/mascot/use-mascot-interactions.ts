import { useEffect, useState } from 'react'
import {
  createMascotInteractController,
  type MascotAmbient,
  type MascotInteract,
  type MascotInteractHandlers,
} from './mascot-interactions'

/**
 * 把互动控制器接进 React：返回当前互动值、当前张望值和挂在球本体上的指针事件。
 *
 * `enabled` / `ambientEnabled` 由调用方按「interactive && 开启动画 && 状态允许」
 * 算好传入；状态切到不允许时，已挂上的互动会在下一个 tick 清掉——
 * 开关放在定时器回调里，不在 effect 体内同步 setState（与 useMascotState 同一约定）。
 */
export function useMascotInteractions(enabled: boolean, ambientEnabled = false): {
  interact: MascotInteract | null
  ambient: MascotAmbient
  handlers: MascotInteractHandlers
} {
  const [interact, setInteract] = useState<MascotInteract | null>(null)
  const [ambient, setAmbient] = useState<MascotAmbient>(null)
  // 控制器只创建一次、之后不再更新：用 useState 惰性初始化持有
  // （setState 引用稳定，可以安全捕获；不要用 useRef 懒初始化，渲染期读 .current 会触发 react-hooks/refs）。
  const [controller] = useState(() => createMascotInteractController(setInteract, { setAmbient }))

  useEffect(() => {
    controller.setEnabled(enabled)
    controller.setAmbientEnabled(ambientEnabled)
    if (enabled || ambientEnabled) return
    const stop = window.setTimeout(() => controller.reset(), 0)
    return () => window.clearTimeout(stop)
  }, [enabled, ambientEnabled, controller])

  useEffect(() => () => controller.dispose(), [controller])

  return { interact, ambient, handlers: controller }
}
