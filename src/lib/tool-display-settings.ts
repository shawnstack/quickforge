import type { AppStorage } from '@/storage'

const TOOL_DISPLAY_SETTINGS_KEY = 'tool-display-settings'

export type ToolDisplayMode = 'compact' | 'detailed'

export type ToolDisplaySettings = {
  toolDisplayMode: ToolDisplayMode
  showContextUsage: boolean
  /** 展开过程组后「已执行 N 个工具调用」阶段层（process-folding 内层 stage）是否默认展开（true=工具调用行直接可见）；手动开合记忆（saved state）优先。 */
  expandProcessStageByDefault: boolean
}

export const DEFAULT_TOOL_DISPLAY_SETTINGS: ToolDisplaySettings = {
  toolDisplayMode: 'compact',
  showContextUsage: false,
  expandProcessStageByDefault: true,
}

let cachedToolDisplaySettings: ToolDisplaySettings = { ...DEFAULT_TOOL_DISPLAY_SETTINGS }

/**
 * 归一化恒重建完整对象：legacy / 已移除字段（showToolDetails / expandToolsByDefault /
 * expandToolDetailsByDefault）当作未知字段丢弃，expandProcessStageByDefault 非布尔一律回默认（true）。
 */
function normalizeToolDisplaySettings(value: unknown): ToolDisplaySettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TOOL_DISPLAY_SETTINGS }
  const settings = value as Partial<ToolDisplaySettings>
  return {
    toolDisplayMode: settings.toolDisplayMode === 'detailed' ? 'detailed' : 'compact',
    showContextUsage: settings.showContextUsage === true,
    expandProcessStageByDefault: typeof settings.expandProcessStageByDefault === 'boolean'
      ? settings.expandProcessStageByDefault
      : true,
  }
}

export function getCachedToolDisplaySettings(): ToolDisplaySettings {
  return cachedToolDisplaySettings
}

export async function loadToolDisplaySettings(storage: AppStorage): Promise<ToolDisplaySettings> {
  const settings = normalizeToolDisplaySettings(await storage.settings.get<unknown>(TOOL_DISPLAY_SETTINGS_KEY))
  cachedToolDisplaySettings = settings
  return settings
}

/**
 * 预应用启动快照中的工具展示设置（stale-while-revalidate）：规范化后仅写
 * 模块缓存，不读库不写库；服务器校准仍由 loadToolDisplaySettings 完成。
 */
export function applyToolDisplaySettingsValue(value: unknown): ToolDisplaySettings {
  const settings = normalizeToolDisplaySettings(value)
  cachedToolDisplaySettings = settings
  return settings
}

/** 保存入口接受未归一化/不完整输入（缺省与非布尔字段由 normalize 回默认），归一化结果总是完整形状。 */
export async function saveToolDisplaySettings(storage: AppStorage, settings: Partial<ToolDisplaySettings>): Promise<void> {
  const normalized = normalizeToolDisplaySettings(settings)
  await storage.settings.set(TOOL_DISPLAY_SETTINGS_KEY, normalized)
  cachedToolDisplaySettings = normalized
}
