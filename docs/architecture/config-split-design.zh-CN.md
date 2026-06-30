# 配置文件拆分设计（评审稿）

> 状态：**已实现**（第一阶段：配置物理拆分 + MCP 升级为独立 store + 备份 merge 模式）。详见文末「七、实现结论」。
> 配图：[`config-split-design.svg`](./config-split-design.svg)

## 一、评审结论

### 1. 现状：运行时配置集中在 1 个文件

真正承载配置的运行时数据在 `~/.quickforge/config/config.json`。`server/storage.mjs` 用 `configStores` 机制，把 **4 个 store + 项目注册表**全部映射到这一个文件：

| Store | 在 config.json 的位置 | 性质 |
|------|------|------|
| `settings` | `app.settings` | 通用应用设置（大杂烩，见下） |
| `provider-keys` | `credentials.providerKeys` | **敏感** API 密钥 |
| `custom-providers` | `providers.customProviders` | 自定义服务商 |
| `plugins` | `extensions.plugins` | 插件配置 |
| （非 store） | `projects` | 项目注册表 |

这 5 类共用 `storage.mjs` 中**同一条 `'config'` 写入队列**（`atomicUpdate` / `writeStore` 里 `queueName = 'config'`），任何一类写入都会重写整个文件。

### 2. `settings` store 本身就是大杂烩

经代码核对，`app.settings` 里至少混着：`mcpServers`（MCP）、`terminalShell*`（终端）、`auto-compact`（自动压缩）、`yolo-mode`、`agent-access-mode`、`active-model`、`default-options`，以及外观 / 语言 / LAN / 服务等前端设置项。其中 **MCP 被埋在 `settings.mcpServers`**，却拥有独立的热插拔生命周期。

### 3. 已独立的部分（澄清，本次无需拆）

- **定时任务** → `storage/conversations/{global|projects/<id>}/scheduled-tasks.json`，已是独立 store（`scheduled-tasks`）。
- **自定义 agent** → `custom-agents` store，独立 JSON。
- **文件 agent** → `~/.claude/agents`、`~/.quickforge/agents`、`<project>/.{claude,quickforge}/agents` 下的 `.md`（`agent-profile-files.mjs` 已有成熟的"约定目录扫描 + frontmatter"范式，可作本次 MCP 文件化的参考）。

### 4. 主要问题

1. **单点文件 + 单一队列**：任何写入重写整个文件、写入串行化成并发瓶颈、一处写损坏 → 全部 5 类配置同时受影响。
2. **敏感凭据与普通配置同文件**：备份 / 权限隔离困难（`backup.mjs` 已用 `includeSecrets` 开关区分导出，但物理上仍混在一起）。
3. **MCP 被绑在 `settings` 上**：生命周期、写入频率、文件化需求都与其他设置不同。

---

## 二、拆分设计

### 目标目录结构

```
~/.quickforge/config/
├── config.json          ← 退化为元数据 + 迁移标记（layoutVersion / updatedAt）
├── settings.json        ← app.settings（通用应用设置，去掉 mcpServers）
├── mcp-servers.json     ← MCP 服务器（由 settings 拆出，升级为独立 store）★
├── providers.json       ← 自定义模型服务商 + API 密钥（强相关，合并为一个文件；整体敏感）⚠
├── plugins.json
└── projects.json        ← 项目注册表（activeProjectId / globalSkills / projects）
```

### 设计决策

- **D1 物理拆分**：`configStores` 里每个 store 指向**各自独立文件**，不再共用 `config.json`。
- **D2 MCP 升级为独立 store**：新增 `mcp` store，从 `settings.mcpServers` 剥离，独立文件 + 独立写入队列。理由：用户明确点名 MCP，且其热插拔 / 频繁启停 / 独立生命周期最适合解耦。
  - 影响面：`server/mcp/config.mjs` 的 `readMcpServers/writeMcpServers/...` 改为读写 `mcp` store；`backup.mjs` 增加 `mcp` section；`settings.json` 不再含 `mcpServers`。
- **D3 写入队列各自独立**：`atomicUpdate` / `writeStore` 的 `queueName` 改为各 store 自身，互不阻塞。
- **D4 服务商与密钥合并为 `providers.json`**：`customProviders`（模型服务商定义）与 `providerKeys`（对应密钥）业务强相关——服务商配置缺少密钥即不可用，故合并到同一物理文件，共用一条写入队列做原子更新。逻辑上仍可保留两个 store 抽象（`provider-keys` / `custom-providers`），均映射到 `providers.json`，以便 `backup.mjs` 的 `includeSecrets` 开关仍可按字段区分导出。
- **D5 `config.json` 退化为元数据载体**：只保留 `layoutVersion` / `updatedAt` 与迁移标记，不再承载配置数据（读取逻辑兼容：旧文件若仍有 section，迁移时搬走）。
- **D6 向后兼容迁移**：新增 `migrateSplitConfig()`——读旧 `config.json` 各 section → 写入对应新文件（`customProviders` + `providerKeys` 一起写入 `providers.json`）→ 写迁移标记 `.split-migrated`。读取侧做回退保险：无标记且新文件不存在时，回退读旧 section。
- **D7 备份导入 / 导出同步**：`server/routes/backup.mjs` 的 `buildBackup` / `restore` / `restoreSectionIds` 增加 `mcp`；`provider-keys` 与 `custom-providers` 仍按 store 抽象分别处理（物理同文件但逻辑可分），`includeSecrets=false` 时跳过密钥字段。

### 可选第二阶段（文件化扩展）

借鉴 `agent-profile-files.mjs`，让 MCP / 定时任务支持**约定目录文件加载**（如 `~/.quickforge/mcp-servers/*.json`，只读、可纳入版本管理 / 团队共享），与 store 内可写的项按优先级合并。此为增量增强，不影响第一阶段落地。

---

## 三、改动点清单

| 文件 | 改动 |
|------|------|
| `server/storage.mjs` | `configStores`/`configStoreSections` 改为每 store 独立文件（`provider-keys`/`custom-providers` 共享 `providers.json`）；`storeFile`/`readStore`/`writeStore`/`atomicUpdate` 队列拆分；新增 `migrateSplitConfig()`；`config.json` 元数据化 |
| `server/mcp/config.mjs` | 读写目标由 `settings.mcpServers` 改为 `mcp` store |
| `server/routes/backup.mjs` | 导出 / 导入 / section 集合增加 `mcp` |
| `docs/wiki` | 同步更新存储架构说明 |

---

## 四、迁移与兼容策略

1. 启动时 `ensureStorage()` → `migrateUnifiedConfig()`（保留，处理更早期的旧布局）→ **新增 `migrateSplitConfig()`**。
2. `migrateSplitConfig()` 逻辑：若 `.split-migrated` 不存在，读 `config.json` 的 5 个 section + `settings.mcpServers`，分别写入新文件（`credentials.providerKeys` 与 `providers.customProviders` 一并写入 `providers.json`）；随后清空 `config.json` 中的数据 section（仅留元数据），写标记。
3. 读取回退：每个新文件的读取函数在"文件不存在且未迁移"时回退读旧 `config.json` 对应 section，避免任何中途状态丢数据。

---

## 五、风险

- **敏感文件权限**：`provider-keys.json` 独立后，可考虑收紧文件权限（平台相关，Windows 需另议），需评估是否纳入本次范围。
- **备份兼容**：旧备份文件（含 `mcpServers` 在 settings 内）导入时需做一次"提升"迁移，把 `settings.mcpServers` 搬到 `mcp`。
- **并发**：拆分后写入队列增多，需确认 `storeRevisions` 缓存失效仍按 store 粒度正确触发。
- **🔴 高危：新旧版本混用导致数据分叉（实测复现）**：`migrateSplitConfig()` 仅在 `.split-migrated` 标记**不存在**时运行。一旦新版跑过并写下标记，若用户又切回旧版，旧版 `writeConfigFile()` 会把数据重新写回 `config.json` 的旧 section，而新版此后不再补迁（标记已存在），于是 `config.json` 旧 section 与 `providers.json` 等独立文件**各持一份、彼此分叉**——界面只显示其中一处（表现为"历史配置丢失、只显示新加项"）。迁移标记的存在反而挡住了自动修复。状态图见 [`config-split-migration-states.svg`](./config-split-migration-states.svg)。
  - **根本规避**：升级到新版后**不要回切旧版**。纯旧版 → 新版的一次性升级是安全无缝的（已隔离实测验证）。
  - **分叉后的修复**：以独立文件（`providers.json`/`settings.json`/`mcp-servers.json`/`projects.json`）为权威源（经逐 section 对比确认是超集后），将 `config.json` 手动 demote 为纯元数据 `{ layoutVersion: 2, migratedAt }`。注意 `projects` 可能出现"同项目双胞胎 ID"（同一路径在两文件注册成不同 id），合并前需逐项核对 `activeProjectId` 与项目级设置归属。

---

## 六、待确认

1. 是否采纳 **D2（MCP 升级为独立 store）**，还是仅做 D1（MCP 仍留在 settings，只是物理文件从 config.json 拆出）？
2. 敏感文件权限收紧是否纳入本次？
3. 第二阶段文件化是否同步做，还是先落地物理拆分？

---

## 七、实现结论（第一阶段已落地）

第一阶段（物理拆分）已全部实现并通过测试，对照各设计决策的落地情况：

| 决策 | 落地情况 |
|------|---------|
| D1 物理拆分 | ✅ `soloConfigStores` + `sharedConfigGroups` + `configStoreLocations`，每个 config store 指向独立文件 |
| D2 MCP 独立 store | ✅ 新增 `mcp` store；`mcp/config.mjs` 改读写 `mcp` store（`mcp-servers.json`） |
| D3 写入队列独立 | ✅ 各 store 按自身 queue 串行，互不阻塞（`provider-keys`/`custom-providers` 共用 `providers` 队列） |
| D4 服务商与密钥合并 | ✅ `providers.json` 共享文件，逻辑上仍是两个 store |
| D5 config.json 元数据化 | ✅ 仅保留 `{ layoutVersion: 2, migratedAt }` |
| D6 向后兼容迁移 | ✅ `migrateSplitConfig()`：逐文件幂等写入 + 写 `.split-migrated` 标记；`readConfigStore()` 含读取回退保险（无标记且新文件缺失时回退读旧 config.json section，见下「风险项」） |
| D7 备份同步 | ✅ `backup.mjs` 导出/导入/inspect 全链路支持 `mcp`；新增 replace/merge 恢复模式；旧备份 `settings.mcpServers` 自动提升为 `mcp` |

**对「六、待确认」三项的回应：**

1. **采纳 D2**：MCP 已升级为独立 store（`mcp`），从 `settings` 完全剥离。
2. **敏感文件权限收紧未纳入本次**：`writeJsonAtomic` 未做平台相关权限收紧，`providers.json` 仍是默认权限。如需隔离，建议作为后续安全增强单独处理（涉及 Windows 权限模型，需另议）。
3. **第二阶段文件化未做**：先落地物理拆分。MCP / 定时任务的约定目录文件加载（借鉴 `agent-profile-files.mjs`）留作后续增量增强。

**风险项状态：**

- 读取回退保险（设计「四-3」）：已补齐。`readConfigStore()` 在"新文件不存在且 `.split-migrated` 未写"时，经 `legacyConfigSectionReaders` 回退读旧 `config.json` 对应 section（含 `mcp` 回退到 `settings.mcpServers` 的特殊映射），确保迁移中途状态不丢数据。正常运行流程下 `ensureStorage()` 的幂等迁移总会先补齐文件，该分支为纵深防御（覆盖迁移逻辑被改坏的极端情况）。
- 备份兼容：已通过 `normalizeBackupPayload` 的「提升」逻辑覆盖（旧备份 `settings.mcpServers` → `mcp`）。
- 并发：写入队列拆分后，`storeRevisions` 仍按 store 粒度 bump，缓存失效正确。

**清理项：** 移除了无调用方的死导出 `configFile()`；为仅迁移链使用的 `writeConfigFile()`（强制 `layoutVersion: 1`）补充了过渡用途注释，避免与 D5 混淆。
