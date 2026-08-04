# 浏览器缓存策略设计

> 状态：已实施（v1 范围）
> 目标：在不影响功能的前提下，减少本地服务器 API 往返与序列化开销，提升交互响应速度。

## 背景与约束

- QuickForge 是本地单机应用：React/Vite 前端 + 本地 Node 服务器（`server/index.mjs`），API 前缀 `/api/*`。
- 前端绝大多数 fetch 显式携带 `cache: 'no-store'`（见 `src/lib/http-storage-backend.ts`、`src/lib/server-agent.ts` 等），服务端 `sendJson` 统一下发 `cache-control: no-store`。
  → 浏览器 HTTP 层缓存对 API 默认失效，缓存只能落在**应用层**（内存 + localStorage）。
- 缓存永远不是唯一数据源：任何缓存读取失败、过期一律回源请求；缓存不缓存写接口、SSE、会话消息等动态/易变数据。

## 可缓存性分级

| 级别 | 判定标准 | 典型接口 |
|---|---|---|
| A 强缓存 | 数据几乎不变，有明确失效信号 | `/api/system/about`、`/api/system/network`、`/api/terminal/capabilities`、`/api/agent-profiles/available-tools`、`/api/filesystem/roots`、`/api/mcp/config`、`/api/plugins`、`/api/tools`、`/api/instructions` |
| B 短 TTL | 低频变化，可接受短暂陈旧 | `/api/project`、`/api/project/commands`、`/api/system/status`、`/api/system/terminal-shell`、`/api/skills/*`、`/api/scheduled-tasks*`、`/api/storage/index`、`/api/system/update/check` |
| C 不缓存 | 易变/个性化/轮询 | `/api/agents`、`/api/agents/:id/{state,status}`、`/api/git/*`、`/api/workspace/*`、`/api/storage/key/:key`、`/api/storage/quota`、`/api/health` |
| D 禁止缓存 | 写操作/SSE/文件流/鉴权 | 所有 POST/PUT/PATCH/DELETE、`/api/agents/events`、`/share/*/events`、`/api/workspace/preview`、`/api/backup/export`、LAN 鉴权 |

## 已实施内容（v1）

### 1. 前端通用 API 缓存 `src/lib/api-cache.ts`

内存 Map 优先 + localStorage 持久化兜底，参照既有 `src/lib/model-list-cache.ts` 模式。

- `readApiCache<T>(key, ttlMs)` — 读取未过期缓存，过期/缺失返回 null。
- `writeApiCache(key, value)` — 写内存；序列化后 ≤ 256KB 才写 localStorage（避免大响应撑爆配额）。
- `invalidateApiCache(pattern)` — 按精确 key 或 RegExp 失效（内存 + localStorage）。
- `clearApiCache()` — 清空全部。
- 跨标签页同步：监听 `storage` 事件，其它标签页写入/失效时丢弃本页内存副本。

### 2. `/api/project` 列表缓存（`src/hooks/useProject.ts`）

- `loadProject(forceRefresh?)`：TTL 15s，缓存命中直接应用状态；未命中回源并写缓存。
- 写操作后失效：`switchActiveProject`、`handleSelectProjectPath`、`reorderProjects`（`useProjectActions.deleteProjectInline` 同理）成功后调用 `invalidateApiCache('/api/project')`。
- 跨标签项目变更回调改为 `loadProject(true)` 强制回源，避免跨标签同步读到陈旧缓存。
- 注意：`/api/project/active`、`/api/project/path` 的响应不含 `defaultWorkspaceRoot`，因此写操作**只失效、不写缓存**，防止污染缓存结构。

### 3. `/api/agents` 活跃会话轮询去抖（`src/lib/server-agent.ts`）

`fetchActiveAgentStatuses` 增加 in-flight 合并：200ms 窗口内同一 baseUrl 的并发调用共享同一 Promise；请求完成后自动清空，下次调用重新请求。不缓存结果数据（状态必须实时），仅合并并发、防止可见性切换/会话列表刷新时重复请求。

### 4. 服务端更新检查冷却（`server/utils/package-update.mjs`）

`checkForUpdates` / `checkDesktopRelease` 增加进程内冷却缓存（TTL 5 分钟）：

- 并发调用共享同一 Promise（in-flight 合并）；
- **失败不缓存**，下次调用立即重试；
- 外部 registry/GitHub 请求是应用中最慢的调用，冷却可显著减少启动检查与多标签页的重复外部网络请求。

### 5. HTTP 层缓存基础设施（`server/utils/response.mjs`）

- `sendJson(res, status, value, cacheControl?)`：第 4 个参数可选，未传保持 `no-store`（行为不变）。
- 已启用：`GET /api/terminal/capabilities` → `private, max-age=300`，并同步移除前端 `terminal-api.ts` 该调用的 `cache: 'no-store'`。

## 明确不做

- 不缓存任何写接口、SSE、会话消息、Git/工作区数据（功能正确性优先）。
- 不引入 Service Worker（本地应用收益低、复杂度高，列为远期选项）。
- 不新增依赖，全部使用现有 React hooks + fetch 实现。

## 启用清单（后续按需）

以下 A/B 级接口如需进一步提速，可按下述方式启用（同时满足服务端头 + 前端调用点两个条件）：

| 接口 | 建议 TTL | 前置条件 |
|---|---|---|
| `/api/system/about` | 60s | 前端 `about-settings-tab.ts` 去掉 `cache: 'no-store'`；接受升级后 ≤60s 的版本信息陈旧 |
| `/api/system/network` | 300s | 前端调用点去 no-store；LAN 设置变更后需失效 |
| `/api/agent-profiles/available-tools` | 300s | 前端调用点去 no-store；MCP/插件变更后失效 |
| `/api/filesystem/roots` | 300s | 前端调用点去 no-store；磁盘变化后失效 |

## 验证

- 前端：`npm run lint`、`npm run build`。
- 回归关注点：跨标签项目同步、切换项目后项目列表正确性、终端 capabilities 获取、启动更新检查。
