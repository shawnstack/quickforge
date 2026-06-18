# `src/lib/` — 前端工具库

包含 24 个工具模块，涵盖存储、聊天逻辑、本地工具、国际化、设置选项卡等。

---

| 文件 | 行数 | 用途 |
|------|------|------|
| `i18n.ts` | 1072 | 国际化（中/英）翻译和语言管理 |
| `pi-chat.ts` | 365 | Pi Chat 初始化和模型管理 |
| `server-agent.ts` | 832 | Server Agent — 服务端 Agent 客户端 |
| `shared-server-agent.ts` | 429 | 共享会话 Agent 客户端 |
| `local-tools.ts` | 247 | 前端本地工具渲染器注册 |
| `share-client.ts` | 148 | 分享功能客户端 API |
| `http-storage-backend.ts` | 200 | HTTP Storage Backend 实现 |
| `types.ts` | 82 | 类型定义 |
| `utils.ts` | 6 | 通用工具函数（cn） |
| `message-utils.ts` | 127 | 消息处理工具 |
| `custom-model-selector.ts` | 162 | 自定义模型选择器 |
| `custom-providers-only-tab.ts` | 565 | 自定义供应商设置选项卡 |
| `service-settings-tab.ts` | 189 | 后端服务状态选项卡 |
| `backup-settings-tab.ts` | 372 | 数据备份/恢复选项卡 |
| `default-options-settings-tab.ts` | 257 | 默认选项设置选项卡 |
| `language-settings-tab.ts` | 66 | 语言设置选项卡 |
| `lan-access-settings-tab.ts` | 227 | LAN 共享设置选项卡 |
| `patch-thinking-selector.ts` | 117 | 思考模式选择器修补 |
| `clipboard-polyfill.ts` | 51 | 剪贴板 API polyfill |
| `logger.ts` | 56 | 前端日志工具 |
| `random-id.ts` | 19 | UUID 生成 |
| `tool-display-settings.ts` | 40 | 工具展示设置 |
| `tool-execution-events.ts` | 120 | 工具执行事件处理 |
| `info-tip.ts` | 134 | 统一问号说明浮层 Web Component |

---

## 核心模块

### i18n.ts (1072 行)

**用途**: 国际化支持。包含中英文翻译字典和应用语言管理。

**功能**:
- 支持 `en` / `zh` 两种语言
- 提供 `t()` 翻译函数
- 语言初始化/应用函数
- 与 `pi-web-ui` 的翻译集成
- 日期区域设置

### pi-chat.ts (365 行)

**用途**: Pi Chat 的初始化和模型配置管理。

**功能**:
- `initializePiStorage()` — 初始化存储后端
- `loadDefaultOptions()` / `saveDefaultOptions()` — 默认选项管理
- `getConfiguredModels()` — 获取已配置的模型列表
- DeepSeek V4 推理兼容性处理

### server-agent.ts (832 行)

**用途**: `ServerAgent` 类 — 与服务端 Agent 通信的客户端。

**关键功能**:
- SSE 事件流管理（`GlobalAgentSseClient`）
- 消息发送/接收
- Agent 状态管理（创建、恢复、销毁）
- 系统提示词加载
- YOLO 模式切换
- 自定义命令注入
- 支持直接后端连接（绕过 Vite 代理）

### shared-server-agent.ts (429 行)

**用途**: `SharedServerAgent` 类 — 共享会话的 Agent 客户端。

**功能**:
- 从共享状态恢复会话
- 只读/可操作模式
- 消息发送
- 回滚支持
- SSE 事件订阅

## 工具模块

### local-tools.ts (247 行)

**用途**: 在 `pi-web-ui` 中注册本地工具渲染器；`run_command` 运行中会显示图标按钮，通过 `/api/agents/:sessionId/abort-tool` 手动结束当前命令；`run_subagent` 以专属可折叠卡片展示 subagent 名称、任务、工具调用数、允许工具和结果摘要。

**支持的工具渲染**: `run_subagent`, `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command`, `activate_skill`, `read_skill_resource`

### http-storage-backend.ts (200 行)

**用途**: 通过 HTTP API 实现的 Storage Backend。

**功能**:
- 实现 `StorageBackend` 接口
- 可配置的 `blockedStores`（阻止访问某些存储区域）
- 支持 `storeOverrides`（覆盖本地读取逻辑）
- 健康检查（`isAvailable()`）
- `fakeProviderKeys` — 模拟供应商密钥

### types.ts (82 行)

**类型**: `BackgroundTaskStatus`, `ChatScope`, `ProjectInfo`, `SkillsScope`, `SkillSummary`, `RestoredDraft`, `QuickForgeSessionMetadata`, `QuickForgeSessionData`, `BackgroundTask`

### utils.ts (6 行)

- `cn()` — Tailwind class 合并工具 (封装 `clsx` + `tailwind-merge`)

### clipboard-polyfill.ts (51 行)

**用途**: 为非安全上下文 (HTTP) 提供剪贴板 API polyfill。当 `navigator.clipboard` 不可用时，回退到 `document.execCommand('copy')`。

### logger.ts (56 行)

**用途**: 前端日志工具，支持 `error`/`warn`/`info`/`debug` 级别，`debug` 级别需在 localStorage 设置 `quickforge_debug=1`。

### random-id.ts (19 行)

**用途**: 生成 UUID v4，优先使用 `crypto.randomUUID()`，回退到手动构造。

### tool-display-settings.ts (40 行)

**用途**: 工具展示设置管理（显示工具详情、默认展开工具）。

### tool-execution-events.ts (120 行)

**用途**: 工具执行事件类型定义和消息合并工具。

**功能**:
- `QuickForgeToolTiming` / `ToolExecutionEvent` 类型
- `upsertMessage()` — 根据 `toolCallId` 合并或替换工具结果消息
- `toolStartEventWithPartialResult()` / `upsertToolResult()` — 在运行中工具结果里保留计时、`sessionId` 和 `toolCallId`，用于前端展示耗时和结束运行中的 `run_command`。

### info-tip.ts (134 行)

**用途**: 统一的问号说明浮层组件，封装为 Web Component `<quickforge-info-tip>`。用于将大段辅助说明收拢到标题/字段旁的 `?` 图标中，hover / focus / click 时展开。

**特性**:
- 基于 `LitElement`，使用 light DOM（`createRenderRoot` 返回 `this`），Tailwind class 与全局 CSS 变量直接生效。
- 渲染弱化 `?` 图标；hover（150ms 延迟）/ focus 展开，click 切换，外部 pointerdown / Escape 关闭。
- 仅 `label` 属性（说明文案，为空则不弹出）；`aria-label` / `aria-expanded` / `role="tooltip"` 支持可访问性。
- 幂等注册（`customElements.get` 守卫）。
- 双端可用：Lit 模板用 `.label` 属性绑定，React 用 `label` prop。

**样式**: 定义在 `src/index.css`（`.quickforge-info-tip*`），复用全局 `--popover` / `--border` 变量与轻阴影，不引入新的视觉模式。

**首个使用点**: `project-commands-settings-tab.ts`（标题旁收拢 `projectCommandsDescription`）。设计约定见 `DESIGN_LANGUAGE.md`「辅助说明统一使用 `<quickforge-info-tip>`」。

## 设置选项卡

所有设置选项卡继承自 `@earendil-works/pi-web-ui` 的 `SettingsTab` 类，使用 Lit HTML 渲染。

| 文件 | 用途 |
|------|------|
| `custom-providers-only-tab.ts` | 自定义模型供应商的完整 CRUD 管理界面 |
| `lan-access-settings-tab.ts` | LAN 共享设置（启用/禁用、密码、会话 TTL） |
| `service-settings-tab.ts` | 显示后端服务状态、支持重启，并以轻量列表管理自动识别的终端 Shell profiles 和自定义 Shell 命令 |
| `backup-settings-tab.ts` | 数据备份导出和导入 |
| `default-options-settings-tab.ts` | 设置默认模型和思考级别 |
| `language-settings-tab.ts` | 语言切换设置 |
| `project-commands-settings-tab.ts` | 项目命令目录配置 + 命令预览 + 新建命令 |
| `patch-thinking-selector.ts` | 修补 pi-web-ui 的模型选择器 |
| `custom-model-selector.ts` | 自定义模型选择器对话框 |

### message-utils.ts (127 行)

**用途**: 消息处理工具函数。

**功能**:
- `buildSystemPrompt()` — 构建系统提示词
- `assistantText()` — 提取助手消息文本
- `rollbackStartIndexFromMessage()` — 计算回滚起点
- `draftTextFromUserMessage()` — 从用户消息提取草稿
- `copyTextToClipboard()` — 剪贴板复制
- `generateTitle()` / `titleNeedsGeneration()` — 标题生成
