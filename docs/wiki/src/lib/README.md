# `src/lib/` — 前端工具库

前端业务逻辑、数据模型、存储适配器、UI 组件注册等。

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [i18n.ts](i18n.ts.md) | 国际化 (中/英) | 871 |
| [pi-chat.ts](pi-chat.ts.md) | PI SDK 适配/初始化/模型配置 | 355 |
| [server-agent.ts](server-agent.ts.md) | 服务器 Agent SSE 客户端 | 680 |
| [shared-server-agent.ts](shared-server-agent.ts.md) | 分享对话 Agent SSE 客户端 | 396 |
| [local-tools.ts](local-tools.ts.md) | 本地工作区工具 UI 渲染器 | 168 |
| [http-storage-backend.ts](http-storage-backend.ts.md) | HTTP 存储后端适配器 | 201 |
| [share-client.ts](share-client.ts.md) | 对话分享客户端 API | 145 |
| [types.ts](types.ts.md) | 类型定义 | 82 |
| [message-utils.ts](message-utils.ts.md) | 消息工具函数 | 129 |
| [reasoning-content-cache.ts](reasoning-content-cache.ts.md) | 推理内容缓存 | 277 |
| [custom-providers-only-tab.ts](custom-providers-only-tab.ts.md) | 自定义供应商设置 Tab | 564 |
| [custom-model-selector.ts](custom-model-selector.ts.md) | 自定义模型选择器 | 163 |
| [default-options-settings-tab.ts](default-options-settings-tab.ts.md) | 默认参数设置 Tab | 208 |
| [backup-settings-tab.ts](backup-settings-tab.ts.md) | 备份设置 Tab | 188 |
| [service-settings-tab.ts](service-settings-tab.ts.md) | 服务状态设置 Tab | 190 |
| [language-settings-tab.ts](language-settings-tab.ts.md) | 语言设置 Tab | 67 |
| [patch-thinking-selector.ts](patch-thinking-selector.ts.md) | Thinking 选择器补丁 | 118 |
| [utils.ts](utils.ts.md) | 通用工具 (cn) | 7 |

---

## 核心模块说明

### `i18n.ts` — 国际化 (871 行)

- 支持中/英双语
- 封装 pi-web-ui 的国际化接口
- 提供 `t()` 翻译函数和 `AppLanguage` 类型
- 翻译键覆盖: 界面文本、模型设置、工具说明、错误消息等
- `applyAppLanguage()` 持久化语言设置到存储
- `getDateLocale()` 获取日期格式化 locale

### `pi-chat.ts` — PI SDK 适配 (355 行)

核心适配层，连接 QuickForge 与 PI SDK:

- `initializePiStorage()` — 初始化 PI 存储系统
- `buildConnectionModel()` — 从 ConnectionForm 构建 Model 对象
- `resolveConfiguredModel()` — 解析配置中的活跃模型
- `getConfiguredModels()` — 获取所有可用模型 (内置 + 自定义)
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认参数管理
- `DEFAULT_CONNECTION` — LiteLLM 示例连接配置

### `server-agent.ts` — 服务器 Agent 客户端 (680 行)

SSE 客户端，与后端 Agent 通信:

- SSE 事件流连接/重连
- 支持直接后端连接 (绕过 Vite 代理，避免连接数限制)
- 会话状态管理: 创建、运行、中止、恢复
- YOLO 模式同步
- 消息/工具调用事件处理
- `fetchActiveAgentStatuses()` — 获取活跃 Agent 状态
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件

### `shared-server-agent.ts` — 分享对话 Agent (396 行)

与 `server-agent.ts` 类似，但用于加载分享的对话:

- 只读和操作模式
- SSE 流式加载分享对话
- 密码验证流程
- 消息/工具渲染支持

### `local-tools.ts` — 本地工具 UI 渲染器 (168 行)

注册工作区工具的自定义 UI 渲染器到 pi-web-ui:

- `list_dir`: 目录列表渲染
- `read_file`: 文件内容渲染
- `grep_files`: 搜索结果渲染
- `write_file`: 写入确认渲染
- `edit_file`: 文本差异渲染 (支持折叠/展开)
- `run_command`: 命令输出渲染
- `get_project_info`: 项目信息渲染

### `http-storage-backend.ts` — HTTP 存储后端 (201 行)

实现 PI SDK 的 `StorageBackend` 接口:

- 通过 REST API 与后端通信
- 支持 `blockedStores` 和 `storeOverrides`
- `fakeProviderKeys` — 模拟供应商密钥 (实际密钥存储在后端)
- 原子写入支持 (`transaction`)

### `types.ts` — 类型定义 (82 行)

TypeScript 类型定义:

- `ChatScope` — 'global' | 'project'
- `ProjectInfo` — 项目元数据
- `SkillSummary` — Skill 摘要
- `BackgroundTaskStatus` — 后台任务状态
- `QuickForgeSessionMetadata` / `QuickForgeSessionData` — 扩展的会话类型
- `BackgroundTask` — 后台任务结构
- `sessionScope()` / `sessionTitle()` — 辅助函数

### `message-utils.ts` — 消息工具 (129 行)

- `buildSystemPrompt()` — 构建系统提示词
- `generateTitle()` — AI 生成会话标题
- `titleNeedsGeneration()` — 判断是否需要生成标题
- `rollbackConversationFromMessage()` — 消息回滚
- `rollbackStartIndexFromMessage()` — 回滚起始索引
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 复制到剪贴板
- `assistantText()` — 提取助手回答文本
- `hasUserMessage()` — 检查是否有用户消息
- `shouldSaveSession()` — 判断会话是否应保存

### `reasoning-content-cache.ts` — 推理缓存 (277 行)

缓存和管理 LLM 推理内容字段 (`reasoning_content`, `reasoning`, `reasoning_text`):

- `restoreReasoningContentInPayload()` — 在请求负载中恢复推理内容
- `cacheReasoningContent()` — 缓存推理内容
- 处理流式推理 delta 合并
- `removeReasoningContent()` — 清理推理内容

### `custom-providers-only-tab.ts` — 自定义供应商 Tab (564 行)

Lit 自定义元素 (SettingsTab)，提供自定义 AI 供应商配置界面:

- 协议选择: OpenAI-compatible / Anthropic Messages
- Base URL / API Key / Headers 配置
- 模型列表管理 (增/删/改)
- 连接测试功能

### 其他设置 Tabs

- `default-options-settings-tab.ts` — 默认模型参数设置 (thinking level, temperature 等)
- `backup-settings-tab.ts` — 数据备份/恢复管理
- `service-settings-tab.ts` — 服务状态显示和重启
- `language-settings-tab.ts` — 语言切换

### `patch-thinking-selector.ts` (118 行)

- 在 pi-web-ui 的 `message-editor` 组件中注入 Thinking 级别选择器
- 替换默认的 Thinking 下拉框为自定义的增强版
- 使用 Lit 的 Select 组件 + Lucide icon

### `utils.ts` (7 行)

- `cn()` — Tailwind class 合并工具 (封装 `clsx` + `tailwind-merge`)
