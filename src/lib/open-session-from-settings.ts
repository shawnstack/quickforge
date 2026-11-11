import { getAppStorage } from '@/storage'
import { logger } from './logger'

export type OpenSessionFromSettingsOptions = {
  sessionId: string
  closeSettingsPage: () => void
  scheduleSessionLoad: (sessionId: string, load: () => Promise<boolean>) => void
  loadSession: (sessionId: string) => Promise<boolean>
  onMissingSession: () => void
  /**
   * 跳过「有没有持久化元数据」这一层预检。
   *
   * 只给「会话已经在内存里、但还没落盘」的场景用 —— bot 的会话在第一次发言前
   * 正是如此：服务端把空会话当空壳清理，查 metadata 必然查不到，但那不代表
   * 会话不存在。真正的存在性交给后面的 loadSession 判定。
   */
  skipMetadataPrecheck?: boolean
}

/**
 * 定时任务历史「查看对话」与系统通知点击共用的跳转入口：
 * 先本地预检会话元数据，不存在则留在当前页（设置页保持打开）并提示；
 * 存在则关闭设置页并加载会话；加载失败（如服务端 restore 404）时兜底提示。
 */
export async function openSessionFromSettings(options: OpenSessionFromSettingsOptions): Promise<void> {
  const { sessionId, closeSettingsPage, scheduleSessionLoad, loadSession, onMissingSession, skipMetadataPrecheck } = options
  if (!sessionId) return
  if (!skipMetadataPrecheck) {
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
  }
  closeSettingsPage()
  scheduleSessionLoad(sessionId, async () => {
    const loaded = await loadSession(sessionId)
    if (!loaded) onMissingSession()
    return loaded
  })
}
