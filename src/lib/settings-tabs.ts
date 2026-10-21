import { createElement } from 'react'
import { ReactSettingsTabContent } from '@/lib/react-settings-tabs'
import { t } from '@/lib/i18n'

const settingsTabGroupDefinitions = [
  { key: 'basic', name: 'settingsGroupBasic' },
  { key: 'ai', name: 'settingsGroupAi' },
  { key: 'automation', name: 'settingsGroupAutomation' },
] as const

const settingsTabDefinitions = [
  { key: 'defaults', name: 'defaultOptions', description: 'defaultOptionsDescription', group: 'basic', keywords: '通用 常规 general preferences language 语言 model 模型 thinking 思考 tool 工具 notification 通知 context 上下文 compact 压缩 archive 归档 terminal shell 终端' },
  { key: 'appearance', name: 'appearance', description: 'appearanceDescription', group: 'basic', keywords: '外观 appearance theme 主题 light 浅色 dark 深色 font 字体 size 字号' },
  { key: 'memory', name: 'memory', description: 'memoryDescription', group: 'basic', keywords: '记忆 memory 偏好 习惯' },
  { key: 'network', name: 'networkAndDevices', description: 'networkAndDevicesDescription', group: 'basic', keywords: '网络 设备 network devices lan 局域网 proxy 代理 pac 密码 设备' },
  { key: 'customModels', name: 'customModels', description: 'customModelsDescription', group: 'ai', keywords: '模型 提供商 models providers 供应商 custom 自定义 openai api deepseek ollama' },
  { key: 'agents', name: 'agentsTab', description: 'agentsDescription', group: 'ai', keywords: '智能体 agents agent subagent 子代理 profiles' },
  { key: 'skills', name: 'skills', description: 'globalSkillsDescription', group: 'ai', keywords: '技能 skills skill SKILL.md' },
  { key: 'mcp', name: 'mcpServers', description: undefined, group: 'ai', keywords: 'MCP 服务 servers 服务器 tools 工具' },
  { key: 'plugins', name: 'plugins', description: undefined, group: 'ai', keywords: '插件 plugins 扩展 extensions' },
  { key: 'hooks', name: 'hooksTab', description: 'hooksTabDescription', group: 'automation', keywords: 'Hooks webhook 命令 事件' },
  { key: 'scheduledTasks', name: 'scheduledTasks', description: 'scheduledTasksDescription', group: 'automation', keywords: '定时任务 scheduled tasks cron 计划 调度' },
  { key: 'projectCommands', name: 'projectCommands', description: 'projectCommandsDescription', group: 'automation', keywords: '项目命令 commands slash 目录' },
  { key: 'data', name: 'dataManagement', description: 'dataManagementDescription', group: 'automation', keywords: '数据管理 data backup 备份 restore 恢复 archived 归档 conversations 对话 share 分享 links 链接 import 导入 export 导出' },
  { key: 'about', name: 'about', description: 'aboutQuickForgeDescription', group: undefined, keywords: '关于 about version 版本 update 更新 docs 文档 github' },
] as const

export type SettingsInitialTab = typeof settingsTabDefinitions[number]['key']

export function createSettingsTabs(customProvider?: string) {
  const items = settingsTabDefinitions.map(({ key, name, description, group, keywords }) => ({
    key,
    group,
    keywords,
    getTabName: () => t(name),
    getDescription: description ? () => t(description) : undefined,
    content: createElement(ReactSettingsTabContent, { key: `${key}:${customProvider ?? ''}`, tabKey: key, customProvider }),
  }))
  const groups = settingsTabGroupDefinitions.map((group) => ({
    key: group.key,
    getLabel: () => t(group.name),
    items: items.filter((item) => item.group === group.key),
  }))
  return {
    items,
    groups,
    about: items.find((item) => item.key === 'about'),
    indexOf: (key: SettingsInitialTab) => items.findIndex((item) => item.key === key),
  }
}
