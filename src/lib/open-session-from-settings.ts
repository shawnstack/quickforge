import { getAppStorage } from '@/storage'
import { logger } from './logger'

export type OpenSessionFromSettingsOptions = {
  sessionId: string
  closeSettingsPage: () => void
  scheduleSessionLoad: (sessionId: string, load: () => Promise<boolean>) => void
  loadSession: (sessionId: string) => Promise<boolean>
  onMissingSession: () => void
}

/**
 * 定时任务历史「查看对话」与系统通知点击共用的跳转入口：
 * 先本地预检会话元数据，不存在则留在当前页（设置页保持打开）并提示；
 * 存在则关闭设置页并加载会话；加载失败（如服务端 restore 404）时兜底提示。
 */
export async function openSessionFromSettings(options: OpenSessionFromSettingsOptions): Promise<void> {
  const { sessionId, closeSettingsPage, scheduleSessionLoad, loadSession, onMissingSession } = options
  if (!sessionId) return
  try {
    const metadata = await getAppStorage().sessions.getMetadata(sessionId)
    if (!metadata) {
      onMissingSession()
      return
    }
  } catch (error) {
    // 预检本身失败不阻断跳转，交由后续加载与兜底提示兜住。
    logger.error('Failed to check session metadata for open-session-from-settings:', error)
  }
  closeSettingsPage()
  scheduleSessionLoad(sessionId, async () => {
    const loaded = await loadSession(sessionId)
    if (!loaded) onMissingSession()
    return loaded
  })
}
