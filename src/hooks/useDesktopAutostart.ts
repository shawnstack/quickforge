import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_DESKTOP_AUTOSTART_STATE,
  getDesktopAutostartBridge,
  type DesktopAutostartState,
} from '@/lib/desktop-autostart-bridge'
import { t } from '@/lib/i18n'

export type DesktopAutostartController = {
  state: DesktopAutostartState
  loading: boolean
  saving: boolean
  error: string
  setEnabled: (enabled: boolean) => Promise<void>
}

/**
 * 「开机自启动」开关的状态机。
 *
 * 状态的真相在系统登录项里（主进程读写），前端既不缓存也不持久化：每次激活设置页都回读一次。
 *
 * 两个守卫：
 * ① 读和写共用一条请求序号。连点两次时后发的先回、先发的后回，旧响应会把新值整块盖回去
 *    （`setState(await 旧请求)` 那类缺陷）；序号对不上就丢弃。
 * ② 不做乐观更新：checked 只在主进程回读系统状态之后变。系统拒绝写（组策略、受限注册表）时
 *    开关停在真实值上，不会出现「界面显示已开启、实际没写进去」。
 */
export function useDesktopAutostart({ active = true }: { active?: boolean } = {}): DesktopAutostartController {
  const [state, setState] = useState<DesktopAutostartState>(DEFAULT_DESKTOP_AUTOSTART_STATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestSeq = useRef(0)

  useEffect(() => {
    // 设置页 tab 常驻挂载、切走仅隐藏：重新激活时回读系统当前值，避免显示上次的旧快照。
    if (active === false) return
    const bridge = getDesktopAutostartBridge()
    let cancelled = false
    const seq = ++requestSeq.current
    // 无桥（Web/移动端、preload 未就绪）时落到「不支持」，与主进程回包走同一条异步路径。
    void (bridge ? bridge.getState() : Promise.resolve({ ...DEFAULT_DESKTOP_AUTOSTART_STATE }))
      .then((next) => {
        if (cancelled || seq !== requestSeq.current) return
        setState(next)
      })
      .catch(() => {
        if (cancelled || seq !== requestSeq.current) return
        setState({ ...DEFAULT_DESKTOP_AUTOSTART_STATE })
      })
      .finally(() => {
        if (cancelled || seq !== requestSeq.current) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const bridge = getDesktopAutostartBridge()
    if (!bridge) return
    const seq = ++requestSeq.current
    setSaving(true)
    setError('')
    try {
      const next = await bridge.setEnabled(enabled)
      if (seq !== requestSeq.current) return
      setState(next)
    } catch {
      if (seq !== requestSeq.current) return
      setError(t('launchAtStartupFailed'))
    } finally {
      if (seq === requestSeq.current) setSaving(false)
    }
  }, [])

  return { state, loading, saving, error, setEnabled }
}

