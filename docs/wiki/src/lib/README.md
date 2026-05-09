# `src/lib/` — 前端工具库

包含 18 个工具模块，涵盖存储、聊天逻辑、本地工具、国际化等。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 870 | 国际化（中/英）翻译和语言管理 |
| `pi-chat.ts` | 354 | Pi Chat 初始化和模型管理 |
| `server-agent.ts` | 679 | Server Agent — 服务端 Agent 客户端 |
| `shared-server-agent.ts` | 395 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 167 | 前端本地工具渲染器注册 |
| `share-client.ts` | 144 | 分享功能客户端 API |
| `http-storage-backend.ts` | 200 | HTTP Storage Backend 实现 |
| `types.ts` | 81 | 类型定义 |
| `utils.ts` | 6 | 通用工具函数（cn） |
| `message-utils.ts` | 128 | 消息处理工具 |
| `reasoning-content-cache.ts` | 276 | DeepSeek 推理内容缓存 |
| `custom-model-selector.ts` | 162 | 自定义模型选择器 |
| `custom-providers-only-tab.ts` | 563 | 自定义供应商设置选项卡 |
| `service-settings-tab.ts` | 189 | 后端服务状态选项卡 |
| `backup-settings-tab.ts` | 187 | 数据备份/恢复选项卡 |
| `default-options-settings-tab.ts` | 207 | 默认选项设置选项卡 |
| `language-settings-tab.ts` | 66 | 语言设置选项卡 |
| `patch-thinking-selector.ts` | 117 | 思考模式选择器修补 |

---

## 核心模块

### i18n.ts (870 行)

**用途**: 国际化支持。包含中英文翻译字典和应用语言管理。

**功能**:
- 支持 `en` / `zh` 两种语言
- 提供 `t()` 翻译函数
- 语言初始化/应用函数
- 与 `pi-web-ui` 的翻译集成
- 日期区域设置

### pi-chat.ts (354 行)

**用途**: Pi Chat 的初始化和模型配置管理。

**功能**:
- `initializePiStorage()` — 初始化存储后端
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认选项管理
- `getConfiguredModels()` — 获取已配置的模型列表
- DeepSeek V4 推理兼容性处理

### server-agent.ts (679 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**关键功能**:
- SSE 事件流管理（`GlobalAgentSseClient`）
- 消息发送/接收
- Agent 状态管理（创建、恢复、销毁）
- 系统提示词加载
- YOLO 模式切换
- 自定义命令注入
- 支持直接后端连接（绕过 Vite 代理）

### shared-server-agent.ts (395 行)

**用途**: `SharedServerAgent` 类 — 共享会话的 Agent 客户端。

**功能**:
- 从共享状态恢复会话
- 只读/可操作模式
- 消息发送
- 回滚支持
- SSE 事件订阅

## 工具模块

### local-tools.ts (167 行)

**用途**: 在 `pi-web-ui` 中注册本地工具渲染器。

**支持的工具渲染**: `get_project_info`, `list_dir`, `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command`, `activate_skill`, `read_skill_resource`

### http-storage-backend.ts (200 行)

**用途**: 通过 HTTP API 实现的 Storage Backend。

**功能**:
- 实现 `StorageBackend` 接口
- 可配置的 `blockedStores`（阻止访问某些存储区域）
- 支持 `storeOverrides`（覆盖本地读取逻辑）
- 健康检查（`isAvailable()`）
- `fakeProviderKeys` — 模拟供应商密钥

### types.ts (81 行)

**类型**: `BackgroundTaskStatus`, `ChatScope`, `ProjectInfo`, `SkillsScope`, `SkillSummary`, `RestoredDraft`, `QuickForgeSessionMetadata`, `QuickForgeSessionData`, `BackgroundTask`

### utils.ts (6 行)

- `cn()` — Tailwind class 合并工具 (封装 `clsx` + `tailwind-merge`)

## 设置选项卡

所有设置选项卡继承自 `@mariozechner/pi-web-ui` 的 `SettingsTab` 类，使用 Lit HTML 渲染。

| 文件 | 用途 |
|------|------|
| `custom-providers-only-tab.ts` | 自定义模型供应商的完整 CRUD 管理界面 |
| `service-settings-tab.ts` | 显示后端服务状态，支持重启 |
| `backup-settings-tab.ts` | 数据备份导出和导入 |
| `default-options-settings-tab.ts` | 设置默认模型和思考级别 |
| `language-settings-tab.ts` | 语言切换设置 |
| `patch-thinking-selector.ts` | 修补 pi-web-ui 的模型选择器 |
| `custom-model-selector.ts` | 自定义模型选择器对话框 |

### reasoning-content-cache.ts (276 行)

**用途**: DeepSeek V4 推理内容缓存。当 API 在工具调用轮次中剥离推理内容时，从 Agent 状态恢复。

### message-utils.ts (128 行)

**用途**: 消息处理工具函数。

**功能**:
- `buildSystemPrompt()` — 构建系统提示词
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成
