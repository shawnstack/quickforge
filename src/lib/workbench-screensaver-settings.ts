import { getAppStorage } from '@/storage'

/** 屏保 idle 阈值：30 分钟无操作。 */
export const WORKBENCH_SCREENSAVER_IDLE_MS = 30 * 60 * 1000
export const WORKBENCH_SCREENSAVER_KEY = 'workbenchScreensaver'

export async function loadWorkbenchScreensaver(): Promise<boolean> {
  return (await getAppStorage().settings.get<boolean>(WORKBENCH_SCREENSAVER_KEY)) === true
}

export async function saveWorkbenchScreensaver(enabled: boolean): Promise<void> {
  await getAppStorage().settings.set(WORKBENCH_SCREENSAVER_KEY, enabled)
}

/** 纯判定：启用、工作台未开、且 idle 达到阈值时才触发屏保。 */
export function screensaverDue(lastActivity: number, now: number, enabled: boolean, workbenchOpen: boolean): boolean {
  return enabled && !workbenchOpen && now - lastActivity >= WORKBENCH_SCREENSAVER_IDLE_MS
}