# QuickForge Agent 能力插件系统

QuickForge 插件系统的目标不是传统 IDE 插件或 UI 菜单扩展，而是 **Agent 能力插件系统**：插件是可安装、可版本化、可权限控制的 Agent 能力包。

```txt
Agent Plugin = Skill + Command + Hook + Tool/MCP + Agent/Subagent + Context + Permission + Distribution + Audit
```

换句话说，插件用于给 Agent 增加“怎么做事、能用什么工具、什么时候自动触发、由谁专门处理、允许访问什么、如何审计追溯”的能力，而不只是给界面增加入口。

## 1. 设计目标

- **能力包而非脚本集合**：插件必须有身份、版本、manifest、能力声明和权限声明。
- **渐进加载**：启动时只加载 catalog 和触发描述；命中任务后再加载完整 Skill、资源、Agent 指令或工具入口，避免上下文膨胀。
- **统一接入现有能力**：QuickForge 已有 Skills、Custom Commands、MCP、Agent Profiles/Subagents、工具审批和 YOLO 模式；插件系统应作为统一封装层，而不是重复实现这些子系统。
- **权限优先**：插件声明权限不等于自动获得权限。文件、shell、网络、密钥、Git、MCP/LSP 访问都应由 Permission Broker 统一治理。
- **本地可信起步，面向分发演进**：第一阶段支持本地插件；后续扩展安装、版本锁、托管插件、插件市场和审计。

## 2. QuickForge 插件定义

一个 QuickForge 插件是一个自包含目录：

```txt
my-plugin/
  plugin.json
  skills/
    code-review/
      SKILL.md
      references/
      scripts/
  commands/
    review.md
  hooks/
    hooks.json
  tools/
    index.mjs
  mcp/
    mcp.json
  agents/
    reviewer.md
  lsp/
    lsp.json
  monitors/
    monitors.json
  context/
    AGENTS.md
  assets/
    icon.png
```

插件目录可以只包含其中一部分能力。例如一个流程型插件可以只包含 `skills/` 和 `commands/`；一个外部系统插件可以包含 `mcp/` 和 `tools/`；一个治理插件可以主要包含 `hooks/` 和权限策略。

## 3. Manifest 模型

推荐 manifest：

```json
{
  "name": "java-quality-plugin",
  "displayName": "Java Quality Plugin",
  "version": "1.0.0",
  "description": "Java/Spring Boot quality workflows, review agents, hooks, and MCP integrations.",
  "apiVersion": 1,
  "quickforgeVersion": ">=1.3.0",
  "author": "team-ai",
  "homepage": "https://example.com",
  "license": "MIT",
  "contributes": {
    "skills": "./skills",
    "commands": "./commands",
    "hooks": "./hooks/hooks.json",
    "tools": [
      {
        "name": "analyzeDiff",
        "description": "Analyze Java/Spring Boot diff risk.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "scope": { "type": "string" }
          }
        }
      }
    ],
    "toolsEntry": "./tools/index.mjs",
    "mcpServers": "./mcp/mcp.json",
    "agents": "./agents",
    "lspServers": "./lsp/lsp.json",
    "monitors": "./monitors/monitors.json",
    "context": "./context"
  },
  "permissions": {
    "filesystem": ["read", "workspace-write"],
    "shell": "approval-required",
    "network": {
      "mode": "domain-allowlist",
      "domains": ["github.com", "jira.example.com"]
    },
    "secrets": "no-secrets",
    "git": ["read", "commit"],
    "mcp": ["company-docs"],
    "lsp": ["java"]
  }
}
```

### 3.1 基础字段

| 字段 | 说明 |
| --- | --- |
| `name` | 插件唯一名称。建议小写字母、数字、`-`、`_`。 |
| `displayName` | UI 展示名。 |
| `version` | 插件版本。用于展示、升级和未来 lockfile。 |
| `description` | 插件能力摘要。用于 catalog、安装页和 Agent 能力路由。 |
| `apiVersion` | QuickForge 插件 API 版本。 |
| `quickforgeVersion` | 可选的 QuickForge 兼容范围。 |
| `author` / `homepage` / `license` | 分发、审计和展示信息。 |
| `contributes` | 插件贡献的能力声明。 |
| `permissions` | 插件请求的权限声明。 |
| `enabledByDefault` | 可选。仅建议 QuickForge bundled plugins 使用；用户仍可显式禁用。 |

### 3.2 能力字段

| 字段 | 作用 | 当前状态 |
| --- | --- | --- |
| `contributes.tools` | 插件贡献 Agent tools，命名为 `plugin__{pluginName}__{toolName}`。 | MVP 已支持 |
| `contributes.settings` | 插件配置 schema/展示信息。 | MVP 已支持基础配置保存 |
| `contributes.skills` | 插件打包 Skills，供 Agent 渐进加载。 | V1 已支持静态目录贡献 |
| `contributes.commands` | 插件打包 slash commands，用户主动触发。 | V1 已支持静态文件/目录贡献 |
| `contributes.hooks` | 生命周期 hook 和策略规则。 | 规划 |
| `contributes.mcpServers` | MCP server presets / bundled MCP 配置。 | 规划 |
| `contributes.agents` | 插件贡献 Agent Profile/Subagent。 | 规划 |
| `contributes.lspServers` | 插件贡献 LSP server 配置和代码智能能力。 | 规划 |
| `contributes.monitors` | 后台监听器，如日志、测试、CI、文件变化。 | 规划 |
| `contributes.context` | AGENTS.md 风格的项目/目录上下文。 | 规划 |

## 4. 核心组件边界

### 4.1 Skill：让 Agent 学会一种做事方法

Skill 适合沉淀流程和规范，例如代码审查、测试生成、文档写作、PPT 制作、Excel 建模、安全审计。

要求：

- catalog 只暴露 `name`、`description`、触发条件、资源摘要。
- 完整 `SKILL.md` 和资源通过 `activate_skill` / `read_skill_resource` 类似机制按需读取。
- 插件 Skill 不应在启动时全部塞入系统提示词。

### 4.2 Command：用户主动触发的快捷工作流

Command 是可复用 prompt 模板，适合 `/review`、`/test-gen`、`/fix-ci`、`/explain-project` 等用户主动动作。

建议优先级：

```txt
project command > user/plugin command > built-in command
```

### 4.3 Hook：系统自动触发的生命周期事件

Hook 是 Agent 插件系统的治理和自动化核心。插件可以在工具调用、文件编辑、命令执行、错误和上下文压缩等节点触发策略。

建议事件：

```txt
SessionStart
BeforeToolCall
AfterToolCall
BeforeFileEdit
AfterFileEdit
BeforeShellExec
AfterShellExec
OnError
BeforeCommit
ContextCompaction
```

示例：

```json
{
  "hooks": {
    "AfterFileEdit": [
      {
        "match": "**/*.java",
        "run": "mvn -q -DskipTests compile",
        "approval": "required"
      }
    ],
    "BeforeShellExec": [
      {
        "block": ["rm -rf", "git push --force", "curl unknown"],
        "message": "危险命令已被插件策略拦截"
      }
    ]
  }
}
```

Hook 不能只服务 Agent，也应服务系统治理：自动格式化、自动测试、危险命令拦截、审计记录、错误摘要和上下文压缩前保存关键信息。

### 4.4 Tool / MCP：连接外部系统和执行动作

- `contributes.tools` 用于插件本地 Node.js ESM 工具。
- `contributes.mcpServers` 用于声明 MCP server presets，优先兼容 MCP 而不是自创外部系统协议。

MCP 示例：

```json
{
  "company-docs": {
    "transport": "stdio",
    "command": "node",
    "args": ["./server/company-docs-mcp.js"]
  }
}
```

插件启用不应默认信任并自动运行 MCP server。合理流程是：展示插件请求连接的 MCP server，用户确认后写入/启用 MCP 配置。

### 4.5 Agent/Subagent：专门干一类活

插件可以贡献专用 Agent Profile/Subagent，例如：

```json
{
  "name": "code-reviewer",
  "description": "Review code changes and identify architecture, security, and test risks.",
  "tools": ["read_file", "grep_files", "run_command"],
  "maxTurns": 20
}
```

主 Agent 可把特定任务委托给插件贡献的专家 Agent，例如架构审查、测试补全、安全分析、发布检查。

### 4.6 LSP：给 Agent 代码智能

LSP 让 Agent 能获取定义、引用、类型、诊断和 hover 信息，减少只靠 grep 的误判。

示例：

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensions": [".ts", ".tsx"]
    },
    "java": {
      "command": "jdtls",
      "extensions": [".java"]
    }
  }
}
```

后续可提供 Agent tools：

```txt
lsp_definition
lsp_references
lsp_hover
lsp_diagnostics
lsp_rename_preview
```

### 4.7 Monitor：后台监听和主动提醒

Monitor 用于监听日志、CI、测试、端口服务或文件变化，并在关键事件发生时通知 Agent 或用户。

示例：

```json
{
  "monitors": {
    "dev-server": {
      "type": "log",
      "path": "logs/dev.log",
      "patterns": ["ERROR", "Unhandled"]
    }
  }
}
```

## 5. 权限模型

插件权限是声明和治理入口，不是授权本身。所有敏感能力都应经过 Permission Broker。

推荐权限维度：

```txt
filesystem:
- none
- read
- workspace-write
- full-write

shell:
- disabled
- approval-required
- allowlist-only
- trusted

network:
- disabled
- domain-allowlist
- full-access

secrets:
- no-secrets
- env-read
- credential-vault

git:
- read
- commit
- push requires strong confirmation

mcp/lsp:
- explicit server names or capability names
```

启用插件时，用户应该看到类似信息：

```txt
此插件请求：
- 读取当前 workspace 文件
- 修改 workspace 文件
- 执行 shell 命令，需要确认
- 连接 company-docs MCP server
- 访问 github.com
```

### 5.1 Permission Broker

Permission Broker 负责统一决策：

- 插件工具是否能读/写文件。
- 插件 hook 是否能执行命令。
- 插件是否能连接网络或 MCP server。
- 插件是否能读取环境变量或凭据。
- YOLO 开启时哪些权限仍需强确认，例如 `git push --force`、删除大量文件、读取 secrets。

## 6. 作用域和优先级

建议支持以下作用域：

| 作用域 | 路径示例 | 用途 |
| --- | --- | --- |
| builtin | `<quickforge>/plugins` | QuickForge 随包内置能力。 |
| user | `~/.quickforge/plugins` | 当前用户私有插件。 |
| shared-user | `~/.agents/plugins` | 多 Agent 工具共享插件。 |
| project | `<project>/.quickforge/plugins` | 项目专属插件。 |
| managed | 组织托管源，未来支持 | 团队/企业统一分发。 |

同名插件建议优先级：

```txt
project > user > shared-user > builtin
```

原因：越靠近当前项目的能力越应覆盖通用默认能力。

## 7. 架构分层

```txt
Plugin Manager
  安装、卸载、启用、禁用、版本和作用域管理

Plugin Registry
  扫描插件目录、解析 manifest、建立 capability index

Capability Loader
  加载 skills、commands、hooks、tools、mcp、agents、lsp、monitors、context

Permission Broker
  统一控制文件、shell、network、secrets、git、mcp、lsp 权限

Event Bus
  分发 SessionStart、BeforeToolCall、AfterFileEdit 等生命周期事件

Context Router
  根据用户任务、项目类型、文件上下文和插件 catalog 决定暴露哪些能力

Tool Runtime
  执行 workspace tools、plugin tools、MCP tools、LSP tools

Audit Logger
  记录插件加载、权限请求、hook 触发、工具调用、文件和命令影响
```

核心链路：

```txt
用户输入
  ↓
Context Router 判断任务类型
  ↓
加载相关 Skill / Command / Agent / Plugin Context
  ↓
Agent Planner 制定计划
  ↓
工具调用进入 Permission Broker
  ↓
Tool Runtime 执行 Tool / MCP / Shell / File / LSP
  ↓
Event Bus 触发 Hook
  ↓
Audit Logger 记录
```

## 8. 与现有 QuickForge 模块映射

| 插件能力 | QuickForge 现有模块 | 说明 |
| --- | --- | --- |
| `tools` | `server/plugins/*`、`server/tool-wiring.mjs`、`server/agent-manager.mjs` | MVP 已接入 Agent tools 和 direct tool execution。 |
| `skills` | `server/skills.mjs`、Skills routes/UI | 应作为插件打包能力接入，保持渐进加载。 |
| `commands` | `server/custom-commands.mjs` | 插件命令应进入统一 slash command catalog。 |
| `mcpServers` | `server/mcp/*` | 插件提供 MCP presets，用户确认后启用。 |
| `agents` | `server/agent-profiles.mjs`、`server/agent-manager.mjs` | 插件贡献 Agent Profile/Subagent。 |
| `hooks` | 新增 `server/plugins/events.mjs`、`server/plugins/hooks.mjs` | 接入工具调用、文件编辑、shell 执行等生命周期。 |
| `lspServers` | 后续新增 LSP runtime | 提供定义、引用、诊断等代码智能工具。 |
| `monitors` | 后续新增 monitor runtime | 后台监听和主动提醒。 |
| `permissions` | 工具审批/YOLO + 新增 Permission Broker | 从展示字段升级为执行前强校验。 |
| `audit` | 命令日志 + 新增插件审计日志 | 记录插件行为和影响。 |

## 9. 当前 MVP 状态

QuickForge 当前插件 MVP/V1 已支持：

- 本地插件目录扫描：`~/.quickforge/plugins`、`~/.agents/plugins`、`<project>/.quickforge/plugins`。
- `plugin.json` manifest 解析和基础校验。
- 插件启用/禁用、配置保存和 reload API。
- 本地可信 Node.js ESM 入口加载。
- `contributes.tools` 注入 Agent 工具链和 direct tool execution。
- `contributes.skills` 静态目录贡献：启用插件后，插件 Skill 自动参与项目 Agent 的 available skills catalog，并继续通过 `activate_skill` / `read_skill_resource` 渐进加载。
- `contributes.commands` 静态文件/目录贡献：启用插件后，插件 slash command 自动参与项目命令发现，项目本地命令可覆盖插件命令。
- YOLO 关闭时插件工具走审批逻辑。
- 插件加载失败不会导致服务崩溃，插件页展示错误。

当前限制：

- `contributes.skills` / `contributes.commands` 只支持静态文件贡献，不支持动态 JS 生成。
- `permissions` 主要用于展示和后续强校验，尚未形成完整 Permission Broker。
- 尚不支持 hooks、MCP presets、Agent/Subagent、LSP、monitors、marketplace 或 plugin lockfile。
- 不支持 UI 插件、npm 安装、插件市场、动态后端路由、自动更新、依赖管理或强沙箱。
- 插件是本地可信 Node.js ESM 代码。

## 10. 分阶段落地路线

### V1：Agent Capability Plugin 基础版

状态：`contributes.skills`、`contributes.commands`、`contributes.tools` 已支持基础形态。

已支持：

```txt
plugin.json
skills/
commands/
permissions
```

已交付：

- 插件可声明 `contributes.skills`。
- 插件可声明 `contributes.commands`。
- Plugin Registry 输出基础 capability index。
- Skills 和 Commands 可以按插件启用状态参与发现。
- 插件权限在插件状态中展示。

待补：

- openai documents/presentations/spreadsheets 作为内置插件包接入，第一阶段只启用 skills/commands。

### V1.5：Hooks + Policy

支持：

```txt
BeforeToolCall
AfterToolCall
BeforeShellExec
AfterShellExec
BeforeFileEdit
AfterFileEdit
OnError
ContextCompaction
```

交付：

- Event Bus。
- Hook Runner。
- 危险命令拦截。
- 文件编辑后自动 lint/test 的 approval-required 流程。
- Hook 审计日志。

### V2：MCP / Agents / LSP

支持：

```txt
mcpServers
agents
lspServers
```

交付：

- 插件 MCP presets。
- 插件 Agent Profiles/Subagents。
- LSP server 配置和 Agent LSP tools。
- Permission Broker 初版强校验。

### V3：Distribution / Marketplace / Managed Plugins

支持：

```txt
plugin install
plugin update
plugin lockfile
marketplace
managed plugins
audit/eval
```

交付：

- 插件安装源和缓存。
- 插件版本锁。
- 组织托管插件。
- 安全审计和效果评估。

## 11. openai-primary-runtime 的内置策略

参考目录：

```txt
C:\Users\xiaohao\.codex\plugins\cache\openai-primary-runtime
```

该目录实际包含三个文件类型能力包：

```txt
documents
presentations
spreadsheets
```

它们的结构更接近 Codex 风格插件：manifest + skills + resources + scripts，而不是纯 tools 插件。QuickForge 不在运行时依赖该 cache 路径，也不直接扫描 `.codex` cache。

当前 QuickForge 已内置三个静态 Agent 能力插件包：

```txt
plugins/openai-documents/
  plugin.json
  skills/documents/SKILL.md
  commands/document.md

plugins/openai-presentations/
  plugin.json
  skills/presentations/SKILL.md
  commands/presentation.md

plugins/openai-spreadsheets/
  plugin.json
  skills/spreadsheets/SKILL.md
  commands/spreadsheet.md
```

当前阶段：

- 作为 QuickForge bundled plugins，随发布包包含在 `plugins/` 目录。
- `enabledByDefault: true`，用户仍可显式禁用。
- 只启用 `skills` / `commands` 能力。
- 已 QuickForge 化适配，避免要求 QuickForge 必须存在 Codex workspace dependency 或 `@oai/artifact-tool`。
- 不复制 `node_modules`、凭据、token、cache、`.env` 或其他敏感文件。
- 不新增运行时依赖。

后续阶段：

- 把可独立运行的脚本适配为 QuickForge tools。
- 如需完整 DOCX/PPTX/XLSX artifact runtime，再评估是否引入或替代 `@oai/artifact-tool`。

## 12. 非目标

短期不做：

- 运行时 React UI 插件。
- 插件市场或 npm 安装。
- 插件自动更新。
- 强沙箱隔离。
- 动态注册任意后端路由。
- 直接依赖 Codex cache 路径。

这些能力可以在权限、分发和审计成熟后再评估。
