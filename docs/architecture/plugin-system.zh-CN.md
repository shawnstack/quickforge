# QuickForge 插件系统

QuickForge 插件系统定位为 **Agent 能力插件系统**，不是传统 IDE UI 插件系统。插件是可安装、可版本化、可权限控制的 Agent 能力包，用于向 Agent 增加流程、工具、上下文、权限、自动化事件和子任务能力。

```txt
Agent Plugin = Skill + Command + Hook + Tool/MCP + Agent/Subagent + Context + Permission + Distribution + Audit
```

完整设计见：[Agent 能力插件系统](./agent-plugin-system.zh-CN.md)。

## 当前 V1 定位

当前已落地的是 Agent 能力插件系统的 V1 基础能力：通用插件基础设施 + `contributes.tools` + 静态 `contributes.skills` / `contributes.commands`。

已支持：

- 本地插件目录扫描。
- `plugin.json` manifest 解析/校验。
- 插件启用/禁用。
- 插件配置 API。
- 本地可信 Node.js ESM 入口加载。
- 插件贡献 Agent tools。
- 插件 tools 注入 Agent 工具链。
- 插件 tools 支持 direct tool execution。
- 插件静态 `contributes.skills`：启用插件后自动加入项目 Agent 的 available skills catalog，并继续通过 `activate_skill` / `read_skill_resource` 渐进加载。
- 插件静态 `contributes.commands`：启用插件后自动加入项目 slash command 发现，项目本地命令可覆盖插件命令。
- YOLO 关闭时插件工具走审批逻辑，类似 MCP。
- 插件加载失败不导致服务崩溃，插件页展示错误。

当前暂未实现但已纳入 Agent 能力插件架构：

- `contributes.hooks`
- `contributes.mcpServers`
- `contributes.agents`
- `contributes.lspServers`
- `contributes.monitors`
- 完整 Permission Broker
- Audit Logger
- Marketplace / install / update / lockfile

## 搜索路径

当前 QuickForge 会扫描：

- `<quickforge>/plugins`，QuickForge 随包内置插件
- `~/.quickforge/plugins`
- `~/.agents/plugins`
- `<project>/.quickforge/plugins`

同名插件优先级当前遵循现有实现：项目上下文中的插件会参与发现，非 legacy 路径优先于 `~/.agents/plugins`。整体优先级为：

```txt
project > user > shared-user > builtin
```

## 插件目录结构

当前 tools MVP 示例：

```txt
example-plugin/
  plugin.json
  index.mjs
  README.md
```

面向 Agent 能力插件系统的推荐结构：

```txt
example-plugin/
  plugin.json
  skills/
  commands/
  hooks/
  tools/
  mcp/
  agents/
  lsp/
  monitors/
  context/
  assets/
```

插件可以只包含其中一部分能力。

## Manifest 示例：当前 tools MVP

```json
{
  "name": "example-plugin",
  "displayName": "Example Plugin",
  "version": "0.1.0",
  "description": "Example QuickForge plugin.",
  "apiVersion": 1,
  "main": "index.mjs",
  "permissions": ["workspace:read"],
  "contributes": {
    "tools": [
      {
        "name": "echo",
        "description": "Echo input text.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "text": { "type": "string" }
          },
          "required": ["text"]
        }
      }
    ]
  }
}
```

实际注入给 Agent 的工具名为：

```txt
plugin__example-plugin__echo
```

## Manifest 示例：未来 Agent 能力插件

```json
{
  "name": "java-quality-plugin",
  "displayName": "Java Quality Plugin",
  "version": "1.0.0",
  "description": "Java/Spring Boot quality workflows, review agents, hooks, and MCP integrations.",
  "apiVersion": 1,
  "quickforgeVersion": ">=1.3.0",
  "author": "team-ai",
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
      "domains": ["github.com"]
    },
    "secrets": "no-secrets",
    "git": ["read"]
  }
}
```

## 插件入口示例

当前 tools MVP 使用本地可信 Node.js ESM 入口：

```js
export async function createPlugin(context) {
  return {
    tools: {
      async echo(args) {
        return {
          content: args.text || '',
          details: { echoed: true }
        }
      }
    }
  }
}
```

`createPlugin(context)` 会收到插件元信息、插件配置和项目上下文。工具 handler 返回字符串或 `{ content, details, isError }`。

## API

- `GET /api/plugins`：获取插件列表、搜索路径和发现错误。
- `POST /api/plugins/reload`：重新扫描插件并刷新已运行会话的工具列表。
- `GET /api/plugins/:name`：获取单个插件信息。
- `PUT /api/plugins/:name/enabled`：启用或禁用插件。
- `PUT /api/plugins/:name/config`：保存插件配置。

## Composer `@` 触发

聊天输入框支持用 `@` 触发已启用插件列表。前端从 `/api/plugins` 读取 `enabled && status === 'loaded'` 的插件，并以插件维度展示；例如内置插件只显示：

- Documents
- Presentations
- Spreadsheets

选中插件后，输入框会插入可见 mention，例如 `@Documents`。发送时客户端同时附带结构化 `selectedCapabilities` metadata；服务端只在本轮上下文里注入“优先使用该插件/能力”的路由提示，不污染用户可见消息。该机制不会绕过工具权限审批，也不会强制 Agent 使用无关能力。

## 权限模型

当前 `permissions` 字段主要用于展示和未来强校验，不承诺完整沙箱隔离。

后续目标是引入 Permission Broker，统一治理：

- 文件读写
- shell 执行
- 网络访问
- secrets / credential vault
- Git 操作
- MCP / LSP 连接
- Hook 自动执行

插件启用时应明确展示它请求的权限。危险能力即使在 YOLO 模式下，也可要求强确认。

## 当前限制

- 不支持从 npm、URL 或 marketplace 安装插件。
- 不支持插件动态注册后端路由。
- 不支持运行时加载 React UI 组件。
- 不提供强沙箱隔离；插件入口是本地可信 Node.js ESM 代码。
- 当前实际扩展点主要是 Agent tools、静态 Agent Skills 和静态 slash commands。

## 分阶段路线

### V1：Agent Capability Plugin 基础版

状态：基础能力已落地。

- `contributes.skills`
- `contributes.commands`
- 基础权限展示
- 基础 capability index
- 内置 openai documents / presentations / spreadsheets 插件包，当前只接入 skills/commands

### V1.5：Hooks + Policy

- Event Bus
- Hook Runner
- Before/After ToolCall、ShellExec、FileEdit
- 危险命令拦截
- 自动 lint/test approval flow

### V2：MCP / Agent / LSP

- MCP presets
- 插件 Agent Profiles/Subagents
- LSP server 配置和 Agent LSP tools
- Permission Broker 强校验

### V3：Distribution / Marketplace / Audit

- plugin install/update
- plugin lockfile
- managed plugins
- marketplace
- audit/eval
