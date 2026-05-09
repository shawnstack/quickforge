# `server/` — Node.js 后端服务器

**路径**: `server/`

后端使用原生 Node.js HTTP 服务器（无 Express 等框架依赖）。提供 REST API、SSE 事件流、Agent 管理和存储服务。

## 目录结构

```
server/
├── index.mjs                 # 服务器入口（438行）
├── agent-manager.mjs         # Agent 生命周期管理（1101行）
├── storage.mjs               # 文件存储层（663行）
├── skills.mjs                # Agent Skills 管理和加载（540行）
├── share-store.mjs           # 分享数据存储（469行）
├── session-utils.mjs         # 会话工具（103行）
├── system-prompt.mjs         # 系统提示词合成（68行）
├── project-config.mjs        # 项目配置管理（156行）
├── conversation-compaction.mjs # 对话历史压缩（303行）
├── custom-commands.mjs       # 自定义命令系统（345行）
├── reasoning-cache.mjs       # 推理内容缓存（52行）
├── restart-supervisor.mjs    # 服务重启监控脚本（39行）
├── routes/                   # API 路由处理器
│   ├── agent.mjs             # Agent API（333行）
│   ├── storage.mjs           # Storage API（152行）
│   ├── project.mjs           # Project API（107行）
│   ├── filesystem.mjs        # 文件系统浏览 API（88行）
│   ├── tools.mjs             # 工具定义和执行 API（83行）
│   ├── skills.mjs            # Skills API（146行）
│   ├── scheduled-tasks.mjs   # 定时任务 API（803行）
│   ├── shares.mjs            # 分享管理 API（91行）
│   ├── shared-conversation.mjs # 共享会话查看 API（405行）
│   ├── backup.mjs            # 备份/恢复 API（251行）
│   ├── instructions.mjs      # 系统提示词 API（21行）
│   ├── system.mjs            # 系统状态/重启 API（36行）
│   └── static.mjs            # 静态文件服务（59行）
├── tools/
│   ├── index.mjs             # 工具处理器实现（375行）
│   └── definitions.mjs       # 工具定义规范（121行）
└── utils/
    ├── workspace.mjs         # 工作区路径工具（183行）
    ├── text-diff.mjs         # 文本差异算法（216行）
    ├── platform.mjs          # 平台特定操作（162行）
    ├── logger.mjs            # 日志系统（35行）
    ├── network.mjs           # 网络工具（39行）
    └── response.mjs          # HTTP 响应工具（43行）
```

---

## 核心模块

### index.mjs (438 行)

**用途**: 服务器入口 / 主路由分发。启动 HTTP 服务器，注册所有 API 路由。

**启动参数**:
- `--dev`: 开发模式
- 环境变量: `QUICKFORGE_PORT`, `QUICKFORGE_HOST`, `QUICKFORGE_DATA_DIR`, `QUICKFORGE_WORKSPACE_DIR`, `QUICKFORGE_SHARE_LAN`, `QUICKFORGE_ALLOW_REMOTE`

**主要功能**:
- HTTP 路由分发（基于 `url.pathname` 匹配）
- 中间件：CORS、JSON 请求体大小限制
- `GET /api/health` — 健康检查
- `GET /api/system/status` — 系统状态
- `POST /api/system/restart` — 重启服务器（通过子进程监控器）
- 静态文件服务（`serveStatic`）
- SSE（`/api/agents/events`, `/api/agents/:sessionId/stream`）
- 启动时重置僵死任务状态
- 支持 LAN 共享（显示局域网 URL）

### agent-manager.mjs (1101 行)

**用途**: Agent 生命周期管理。是后端最复杂的模块。

**功能**:
- Agent 创建（`createAgent`）：初始化 Agent 实例，配置工具和系统提示词
- 消息运行（`runPrompt`）：执行 AI 对话，管理消息历史
- SSE 事件流管理：向连接的客户端广播 Agent 事件
- 后台任务运行（`runTask` / `abortTask`）
- Agent 恢复（`restoreAgent`）：从持久化状态恢复会话
- 工具管理：基于 Skills 和 YOLO 模式动态构建工具列表
- 对话压缩（`compactConversation`）
- 自定义命令处理
- 工具权限检查
- 会话活动跟踪（`touchSession`）
- Agent 销毁和资源清理

### storage.mjs (663 行)

**用途**: 文件存储层。管理 JSON 文件的读写、存储布局迁移。

**存储位置**: `~/.quickforge/`

**目录结构**:
```
~/.quickforge/
├── config/config.json     # 配置数据（settings, provider-keys, custom-providers, projects）
├── storage/               # 会话数据和索引
│   ├── sessions/          # 按 scope/projectId 分桶的会话文件
│   ├── sessions-metadata/ # 会话元数据索引
│   └── shares/            # 分享数据
├── cache/                 # 缓存数据
└── logs/                  # 日志文件
```

**功能**:
- 存储布局迁移（v1 → v2）
- `readStore` / `writeStore` / `atomicUpdate` — 通用存储操作
- 会话分桶存储（按 scope 和 projectId）
- `readSessionStoreScoped` — 作用域会话查询
- 写操作的原子锁队列
- 目录大小计算

### skills.mjs (540 行)

**用途**: Agent Skills 的发现、加载和管理。

**搜索路径**:
1. `~/.quickforge/skills/` — 用户级全局 skills
2. `~/.agents/skills/` — 用户级共享 skills
3. `<workspace>/.ai/skills/` — 项目级 skills
4. 项目自带 bundled skills

**功能**:
- `listGlobalSkillSummaries()` / `listProjectSkillSummaries()` — 技能列表
- `loadSelectedGlobalSkills()` / `loadSelectedProjectSkills()` — 按选择加载
- `mergeSkills()` — 合并全局和项目 skills
- `readSkillResource()` — 读取技能资源文件
- Skill 验证（名称格式、目录结构）
- 技能名称规范化

### share-store.mjs (469 行)

**用途**: 对话分享的持久化和访问控制。

**功能**:
- `createConversationShare()` — 创建分享
- `listConversationShares()` — 列出分享
- `revokeConversationShare()` — 撤销分享
- 密码哈希验证（scrypt）
- 令牌认证（7天有效期）
- 口令保护
- 写操作队列

### session-utils.mjs (103 行)

**用途**: 会话工具函数。

**功能**:
- `buildSystemPrompt()` — 构建系统提示词
- `generateTitle()` — 基于用户消息生成标题
- `generateAiTitle()` — AI 自动生成标题

### system-prompt.mjs (68 行)

**用途**: 合成系统提示词。将基础提示词、用户指令、项目指令和 Skills 目录组装成完整的系统提示词。

**关键内容**: `BASE_SYSTEM_PROMPT` — 基础系统提示词模板。

### project-config.mjs (156 行)

**用途**: 项目配置管理（在 `config/config.json` 的 `projects` 数组中）。

**功能**:
- `readProjectConfig()` / `getActiveProject()` — 读取配置
- `setActiveProjectPath()` — 设置/添加项目
- `projectContextFromId()` — 获取项目上下文
- `buildInstructionsPayload()` — 构建指令载荷（含 skills 内容）

### conversation-compaction.mjs (303 行)

**用途**: 对话历史压缩。使用 AI 将长对话压缩为精炼摘要。

**功能**:
- `compactConversation()` — 执行压缩
- `parseCompactArgs()` — 解析压缩参数
- `saveCompactBackup()` — 保存压缩前备份
- 支持自定义保留轮次

### custom-commands.mjs (345 行)

**用途**: 自定义命令系统。从 `<workspace>/.ai/commands/` 读取命令定义。

**命令格式**: Markdown 文件 + YAML frontmatter
```yaml
---
description: 命令描述
argumentHint: 参数提示
allowEdit: true/false
allowCommands: true/false
---
命令执行提示词...
```

**功能**:
- `listProjectCommands()` — 列出命令
- `readProjectCommand()` — 读取命令详情
- `resolveCustomCommandInvocation()` — 解析命令调用
- `handleInternalCommand()` — 处理内置命令（/compact, /clear, /forget, /yolo, /skills）

### reasoning-cache.mjs (52 行)

**用途**: DeepSeek V4 推理内容缓存。在工具调用轮次后恢复被 API 剥离的推理内容。

### restart-supervisor.mjs (39 行)

**用途**: 服务重启监控脚本。等待旧进程退出后启动新进程。
