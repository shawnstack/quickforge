# `src/lib/` — 前端工具库和模块

**路径**: `src/lib/`

包含 18 个工具模块，涵盖存储、聊天逻辑、本地工具、国际化等。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 871 | 国际化（中/英）翻译和语言管理 |
| `pi-chat.ts` | 355 | Pi Chat 初始化和模型管理 |
| `server-agent.ts` | 680 | Server Agent — 服务端 Agent 客户端 |
| `shared-server-agent.ts` | 396 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 168 | 前端本地工具渲染器注册 |
| `share-client.ts` | 145 | 分享功能客户端 API |
| `http-storage-backend.ts` | 201 | HTTP Storage Backend 实现 |
| `types.ts` | 82 | 类型定义 |
| `utils.ts` | 7 | 通用工具函数（cn） |
| `message-utils.ts` | 129 | 消息处理工具 |
| `reasoning-content-cache.ts` | 277 | DeepSeek 推理内容缓存 |
| `custom-model-selector.ts` | 163 | 自定义模型选择器 |
| `custom-providers-only-tab.ts` | 564 | 自定义供应商设置选项卡 |
| `service-settings-tab.ts` | 190 | 后端服务状态选项卡 |
| `backup-settings-tab.ts` | 188 | 数据备份/恢复选项卡 |
| `default-options-settings-tab.ts` | 208 | 默认选项设置选项卡 |
| `language-settings-tab.ts` | 67 | 语言设置选项卡 |
| `patch-thinking-selector.ts` | 102 | 思考模式选择器修补 |

---

## 核心模块

### i18n.ts (871 行)

**用途**: 国际化支持。包含中英文翻译字典和应用语言管理。

**功能**:
- 支持 `en` / `zh` 两种语言
- 提供 `t()` 翻译函数
- 语言初始化/应用函数
- 与 `pi-web-ui` 的翻译集成
- 日期区域设置

### pi-chat.ts (355 行)

**用途**: Pi Chat 的初始化和模型配置管理。

**功能**:
- `initializePiStorage()` — 初始化存储后端
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认选项管理
- `getConfiguredModels()` — 获取已配置的模型列表
- `defaultThinkingLevelForModel()` — 判断模型的默认思考级别
- `normalizeModelForProvider()` — 规范化模型配置
- DeepSeek V4 推理兼容性处理

### server-agent.ts (680 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**关键功能**:
- SSE 事件流管理（`GlobalAgentSseClient`）
- 消息发送/接收
- Agent 状态管理（创建、恢复、销毁）
- 系统提示词加载
- YOLO 模式切换
- 自定义命令注入

### shared-server-agent.ts (396 行)

**用途**: `SharedServerAgent` 类 — 共享会话的 Agent 客户端。

**功能**:
- 从共享状态恢复会话
- 只读/可操作模式
- 消息发送
- 回滚支持
- SSE 事件订阅

## 工具模块

### local-tools.ts (168 行)

**用途**: 在 `pi-web-ui` 中注册本地工具渲染器。

**支持的工具渲染**:
- `get_project_info` / `list_dir` / `read_file` / `grep_files` / `write_file` / `edit_file` / `run_command` / `activate_skill` / `read_skill_resource`
- Diff 格式渲染
- 工具调用状态显示

### share-client.ts (145 行)

**用途**: 分享功能客户端 API。

**功能**:
- `createConversationShare()` — 创建分享
- `listConversationShares()` — 列出分享
- `revokeConversationShare()` — 撤销分享
- `unlockSharedConversation()` — 解锁共享会话
- `loadSharedModelProviders()` — 加载共享模型供应商
- 密码生成工具

### http-storage-backend.ts (201 行)

**用途**: 通过 HTTP API 实现的 Storage Backend。

**功能**:
- 实现 `StorageBackend` 接口（keys、get、set、delete、transaction）
- 可配置的 `blockedStores`（阻止访问某些存储区域）
- 支持 `storeOverrides`（覆盖本地读取逻辑）
- 健康检查（`isAvailable()`）

### message-utils.ts (129 行)

**用途**: 消息处理工具函数。

**功能**:
- `buildSystemPrompt()` — 构建系统提示词
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成

### reasoning-content-cache.ts (277 行)

**用途**: DeepSeek V4 推理内容缓存。当 API 在工具调用轮次中剥离推理内容时，从 Agent 状态恢复。

**功能**:
- 识别 DeepSeek V4 思考模型
- 从之前消息中恢复 `reasoning_content`
- 缓存管理

### types.ts (82 行)

**用途**: 核心类型定义。

**类型**:
- `BackgroundTaskStatus`, `ChatScope`, `ProjectInfo`, `SkillsScope`, `SkillSummary`
- `RestoredDraft`, `QuickForgeSessionMetadata`, `QuickForgeSessionData`, `BackgroundTask`
- 工具函数：`sessionScope()`, `sessionTitle()`

### utils.ts (7 行)

**用途**: 导出 `cn()` 函数，结合 `clsx` 和 `tailwind-merge` 进行类名合并。

## 设置选项卡

src/lib 中的设置选项卡都继承自 `@mariozechner/pi-web-ui` 的 `SettingsTab` 类，使用 Lit HTML 渲染。

| 文件 | 用途 |
|------|------|
| `custom-providers-only-tab.ts` | 自定义模型供应商的完整 CRUD 管理界面 |
| `service-settings-tab.ts` | 显示后端服务状态（模式、PID、启动时间、数据目录），支持重启 |
| `backup-settings-tab.ts` | 数据备份导出和导入，支持全量/配置/会话三种范围 |
| `default-options-settings-tab.ts` | 设置默认模型和思考级别 |
| `language-settings-tab.ts` | 语言切换设置 |
| `patch-thinking-selector.ts` | 修补 pi-web-ui 的模型选择器，额外显示自定义模型供应商的模型 |
| `custom-model-selector.ts` | 自定义模型选择器对话框，支持搜索和编辑 |
