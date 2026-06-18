# 自定义 Agent 与 Agent Profile 架构设计

> 状态：设计方案，待实现。

## 1. 背景

当前 QuickForge 已经具备实现自定义 Agent 的基础能力：

- `server/subagents.mjs`：内置 `general` / `explore` sub agent 定义。
- `server/tools/definitions.mjs`：定义 `run_subagent` 工具及 workspace 工具 schema。
- `server/tools/index.mjs`：实现 workspace 工具 handler。
- `server/agent-manager.mjs`：负责 Agent 创建、工具注入、工具审批、sub agent 执行。
- `server/routes/scheduled-tasks.mjs`：定时任务按计划创建 Agent session 并执行 instruction。

本设计目标是在不重写现有 Agent 执行链路的前提下，将现有 sub agent 扩展为可配置的 **Agent Profile**，并让它同时服务于：

1. 大模型对话过程中的 `run_subagent` 调用。
2. 定时任务中的自动执行 Agent。
3. 后续可能的普通会话默认 Agent。

## 2. 设计目标

- 支持用户创建自定义 Agent。
- 每个自定义 Agent 可配置：
  - 名称。
  - 描述。
  - 系统提示词。
  - 可操作工具白名单。
  - 最大运行时间。
  - 最大工具调用次数。
  - 是否允许作为 sub agent 被调用。
- 复用现有 `run_subagent` 机制，让大模型在交互过程中可以指定使用自定义 Agent。
- 在定时任务下面增加 Agent 功能，定时任务可绑定指定 Agent 执行。
- 保留现有工具审批、安全边界和项目规则。
- 尽量复用现有 `createAgent`、`createServerTools`、`runSubagent` 和 scheduled task runner。

## 3. 非目标

第一阶段不建议同时实现以下能力：

- 不直接支持 MCP tools 作为自定义 Agent 工具。
- 不直接支持 Skills tools 作为自定义 Agent 工具。
- 不实现复杂 Agent 版本管理。
- 不实现 Agent marketplace、导入导出、模板市场。
- 不允许 sub agent 递归调用 `run_subagent`。
- 不改变现有工具审批模型。

这些能力可以在后续阶段逐步补充。

## 4. 当前机制概述

### 4.1 Sub agent

当前 sub agent 是内置的短生命周期临时 Agent：

```txt
父 Agent -> run_subagent 工具 -> 临时 Agent -> 返回结果给父 Agent
```

当前内置 sub agent：

| 名称 | 用途 | 工具范围 |
|------|------|----------|
| `explore` | 首选只读仓库调研、定位文件、源码搜索、调用链追踪、测试/文档/wiki 发现、运行安全检查/诊断命令、影响面分析和总结上下文 | `read_file`, `grep_files`, `run_command` |
| `general` | 有边界的复杂多步骤实现或更广泛独立任务 | `read_file`, `grep_files`, `write_file`, `edit_file`, `run_command` |

当前特点：

- 复用父会话的 model、thinking level、API key 和项目上下文。
- 不持久化为普通会话。
- 不注入 MCP tools。
- 不注入 Skills tools。
- 默认不允许再次调用 `run_subagent`。
- 有最大运行时间和最大工具调用次数限制。

### 4.2 定时任务

当前定时任务流程：

```txt
runner 定期扫描 -> 找到到期任务 -> createAgent -> 写入 user instruction -> session.agent.continue()
```

当前定时任务已经支持：

- `once`
- `daily`
- `weekly`
- `monthly`
- `cron`

但目前没有独立的 Agent 类型概念，也没有 per-task 自定义系统提示词或工具集合。

### 4.3 工具系统

工具定义和执行分离：

- `server/tools/definitions.mjs`：工具名称、描述、参数 schema。
- `server/tools/index.mjs`：工具执行 handler。
- `server/agent-manager.mjs`：将工具定义包装为 Agent 可调用工具，并处理审批。

当前工具来源主要包括：

1. 内置 workspace tools。
2. Skill tools。
3. MCP tools。

第一阶段自定义 Agent 建议只支持 workspace tools，避免权限和可用性过早复杂化。

## 5. 核心设计：Agent Profile

将内置 sub agent 和用户自定义 agent 统一抽象为 `AgentProfile`。

```ts
type AgentProfile = {
  id: string
  name: string
  label: string
  description: string

  systemPrompt: string
  allowedTools: string[]

  maxRuntimeMs?: number
  maxToolCalls?: number

  enabledAsSubagent: boolean
  builtin?: boolean

  createdAt: string
  updatedAt: string
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `id` | 稳定 ID，用于定时任务绑定和 API 操作 |
| `name` | 机器可读名称，可用于 `run_subagent.subagent` |
| `label` | UI 展示名称 |
| `description` | Agent 能力描述，供用户和模型理解 |
| `systemPrompt` | 自定义系统提示词 |
| `allowedTools` | 工具白名单，只保存工具名 |
| `maxRuntimeMs` | 最大运行时间 |
| `maxToolCalls` | 最大工具调用次数 |
| `enabledAsSubagent` | 是否暴露给 `run_subagent` |
| `builtin` | 是否为内置 Agent |
| `createdAt` / `updatedAt` | 创建和更新时间 |

## 6. 内置 Agent 迁移

现有 `general` / `explore` 作为内置 Agent Profile 保留：

```ts
const builtinAgentProfiles = [
  {
    id: 'explore',
    name: 'explore',
    label: 'Explore',
    description: 'Preferred read-only repository exploration for file discovery, source search, call-chain lookup, related tests/docs/wiki discovery, safe inspection commands, and impact analysis.',
    allowedTools: ['read_file', 'grep_files', 'run_command'],
    enabledAsSubagent: true,
    builtin: true
  },
  {
    id: 'general',
    name: 'general',
    label: 'General',
    description: 'General-purpose agent for bounded complex multi-step implementation or broader independent work; prefer Explore for focused read-only repository discovery.',
    allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'],
    enabledAsSubagent: true,
    builtin: true
  }
]
```

兼容要求：

- 现有 `run_subagent` 调用 `general` / `explore` 的行为不变。
- 内置 Agent 不允许删除。
- 内置 Agent 可先不支持编辑，避免破坏默认行为。

## 7. 存储设计

新增本地 store：

```txt
custom-agents
```

存储用户自定义 Agent Profile。

建议存储结构：

```json
{
  "agents": [
    {
      "id": "agent-reviewer",
      "name": "reviewer",
      "label": "代码审查 Agent",
      "description": "专注于代码审查和风险提示。",
      "systemPrompt": "你是一个严谨的代码审查助手...",
      "allowedTools": ["read_file", "grep_files"],
      "maxRuntimeMs": 300000,
      "maxToolCalls": 20,
      "enabledAsSubagent": true,
      "builtin": false,
      "createdAt": "2026-05-29T00:00:00.000Z",
      "updatedAt": "2026-05-29T00:00:00.000Z"
    }
  ]
}
```

命名规则：

- `id` 全局唯一。
- `name` 需要和内置 Agent 不冲突。
- 自定义 Agent 不允许使用 `general`、`explore` 等保留名称。

## 8. 后端模块设计

### 8.1 新增模块

建议新增：

```txt
server/agent-profiles.mjs
server/routes/agent-profiles.mjs
```

`server/agent-profiles.mjs` 负责：

- 返回内置 Agent Profile。
- 读取自定义 Agent Profile。
- 合并内置和自定义 Agent Profile。
- 根据 `id` 或 `name` 查找 Agent Profile。
- 校验工具白名单是否合法。
- 校验名称冲突。

核心函数建议：

```ts
listAgentProfiles(options?: { includeDisabled?: boolean }): AgentProfile[]
getAgentProfile(idOrName: string): AgentProfile | null
listSubagentProfiles(): AgentProfile[]
createCustomAgentProfile(input): AgentProfile
updateCustomAgentProfile(id, patch): AgentProfile
deleteCustomAgentProfile(id): void
```

### 8.2 API 设计

新增 API：

```txt
GET    /api/agent-profiles
POST   /api/agent-profiles
GET    /api/agent-profiles/:id
PATCH  /api/agent-profiles/:id
DELETE /api/agent-profiles/:id
```

可选工具列表 API：

```txt
GET /api/agent-profiles/available-tools
```

返回第一阶段支持的 workspace tools：

```json
[
  {
    "name": "read_file",
    "label": "Read file",
    "description": "Read a UTF-8 text file inside the project.",
    "riskLevel": "safe"
  },
  {
    "name": "run_command",
    "label": "Run command",
    "description": "Run a shell command in the project workspace.",
    "riskLevel": "dangerous"
  }
]
```

## 9. `run_subagent` 复用策略

继续复用现有 `run_subagent` 工具，不新增新的工具。

当前：

```txt
run_subagent.subagent enum = ['general', 'explore']
```

扩展后：

```txt
run_subagent.subagent enum = 所有 enabledAsSubagent=true 的 AgentProfile name
```

示例：

```json
{
  "subagent": "reviewer",
  "task": "审查当前改动是否存在风险",
  "context": "重点关注 server/agent-manager.mjs"
}
```

执行流程：

```txt
父 Agent
  -> run_subagent 工具
  -> getAgentProfile(subagent)
  -> create temporary Agent
  -> 注入 profile.systemPrompt
  -> 注入 profile.allowedTools
  -> 执行 task/context
  -> 返回 assistant 最终文本给父 Agent
```

注意事项：

- 需要文件发现、源码搜索、调用链追踪、测试/文档/wiki 发现或影响面分析时，父 Agent 应优先委托 `explore` 做只读仓库调研，再由父 Agent 决策是否实现或调用其他 Agent。
- `general` 适合有边界的复杂多步骤实现或更广泛独立任务；不要用它替代普通的只读仓库探索。
- 自定义 Agent 作为 sub agent 使用时，默认禁止再次调用 `run_subagent`。
- 自定义 Agent 运行超时或工具调用次数超限时，应返回明确错误。
- 如果自定义 Agent 被禁用或删除，`run_subagent` 应返回可理解的错误。
- 如果自定义 Agent 数量很多，不建议全部暴露给父 Agent；可以后续增加“本会话启用的 sub agents”配置。

## 10. 定时任务 Agent 集成

### 10.1 数据结构扩展

定时任务新增字段：

```ts
type ScheduledTask = {
  // existing fields
  agentId?: string
}
```

运行历史建议新增：

```ts
type ScheduledTaskRun = {
  // existing fields
  agentId?: string
  agentLabel?: string
  agentSnapshot?: {
    id: string
    name: string
    label: string
    description: string
    systemPrompt: string
    allowedTools: string[]
    maxRuntimeMs?: number
    maxToolCalls?: number
  }
}
```

### 10.2 执行流程

调整前：

```txt
scheduled task -> createAgent -> continue()
```

调整后：

```txt
scheduled task
  -> load AgentProfile by task.agentId
  -> createAgent with profile options
  -> write task.instruction as user message
  -> continue()
  -> write run history with agent snapshot
```

### 10.3 系统提示词策略

建议采用追加策略：

```txt
QuickForge 默认系统提示词
+
项目规则 / workspace context
+
Agent Profile 自定义系统提示词
```

不建议完全替换默认系统提示词，原因：

- 默认系统提示词包含 QuickForge 基础行为约束。
- 项目规则和安全边界需要保留。
- 工具调用、审批和 workspace 限制不能被自定义提示词绕过。

### 10.4 Agent 缺失处理

如果定时任务绑定的 Agent 被删除：

第一阶段建议降级为默认 Agent，并在 run history 记录 warning：

```txt
Configured agent not found, fallback to default agent.
```

更严格的策略也可以是直接让任务失败。推荐第一阶段使用降级策略，降低破坏性。

## 11. 工具白名单设计

自定义 Agent 配置中只保存工具名，不保存完整工具 schema：

```ts
allowedTools: ['read_file', 'grep_files', 'run_command']
```

实际执行时仍由现有工具系统生成：

```txt
allowedTools -> createServerTools({ allowedToolNames }) -> Agent tools
```

第一阶段建议允许的 workspace tools：

| 工具 | 风险级别 | 默认建议 |
|------|----------|----------|
| `read_file` | 安全 | 可选，默认开启 |
| `grep_files` | 安全 | 可选，默认开启 |
| `write_file` | 高风险 | 默认关闭 |
| `edit_file` | 高风险 | 默认关闭 |
| `run_command` | 高风险 | 默认关闭 |

暂不开放：

- MCP tools。
- Skills tools。
- `run_subagent`。

后续如果开放 MCP / Skills，建议增加字段：

```ts
includeMcpTools?: boolean
includeSkillTools?: boolean
```

但工具白名单仍应以 tool name 为准。

## 12. 权限与安全边界

必须保留现有审批机制。

默认安全工具：

- `read_file`
- `grep_files`

高风险工具：

- `write_file`
- `edit_file`
- `run_command`
- MCP tools

高风险工具在非 YOLO 模式下仍需要审批，不能因为来自自定义 Agent 就绕过审批。

安全原则：

1. 自定义 Agent 只能使用 `allowedTools` 中声明的工具。
2. 自定义 Agent 不允许突破 workspace 路径限制。
3. 自定义 Agent 不允许读取敏感文件。
4. 自定义 Agent 不允许绕过工具审批。
5. Sub agent 默认不允许递归调用 `run_subagent`。
6. 定时任务使用自定义 Agent 时，同样遵守工具审批和安全规则。

## 13. 前端交互设计

在定时任务页面下新增 Agent 功能区：

```txt
Scheduled Tasks
  - Tasks
  - Runs
  - Agents
```

### 13.1 Agents 页面

Agent 列表展示：

- 名称。
- 描述。
- 是否内置。
- 是否启用为 sub agent。
- 工具数量。
- 更新时间。

支持操作：

- 新建 Agent。
- 编辑 Agent。
- 删除自定义 Agent。
- 查看内置 Agent。

内置 Agent 第一阶段只读，不允许编辑或删除。

### 13.2 Agent 编辑表单

字段：

- 名称。
- 描述。
- 系统提示词。
- 可用工具勾选。
- 最大运行时间。
- 最大工具调用次数。
- 是否允许作为 sub agent。

工具选择 UI 建议对高风险工具做明显提示：

```txt
run_command：可执行 shell 命令，可能修改工作区或产生副作用。
write_file / edit_file：可修改项目文件。
```

### 13.3 定时任务表单

新增字段：

```txt
执行 Agent：下拉选择
```

选项：

- 默认 Agent。
- Explore。
- General。
- 用户自定义 Agent。

选中 Agent 后可展示摘要：

- Agent 描述。
- 可用工具。
- 风险提示。

## 14. 分阶段实现计划

### 第一阶段：最小可用

目标：实现自定义 Agent 的核心闭环。

包含：

- 新增 Agent Profile store。
- 保留内置 `general` / `explore`。
- 支持自定义系统提示词。
- 支持 workspace tools 白名单。
- 定时任务可选择 Agent。
- `run_subagent` 可调用启用的自定义 Agent。
- 保留现有工具审批。

不包含：

- MCP tools。
- Skills tools。
- Agent 版本管理。
- Agent 导入导出。

### 第二阶段：增强能力

可加入：

- MCP tools 白名单。
- Skills tools 白名单。
- 项目级 Agent。
- 会话级可用 sub agents 选择。
- Agent snapshot 更完整记录。
- 定时任务运行结果中展示 Agent 信息。

### 第三阶段：治理能力

可加入：

- Agent 模板。
- Agent 导入导出。
- 工具风险评分。
- Agent 执行统计。
- Agent 使用日志聚合。
- Agent 配置版本和回滚。

## 15. 兼容性与迁移

第一阶段应保持兼容：

- 现有 `run_subagent` 的 `general` / `explore` 行为不变。
- 现有定时任务如果没有 `agentId`，继续使用默认 Agent。
- 现有任务历史不需要迁移。
- 新增字段应为可选字段。

定时任务兼容策略：

```ts
const agentProfile = task.agentId
  ? getAgentProfile(task.agentId)
  : getDefaultScheduledTaskAgentProfile()
```

如果找不到 Agent：

```txt
fallback to default agent + record warning
```

## 16. 风险与注意事项

### 16.1 权限扩大风险

用户可能给自定义 Agent 开启 `run_command`、`write_file` 等高风险工具。

缓解：

- UI 明确提示风险。
- 后端继续强制审批。
- 非 YOLO 模式不能自动执行高风险工具。

### 16.2 上下文膨胀

如果自定义 Agent 很多，全部暴露给 `run_subagent` 会增加工具 schema 和提示词上下文成本。

缓解：

- 只暴露 `enabledAsSubagent=true` 的 Agent。
- 后续支持会话级选择“当前会话可用 sub agents”。

### 16.3 递归调用风险

Agent 调 Agent，可能导致递归、成本失控和状态难追踪。

缓解：

- 自定义 Agent 作为 sub agent 时默认不注入 `run_subagent`。
- 后续如需开放，必须设置深度限制和总预算。

### 16.4 配置变更影响历史

Agent 配置变更后，定时任务后续执行行为会变化。

缓解：

- run history 记录 `agentSnapshot`。
- 后续可引入 Agent version。

### 16.5 MCP / Skills 可用性

如果后续开放 MCP / Skills，自定义 Agent 可能依赖不可用的外部工具。

缓解：

- 第一阶段不开放。
- 后续开放时需要工具可用性检查和降级提示。

## 17. 测试计划

### 17.1 后端测试

覆盖：

- 创建自定义 Agent。
- 更新自定义 Agent。
- 删除自定义 Agent。
- 禁止删除内置 Agent。
- 禁止自定义 Agent 与内置名称冲突。
- 校验非法工具名。
- `run_subagent` 可以调用自定义 Agent。
- `run_subagent` 不允许调用 disabled Agent。
- 自定义 Agent 只能访问白名单工具。
- 定时任务绑定 Agent 后按 profile 执行。
- 定时任务缺失 Agent 时降级或失败策略符合预期。

### 17.2 前端测试

覆盖：

- Agent 列表展示。
- 新建 Agent 表单校验。
- 编辑 Agent。
- 删除自定义 Agent。
- 内置 Agent 只读。
- 定时任务表单可选择 Agent。
- 高风险工具展示风险提示。

### 17.3 验证命令

实现后默认运行：

```bash
npm run lint
npm run build
```

如果新增后端单元测试或端到端测试，应同时运行对应测试命令。

## 18. 验收标准

第一阶段完成后应满足：

1. 用户可以在定时任务页面下创建自定义 Agent。
2. 自定义 Agent 可以配置系统提示词和 workspace 工具白名单。
3. 定时任务可以选择某个 Agent 执行。
4. 大模型对话中可以通过 `run_subagent` 调用启用的自定义 Agent。
5. 内置 `general` / `explore` 继续可用，行为不变。
6. 高风险工具仍遵守现有审批机制。
7. Sub agent 默认不能递归调用 `run_subagent`。
8. 定时任务运行历史可以看到使用的 Agent 信息。

## 19. 推荐结论

推荐将“自定义 Agent”实现为统一的 `AgentProfile` 配置层，而不是新增一套独立执行系统。

这样可以最大程度复用现有：

- Agent 创建逻辑。
- 工具定义和工具 handler。
- 工具审批机制。
- 定时任务执行流程。
- `run_subagent` 调用机制。

第一阶段建议只做：

```txt
自定义 Agent
+ 系统提示词
+ workspace 工具白名单
+ 定时任务绑定
+ run_subagent 可调用
```

MCP、Skills、Agent 版本、导入导出等能力应作为后续增强逐步加入。
