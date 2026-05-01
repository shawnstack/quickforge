# 本地配置、会话存储、项目隔离与缓存目录架构设计

> 状态：已确认并按本文档实现。
>
> 约定：不使用 `v1` 版本路径。默认数据根目录为 `~/.quickforge/`，可通过 `QUICKFORGE_DATA_DIR` 覆盖。

## 1. 设计目标

1. **统一配置入口**：所有配置集中到顶层 `config/config.json`，包括应用设置、自定义提供商、Provider API Key、项目列表。
2. **会话与配置分离**：`storage/` 只保存会话等业务持久数据，不再保存 provider/config/project 配置。
3. **项目会话物理隔离**：每个项目的对话 session 单独落到项目目录下。
4. **全局对话与项目对话分离**：未绑定项目的普通对话放到 `storage/conversations/global/`，项目对话放到 `storage/conversations/projects/<projectId>/`。
5. **缓存可删除**：`cache/` 只保存可重建数据，删除后不影响配置、API Key、项目列表、会话历史。
6. **兼容旧数据**：支持从旧扁平 `storage/*.json` 与上一版分层 `storage/config|credentials|providers|projects` 迁移。
7. **前端接口保持稳定**：前端仍通过现有 `/api/storage/...` 与 storeName 访问，不直接感知磁盘目录变化。

## 2. 最终目录布局

```text
~/.quickforge/
├── quickforge.pid
├── config/
│   └── config.json
├── storage/
│   └── conversations/
│       ├── global/
│       │   ├── sessions.json
│       │   └── sessions-metadata.json
│       └── projects/
│           └── <projectId>/
│               ├── sessions.json
│               └── sessions-metadata.json
├── cache/
│   ├── global/
│   │   ├── llm/
│   │   └── tmp/
│   └── projects/
│       └── <projectId>/
│           ├── workspace/
│           │   ├── file-index/
│           │   └── grep/
│           ├── llm/
│           │   ├── responses/
│           │   └── reasoning/
│           ├── assets/
│           └── tmp/
└── logs/
```

目录职责：

| 目录/文件 | 职责 | 是否可删除 |
|---|---|---|
| `config/config.json` | 统一配置：设置、Provider、API Key、项目列表 | 否 |
| `storage/conversations/` | 全局与项目会话数据 | 否 |
| `cache/` | 可重建缓存 | 是 |
| `logs/` | 本地日志 | 可按策略清理 |
| `quickforge.pid` | 后台服务 PID | 由程序管理 |

> 安全提示：`config/config.json` 包含 `credentials.providerKeys`，整个文件都应视为敏感文件，不应分享或提交到代码仓库。

## 3. `config/config.json` 设计

### 3.1 总体结构

```json
{
  "layoutVersion": 1,
  "updatedAt": "2026-05-01T00:00:00.000Z",
  "app": {
    "settings": {}
  },
  "providers": {
    "customProviders": {}
  },
  "credentials": {
    "providerKeys": {}
  },
  "projects": {
    "activeProjectId": null,
    "projects": []
  }
}
```

逻辑类型：

```ts
type QuickForgeConfigFile = {
  layoutVersion: number
  updatedAt: string
  app: {
    settings: Record<string, unknown>
  }
  providers: {
    customProviders: Record<string, CustomProvider>
  }
  credentials: {
    providerKeys: Record<string, string>
  }
  projects: {
    activeProjectId: string | null
    projects: ProjectInfo[]
  }
}
```

### 3.2 应用设置：`app.settings`

对应前端 storeName：`settings`。

保存内容包括：

- 当前激活模型；
- YOLO 模式开关；
- 应用语言；
- proxy 配置；
- UI 偏好；
- 其他非敏感应用设置。

示例：

```json
{
  "app": {
    "settings": {
      "quickforge.yoloMode": true,
      "quickforge.language": "zh-CN",
      "proxy.enabled": false,
      "proxy.url": ""
    }
  }
}
```

### 3.3 自定义提供商：`providers.customProviders`

对应前端 storeName：`custom-providers`。

保存内容包括：

- provider id；
- provider name；
- baseUrl；
- protocol/type；
- models；
- model reasoning 配置；
- thinkingFormat 等兼容信息。

示例：

```json
{
  "providers": {
    "customProviders": {
      "provider-id-1": {
        "id": "provider-id-1",
        "name": "LiteLLM",
        "baseUrl": "http://localhost:4000/v1",
        "type": "openai-completions",
        "models": []
      }
    }
  }
}
```

### 3.4 Provider API Key：`credentials.providerKeys`

对应前端 storeName：`provider-keys`。

示例：

```json
{
  "credentials": {
    "providerKeys": {
      "LiteLLM": "sk-..."
    }
  }
}
```

约束：

- API Key 不进入 `cache/`、`storage/conversations/`、`logs/`。
- `customProviders` 中不应长期保存 API Key；密钥应以 `credentials.providerKeys` 为准。
- 由于 API Key 与普通配置在同一文件，`config/config.json` 整体视为敏感文件。

### 3.5 项目配置：`projects`

原 `project.json` 已合并到 `config/config.json -> projects`。

```ts
type ProjectInfo = {
  id: string
  name: string
  path: string
  lastOpenedAt: string
}

type ProjectsConfig = {
  activeProjectId: string | null
  projects: ProjectInfo[]
}
```

约束：

- `id` 当前由 `crypto.randomUUID()` 生成，适合作为目录名。
- `path` 是用户本机路径，跨机器迁移后可能失效。
- 删除项目列表项默认不删除项目会话目录。

## 4. 会话存储设计

### 4.1 全局会话

```text
storage/conversations/global/
├── sessions.json
└── sessions-metadata.json
```

语义：

```ts
scope !== 'project'
```

或缺省视为：

```ts
scope: 'global'
```

### 4.2 项目会话

```text
storage/conversations/projects/<projectId>/
├── sessions.json
└── sessions-metadata.json
```

语义：

```ts
scope: 'project'
projectId: '<projectId>'
```

好处：

- 每个项目的对话在磁盘上物理隔离。
- 备份、导出、归档单个项目会话更容易。
- 项目缓存和项目会话都可按同一个 `projectId` 对齐。

### 4.3 `sessions.json`

```ts
type SessionsFile = Record<string, QuickForgeSessionData>

type QuickForgeSessionData = {
  id: string
  title: string
  model: unknown
  thinkingLevel?: string
  messages: unknown[]
  createdAt: string
  lastModified: string
  scope?: 'global' | 'project'
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: 'running' | 'idle' | 'error' | 'aborted'
  taskStartedAt?: string
  taskFinishedAt?: string
}
```

### 4.4 `sessions-metadata.json`

```ts
type SessionsMetadataFile = Record<string, QuickForgeSessionMetadata>

type QuickForgeSessionMetadata = {
  id: string
  title: string
  createdAt: string
  lastModified: string
  messageCount: number
  usage?: unknown
  thinkingLevel?: string
  preview?: string
  scope?: 'global' | 'project'
  projectId?: string
  projectName?: string
  projectPath?: string
  taskStatus?: 'running' | 'idle' | 'error' | 'aborted'
  taskStartedAt?: string
  taskFinishedAt?: string
}
```

## 5. API 与 storeName 映射

前端 storeName 保持不变。

| storeName | 新物理位置 |
|---|---|
| `settings` | `config/config.json -> app.settings` |
| `provider-keys` | `config/config.json -> credentials.providerKeys` |
| `custom-providers` | `config/config.json -> providers.customProviders` |
| `sessions` | `storage/conversations/global/sessions.json` 或 `storage/conversations/projects/<projectId>/sessions.json` |
| `sessions-metadata` | `storage/conversations/global/sessions-metadata.json` 或 `storage/conversations/projects/<projectId>/sessions-metadata.json` |

项目配置不是前端 storeName，但服务端读写：

```text
config/config.json -> projects
```

### 5.1 Storage API

| 方法 | 路径 | 语义 |
|---|---|---|
| `GET` | `/api/storage/quota` | 获取本地数据占用 |
| `GET` | `/api/storage/:store/keys?prefix=` | 获取 store key 列表 |
| `GET` | `/api/storage/:store/index/:indexName?direction=` | 按字段排序获取 store values |
| `DELETE` | `/api/storage/:store` | 清空 store |
| `GET` | `/api/storage/:store/has/:key` | 判断 key 是否存在 |
| `GET` | `/api/storage/:store/key/:key` | 获取单个 value |
| `PUT` | `/api/storage/:store/key/:key` | 写入单个 value |
| `DELETE` | `/api/storage/:store/key/:key` | 删除单个 value |

### 5.2 Config store 写入规则

`settings`、`provider-keys`、`custom-providers` 都写同一个 `config/config.json`，但只更新自己的 section：

- 写 `settings`：只更新 `app.settings`；
- 写 `provider-keys`：只更新 `credentials.providerKeys`；
- 写 `custom-providers`：只更新 `providers.customProviders`；
- 写项目配置：只更新 `projects`。

所有 config 写入使用同一个写队列，避免并发覆盖。

### 5.3 Session store 分发规则

读取：

1. 读取 `storage/conversations/global/<store>.json`。
2. 遍历 `storage/conversations/projects/*/<store>.json`。
3. 合并成一个逻辑对象返回给前端。

写入：

1. 遍历传入对象中的每个 value。
2. 根据 `scope/projectId` 分桶。
3. 全局桶写入 `storage/conversations/global/<store>.json`。
4. 项目桶写入 `storage/conversations/projects/<projectId>/<store>.json`。
5. 如果某个旧桶中的 key 已不在传入对象中，则从该桶文件中移除，保证删除操作生效。

## 6. 迁移策略

### 6.1 支持的旧布局 A：最早扁平 storage

```text
storage/settings.json
storage/provider-keys.json
storage/custom-providers.json
storage/project.json
storage/sessions.json
storage/sessions-metadata.json
```

迁移映射：

| 旧路径 | 新位置 |
|---|---|
| `storage/settings.json` | `config/config.json -> app.settings` |
| `storage/provider-keys.json` | `config/config.json -> credentials.providerKeys` |
| `storage/custom-providers.json` | `config/config.json -> providers.customProviders` |
| `storage/project.json` | `config/config.json -> projects` |
| `storage/sessions.json` | 拆到 `storage/conversations/global/` 或 `storage/conversations/projects/<projectId>/` |
| `storage/sessions-metadata.json` | 拆到 `storage/conversations/global/` 或 `storage/conversations/projects/<projectId>/` |

### 6.2 支持的旧布局 B：上一版分层 storage

```text
storage/config/settings.json
storage/credentials/provider-keys.json
storage/providers/custom-providers.json
storage/projects/project.json
storage/conversations/...
```

迁移映射：

| 旧路径 | 新位置 |
|---|---|
| `storage/config/settings.json` | `config/config.json -> app.settings` |
| `storage/credentials/provider-keys.json` | `config/config.json -> credentials.providerKeys` |
| `storage/providers/custom-providers.json` | `config/config.json -> providers.customProviders` |
| `storage/projects/project.json` | `config/config.json -> projects` |
| `storage/conversations/...` | 保持不动 |

### 6.3 迁移标记

配置迁移成功后写入：

```text
config/.layout-migrated
```

旧扁平 session 迁移成功后写入/保留：

```text
storage/.layout-migrated
```

目的：

- 避免每次启动都从旧文件重新导入。
- 避免用户删除新结构中的 session 后，旧文件里的同名 session 再次“复活”。

### 6.4 冲突合并规则

配置合并优先级：

```text
旧扁平 storage < 上一版分层 storage < 当前 config/config.json
```

即新结构已有内容优先，迁移不会覆盖用户已经在新结构中产生的数据。

### 6.5 失败处理

- 如果迁移中途失败，不写迁移标记。
- 下次启动会重新尝试迁移。
- 旧文件暂不删除，降低回滚风险。
- JSON 解析失败时抛出错误，避免静默覆盖坏数据。

## 7. 写入安全与一致性

### 7.1 Config 写队列

`settings`、`provider-keys`、`custom-providers`、`projects` 都写同一个 `config/config.json`，所以使用统一队列：

```ts
writeQueues['config']
```

确保 config section 更新串行执行。

### 7.2 Session 写队列

会话正文与 metadata 分别使用 storeName 级别队列：

```ts
writeQueues['sessions']
writeQueues['sessions-metadata']
```

### 7.3 原子写入

所有 JSON 写入使用临时文件加 rename：

```text
<file>.<pid>.<timestamp>.tmp -> <file>
```

避免进程崩溃时留下半截 JSON。

### 7.4 一致性边界

当前不提供跨 store 事务。例如 `sessions.json` 与 `sessions-metadata.json` 是两次独立写入。若中途失败，可能短暂不一致。后续如需强一致，可引入 session 单文件结构或事务日志。

## 8. 缓存设计

当前代码创建缓存目录，但尚未写入真实业务缓存。

```text
cache/global/llm/
cache/global/tmp/
cache/projects/<projectId>/workspace/file-index/
cache/projects/<projectId>/workspace/grep/
cache/projects/<projectId>/llm/responses/
cache/projects/<projectId>/llm/reasoning/
cache/projects/<projectId>/assets/
cache/projects/<projectId>/tmp/
```

写入原则：

1. 缓存可重建。
2. 删除 `cache/` 不影响 `config/config.json` 与 `storage/conversations/`。
3. 不保存 provider API Key、OAuth token 等敏感凭证。
4. 项目相关缓存必须落到 `cache/projects/<projectId>/`。

建议清理策略：

| 缓存类型 | 建议清理策略 |
|---|---|
| `tmp/` | 启动时清理超过 24 小时的文件 |
| `workspace/file-index/` | 工作区路径或文件 mtime 变化时重建 |
| `workspace/grep/` | 短 TTL，例如 5-30 分钟 |
| `llm/responses/` | 默认不开启；开启后设置容量上限与 TTL |
| `llm/reasoning/` | 默认不开启持久化；如启用，TTL 应短于会话历史 |
| `assets/` | LRU 或容量上限清理 |

## 9. 安全边界

1. `config/config.json` 包含 API Key，整体视为敏感文件。
2. API Key 不进入 `cache/`、`storage/conversations/`、`logs/`。
3. `projectId` 作为目录名必须校验，禁止 `/`、`\\`、`.`、`..`。
4. 会话可能包含代码片段、工具调用结果、本机路径，也属于敏感持久数据。
5. 日志不应默认打印完整会话内容或 API Key。

## 10. 备份与恢复

### 10.1 全量备份

备份整个：

```text
~/.quickforge/
```

包含配置、API Key、项目列表、全局会话、项目会话、缓存和日志。

### 10.2 配置备份

只备份配置：

```text
config/config.json
```

注意该文件包含 API Key。

### 10.3 会话备份

全局会话：

```text
storage/conversations/global/
```

单项目会话：

```text
storage/conversations/projects/<projectId>/
```

恢复单项目会话时，还需要 `config/config.json -> projects` 中存在对应项目记录，或通过 UI 重新选择项目路径。

## 11. 测试计划

### 11.1 新用户首次启动

期望：

- 自动创建 `config/config.json`。
- 自动创建 `storage/conversations/global/` 与 `storage/conversations/projects/`。
- 自动创建基础 `cache/` 与 `logs/` 目录。
- 默认 JSON 文件合法。

### 11.2 旧用户迁移

准备旧扁平或上一版分层文件，期望：

- 配置合并到 `config/config.json`。
- 旧扁平 global session 迁移到 `storage/conversations/global/`。
- 旧扁平 project session 按 `projectId` 迁移到 `storage/conversations/projects/<projectId>/`。
- 写入 `config/.layout-migrated`。
- 对旧扁平 session 写入/保留 `storage/.layout-migrated`。
- 旧文件保留。

### 11.3 Session 测试

- 新建全局对话，确认写入 global。
- 新建项目对话，确认写入对应 projectId 目录。
- fork 项目对话，确认继承项目 scope。
- rollback 后空会话删除，确认对应文件中的 key 被删除。

### 11.4 Config 测试

- 修改语言或 YOLO，确认只更新 `app.settings`。
- 新增 Provider，确认只更新 `providers.customProviders`。
- 保存 API Key，确认只更新 `credentials.providerKeys`。
- 切换项目，确认只更新 `projects`。
- 并发更新不同 config section 不互相覆盖。

### 11.5 Cache 测试

- 删除整个 `cache/` 后重启，应用可正常运行。
- 选择或切换项目后，会自动创建 `cache/projects/<projectId>/` 子目录。
- 删除某个项目 cache 后，该项目会话仍可读取。

### 11.6 构建与静态检查

- `node --check server/*.mjs server/routes/*.mjs bin/*.mjs` 必须通过。
- `npm run build` 必须通过。
- `npm run lint` 目标应通过；若存在历史问题，应单独记录。

## 12. 验收标准

- 首次启动会自动创建 `config/config.json`、`storage/`、`cache/`、`logs/`。
- 老用户旧配置会自动合并到 `config/config.json`。
- 老用户旧会话会自动迁移到 `storage/conversations/`。
- 前端 storeName 和调用方式不变。
- 全局对话保存到 `storage/conversations/global/`。
- 项目对话保存到 `storage/conversations/projects/<projectId>/`。
- 读取 session metadata 时能聚合 global 与所有 project 会话。
- 删除 session 后不会被旧扁平文件重新导入。
- 清空 `cache/` 不影响配置、API Key、项目列表、会话历史。
- `/api/health` 返回 `dataDir`、`configDir`、`storageDir`、`cacheDir`、`logsDir`。
- `/api/storage/quota` 返回总占用、config 占用、storage 占用、cache 占用、logs 占用。
- `npm run build` 通过。
