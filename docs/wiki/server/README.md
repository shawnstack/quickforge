# `server/` — 后端服务

基于 Node.js ESM 的本地 HTTP 服务，负责 Agent 管理、存储、SSE 推送、工具执行和路由分发。

## 目录结构

```
server/
├── index.mjs                  # HTTP 服务入口 (438 行)
├── agent-manager.mjs          # Agent 全生命周期管理 (1101 行)
├── storage.mjs                # 本地 JSON 文件存储引擎 (663 行)
├── skills.mjs                 # Skills 加载/合并/资源管理 (540 行)
├── share-store.mjs            # 对话分享存储 (469 行)
├── conversation-compaction.mjs# 历史对话压缩 (303 行)
├── custom-commands.mjs        # 自定义命令支持 (345 行)
├── project-config.mjs         # 项目配置管理 (160 行)
├── reasoning-cache.mjs        # 推理内容缓存 (65 行)
├── session-utils.mjs          # 会话工具函数 (115 行)
├── system-prompt.mjs          # 系统提示词构建 (80 行)
├── restart-supervisor.mjs     # 重启监护进程 (24 行)
├── routes/                    # API 路由处理
├── tools/                     # 工作区工具定义和实现
└── utils/                     # 工具函数
```

## 核心模块说明

### `index.mjs` — HTTP 服务入口

- 使用 `node:http` 创建 HTTP 服务器
- 统一路由分发 (REST + SSE)
- 请求体大小限制 (默认 50MB)
- 支持开发模式 (`--dev`) 和生产模式
- 启动时初始化存储目录和项目配置
- 支持 LAN 共享 (`QUICKFORGE_SHARE_LAN`)
- 进程守护: 自动清理过期会话锁定，挂起请求退出前等待 Agent 完成

### `agent-manager.mjs` — Agent 管理器

- **1101 行**，项目最大文件
- 基于 `@mariozechner/pi-agent-core` 的 `Agent` 类
- 功能:
  - Agent 创建/销毁/恢复
  - SSE 事件流推送
  - 工具调用桥接 (server-side, 无 REST 往返)
  - 会话持久化
  - 自定义命令/内联命令处理
  - 对话压缩 (compact) 支持
  - YOLO 模式切换
  - 会话锁定机制

### `storage.mjs` — 存储引擎

- 基于本地 JSON 文件的 KV 存储
- 存储类型: `settings`, `provider-keys`, `custom-providers`, `sessions`, `sessions-metadata`, `scheduled-tasks`
- 配置存储和会话存储分离
- 原子写入队列 (`atomicUpdate`)
- Session 桶索引 (session bucket index) 内存缓存

### `skills.mjs` — Skills 管理

- 从多个来源加载 Skills: 内置 (项目内 `skills/` 目录)、用户自定义 (`~/.quickforge/skills/`)、共享 (`~/.agents/skills/`)
- 支持 Skills 合并、选择、资源文件读取
- Skill 名称校验 (小写字母数字+连字符)
- 工作区级 Skill 加载 (`.quickforge/skills/`)
- 资源文件限制 (最多 200 个文件)

### `share-store.mjs` — 对话分享存储

- 对话分享的创建、加密、验证
- 基于 scrypt 的密码哈希
- 分享 Token 最大 7 天有效
- 最大 50 个活跃分享 Token
- 写操作排队 (write queue)

### `conversation-compaction.mjs` — 对话压缩

- 自动压缩长对话历史以减少 Token 消耗
- 使用 AI 模型生成对话摘要 (中文 Prompt)
- 支持 `compact` 命令手动触发
- 压缩前自动备份

### `custom-commands.mjs` — 自定义命令

- 从 `.ai/commands/` 目录加载自定义命令
- 支持 Frontmatter 元数据 (`---` 格式)
- 命令模板中可使用 `{argument}` 占位符
- 内置命令: `compact`, `think`, `quick-command`

### `project-config.mjs` — 项目配置

- 读取/写入项目配置文件 (`~/.quickforge/config/projects.json`)
- 管理活跃项目切换
- 项目 ID、名称、路径、Skills 等元数据管理

### `reasoning-cache.mjs` — 推理缓存

- 缓存 LLM 推理过程内容 (reasoning_content)
- 在后续请求中恢复推理内容到消息负载中
- 优化流式推理体验

### `session-utils.mjs` — 会话工具

- 构建系统提示词 (System Prompt)
- AI 生成对话标题
- 合并全局/项目级别的指令和 Skills

### `system-prompt.mjs` — 系统提示词

- 默认系统提示词定义
- YOLO 模式工具说明
- 语言偏好

### `restart-supervisor.mjs` — 重启监护

- 分离进程，用于重启时保证旧进程退出前新进程已就绪

---

## API 路由 (routes/)

参见 [routes/ 文档](routes/)。

## 工作区工具 (tools/)

参见 [tools/ 文档](tools/)。

## 工具函数 (utils/)

参见 [utils/ 文档](utils/)。
