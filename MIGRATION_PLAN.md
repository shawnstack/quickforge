# HappyCode 到 FastCode 迁移计划

## 项目概述

### 原项目信息
- **名称**: HappyCode
- **技术栈**: TypeScript + React + Ink + Node.js
- **路径**: `D:\code\happy-code`
- **核心功能**: 基于 OpenAI API 的 TUI 聊天代理，支持多代理协作

### 目标项目信息
- **名称**: FastCode
- **技术栈**: Rust + Ratatui + Tokio + Crossterm
- **路径**: `D:\code\fastcode`
- **目标**: 高性能、内存安全的原生 TUI 应用

---

## 一、技术栈映射

### 1.1 核心框架映射

| 原 TypeScript | 目标 Rust | 说明 |
|--------------|-----------|------|
| React 18 | Ratatui | 声明式 UI 框架 |
| Ink 5 | Ratatui + Crossterm | 终端渲染引擎 |
| Node.js 事件循环 | Tokio Runtime | 异步运行时 |
| TypeScript 类型系统 | Rust 类型系统 | 静态类型 |

### 1.2 依赖映射

| npm 包 | crates.io 对应 | 用途 |
|--------|---------------|------|
| `openai` | `async-openai` | OpenAI API 客户端 |
| `commander` | `clap` | CLI 参数解析 |
| `fast-glob` | `glob` / `globset` | 文件模式匹配 |
| `clipboardy` | `arboard` / `cli-clipboard` | 剪贴板操作 |
| `ink-spinner` | 自实现 / `ratatui::widgets::Spinner` | 加载动画 |
| `ink-text-input` | `tui-textarea` / 自实现 | 文本输入 |
| - | `serde` / `serde_json` | JSON 序列化 |
| - | `tokio` | 异步运行时 |
| - | `crossterm` | 终端控制 |
| - | `anyhow` / `thiserror` | 错误处理 |
| - | `tracing` / `tracing-subscriber` | 日志系统 |
| - | `dirs` | 用户目录获取 |
| - | `regex` | 正则表达式 |
| - | `chrono` | 时间处理 |

### 1.3 新增 Rust 依赖

```toml
[dependencies]
# 异步运行时
tokio = { version = "1", features = ["full"] }

# TUI 框架
ratatui = "0.28"
crossterm = { version = "0.28", features = ["event-stream"] }

# CLI
clap = { version = "4", features = ["derive"] }

# OpenAI API
async-openai = "0.27"

# 序列化
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# 错误处理
anyhow = "1"
thiserror = "2"

# 文件系统
glob = "0.3"
globset = "0.4"
dirs = "5"

# 文本处理
regex = "1"

# 时间
chrono = { version = "0.4", features = ["serde"] }

# 日志
tracing = "0.1"
tracing-subscriber = "0.3"

# 剪贴板
arboard = "3"

# 其他
uuid = { version = "1", features = ["v4", "serde"] }
futures = "0.3"
async-trait = "0.1"
tokio-stream = "0.1"

[dev-dependencies]
tokio-test = "0.4"
tempfile = "3"
```

---

## 二、项目结构设计

### 2.1 目录结构

```
D:\code\fastcode\
├── Cargo.toml                 # 项目配置
├── Cargo.lock                 # 依赖锁定
├── README.md                  # 使用文档
├── .gitignore
├── src/
│   ├── main.rs               # 入口点
│   ├── lib.rs                # 库导出
│   │
│   ├── cli/                  # CLI 模块
│   │   ├── mod.rs
│   │   ├── commands.rs       # 命令定义
│   │   └── args.rs           # 参数解析
│   │
│   ├── agent/                # 核心 Agent 模块
│   │   ├── mod.rs
│   │   ├── agent.rs          # HappyCodeAgent 对应
│   │   ├── stream.rs         # 流式输出处理
│   │   └── tool_loop.rs      # 工具调用循环
│   │
│   ├── tools/                # 工具系统
│   │   ├── mod.rs
│   │   ├── registry.rs       # 工具注册表
│   │   ├── base.rs           # 工具 trait
│   │   ├── file_ops.rs       # 文件操作工具
│   │   ├── shell.rs          # Shell 命令工具
│   │   ├── git.rs            # Git 工具
│   │   └── user.rs           # 用户交互工具
│   │
│   ├── modes/                # 运行模式
│   │   ├── mod.rs
│   │   ├── runtime_mode.rs   # 运行模式定义
│   │   └── policy.rs         # 模式策略
│   │
│   ├── session/              # 会话管理
│   │   ├── mod.rs
│   │   ├── manager.rs        # 会话管理器
│   │   ├── store.rs          # 会话存储
│   │   └── history.rs        # 输入历史
│   │
│   ├── policy/               # 安全策略
│   │   ├── mod.rs
│   │   ├── config.rs         # 策略配置
│   │   ├── validator.rs      # 命令验证
│   │   └── defaults.rs       # 默认策略
│   │
│   ├── approvals/            # 命令审批
│   │   ├── mod.rs
│   │   ├── manager.rs        # 审批管理器
│   │   └── store.rs          # 审批存储
│   │
│   ├── audit/                # 审计系统
│   │   ├── mod.rs
│   │   ├── logger.rs         # 审计日志
│   │   └── entry.rs          # 日志条目
│   │
│   ├── mcp/                  # MCP 集成
│   │   ├── mod.rs
│   │   ├── config.rs         # MCP 配置
│   │   ├── client.rs         # MCP 客户端
│   │   └── protocol.rs       # JSON-RPC 协议
│   │
│   ├── memory/               # 记忆系统
│   │   ├── mod.rs
│   │   ├── store.rs          # 记忆存储
│   │   └── sections.rs       # 记忆分区
│   │
│   ├── rollback/             # 回滚系统
│   │   ├── mod.rs
│   │   ├── snapshot.rs       # 快照管理
│   │   └── restore.rs        # 回滚恢复
│   │
│   ├── agents/               # 多代理系统
│   │   ├── mod.rs
│   │   ├── types.rs          # 代理类型
│   │   ├── runner.rs         # 代理运行器
│   │   ├── orchestrator.rs   # 编排器
│   │   ├── planner.rs        # 计划代理
│   │   ├── tasker.rs         # 任务代理
│   │   ├── replanner.rs      # 重计划代理
│   │   ├── coder.rs          # 编码代理
│   │   └── reviewer.rs       # 审查代理
│   │
│   ├── plan/                 # 计划模式
│   │   ├── mod.rs
│   │   ├── state.rs          # 计划状态
│   │   ├── task.rs           # 任务定义
│   │   └── events.rs         # 事件追踪
│   │
│   ├── ui/                   # TUI 界面
│   │   ├── mod.rs
│   │   ├── app.rs            # 主应用状态
│   │   ├── terminal.rs       # 终端设置
│   │   ├── event.rs          # 事件处理
│   │   ├── components/
│   │   │   ├── mod.rs
│   │   │   ├── chat.rs       # 聊天界面
│   │   │   ├── input.rs      # 输入框
│   │   │   ├── messages.rs   # 消息列表
│   │   │   ├── toolbar.rs    # 工具栏
│   │   │   ├── status_bar.rs # 状态栏
│   │   │   ├── spinner.rs    # 加载动画
│   │   │   ├── approval.rs   # 审批对话框
│   │   │   ├── session.rs    # 会话选择
│   │   │   └── rollback.rs   # 回滚选择
│   │   └── theme.rs          # 主题配置
│   │
│   └── config/               # 配置管理
│       ├── mod.rs
│       ├── settings.rs       # 全局配置
│       └── paths.rs          # 路径管理
│
└── tests/                    # 测试
    ├── integration/
    └── unit/
```

---

## 三、模块迁移详细计划

### 3.1 配置模块 (`config/`)

**原文件**: `src/config.ts`

**功能**:
- 管理 `~/.happycode/config.json`
- 支持 baseUrl, apiKey, model, maxTurns 配置

**Rust 实现**:

```rust
// src/config/settings.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default = "default_max_turns")]
    pub max_turns: u32,
}

fn default_max_turns() -> u32 { 24 }

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            max_turns: 24,
        }
    }
}

impl Settings {
    pub fn load() -> anyhow::Result<Self> {
        let path = Self::config_path()?;
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = Self::config_path()?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    pub fn config_path() -> anyhow::Result<PathBuf> {
        Ok(dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("无法获取配置目录"))?
            .join("fastcode")
            .join("config.json"))
    }
}
```

**迁移优先级**: P0 (最高)
**预估工作量**: 2 小时

---

### 3.2 运行模式模块 (`modes/`)

**原文件**: `src/modes.ts`

**功能**:
- 定义三种模式: plan, edit, auto
- 各模式有不同的写入/执行权限

**Rust 实现**:

```rust
// src/modes/runtime_mode.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeMode {
    Plan,
    Edit,
    Auto,
}

impl RuntimeMode {
    pub fn can_write(&self) -> bool {
        matches!(self, RuntimeMode::Edit | RuntimeMode::Auto)
    }

    pub fn can_execute(&self) -> bool {
        matches!(self, RuntimeMode::Edit | RuntimeMode::Auto)
    }

    pub fn requires_approval(&self) -> bool {
        matches!(self, RuntimeMode::Edit)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RuntimeMode::Plan => "plan",
            RuntimeMode::Edit => "edit",
            RuntimeMode::Auto => "auto",
        }
    }
}

impl Default for RuntimeMode {
    fn default() -> Self {
        RuntimeMode::Edit
    }
}

impl std::fmt::Display for RuntimeMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}
```

**迁移优先级**: P0
**预估工作量**: 1 小时

---

### 3.3 安全策略模块 (`policy/`)

**原文件**: `src/policy.ts`

**功能**:
- 加载 `.happycode-policy.json`
- 定义 allowShellPrefixes, denyShellPatterns, protectedPaths
- 支持项目级和全局级策略

**Rust 实现**:

```rust
// src/policy/config.rs
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PolicyConfig {
    #[serde(default)]
    pub allow_shell_prefixes: Vec<String>,
    #[serde(default)]
    pub deny_shell_patterns: Vec<String>,
    #[serde(default)]
    pub protected_paths: Vec<String>,
}

// src/policy/validator.rs
use regex::RegexSet;

pub struct PolicyValidator {
    allow_prefixes: Vec<String>,
    deny_patterns: RegexSet,
    protected_paths: Vec<String>,
}

impl PolicyValidator {
    pub fn new(config: &PolicyConfig) -> anyhow::Result<Self> {
        Ok(Self {
            allow_prefixes: config.allow_shell_prefixes.clone(),
            deny_patterns: RegexSet::new(&config.deny_shell_patterns)?,
            protected_paths: config.protected_paths.clone(),
        })
    }

    pub fn is_command_allowed(&self, command: &str) -> Result<(), PolicyError> {
        // 检查拒绝模式
        if self.deny_patterns.is_match(command) {
            return Err(PolicyError::DeniedPattern);
        }

        // 检查允许前缀
        for prefix in &self.allow_prefixes {
            if command.starts_with(prefix) {
                return Ok(());
            }
        }

        Err(PolicyError::NotInAllowList)
    }

    pub fn is_path_protected(&self, path: &str) -> bool {
        self.protected_paths.iter().any(|p| path.contains(p))
    }
}
```

**迁移优先级**: P0
**预估工作量**: 3 小时

---

### 3.4 审批系统模块 (`approvals/`)

**原文件**: `src/approvals.ts`

**功能**:
- 管理命令审批 (allow_once, allow_session, allow_global)
- 持久化到 `~/.happycode/approvals.json`

**Rust 实现**:

```rust
// src/approvals/manager.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ApprovalType {
    AllowOnce,
    AllowSession,
    AllowGlobal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Approval {
    pub prefix: String,
    pub approval_type: ApprovalType,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub struct ApprovalManager {
    approvals: Vec<Approval>,
    path: PathBuf,
}

impl ApprovalManager {
    pub fn is_approved(&self, command: &str, session_id: &str) -> Option<&Approval> {
        self.approvals.iter().find(|a| {
            command.starts_with(&a.prefix) && match a.approval_type {
                ApprovalType::AllowGlobal => true,
                ApprovalType::AllowSession => true, // 需要检查 session
                ApprovalType::AllowOnce => false,
            }
        })
    }

    pub fn add_approval(&mut self, prefix: String, approval_type: ApprovalType) -> anyhow::Result<()> {
        // 实现添加审批
    }

    pub fn save(&self) -> anyhow::Result<()> {
        // 实现持久化
    }
}
```

**迁移优先级**: P0
**预估工作量**: 2 小时

---

### 3.5 审计系统模块 (`audit/`)

**原文件**: `src/audit.ts`

**功能**:
- 记录工具调用日志
- 存储到 `~/.happycode/audit.log`

**Rust 实现**:

```rust
// src/audit/entry.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub tool: String,
    pub mode: String,
    pub success: bool,
    pub input: String,
    pub summary: String,
}

// src/audit/logger.rs
use std::fs::OpenOptions;
use std::io::Write;

pub struct AuditLogger {
    file: std::fs::File,
}

impl AuditLogger {
    pub fn new() -> anyhow::Result<Self> {
        let path = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("无法获取配置目录"))?
            .join("fastcode")
            .join("audit.log");

        std::fs::create_dir_all(path.parent().unwrap())?;

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;

        Ok(Self { file })
    }

    pub fn log(&mut self, entry: &AuditEntry) -> anyhow::Result<()> {
        let json = serde_json::to_string(entry)?;
        writeln!(self.file, "{}", json)?;
        Ok(())
    }
}
```

**迁移优先级**: P1
**预估工作量**: 2 小时

---

### 3.6 会话管理模块 (`session/`)

**原文件**: `src/session.ts`

**功能**:
- 会话持久化 (`~/.happycode/sessions/`)
- 会话切换、恢复、分叉
- 输入历史管理
- 审批绑定

**Rust 实现**:

```rust
// src/session/manager.rs
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub messages: Vec<Message>,
    pub input_history: Vec<String>,
    pub approvals: Vec<String>,
    pub current_mode: RuntimeMode,
}

pub struct SessionManager {
    current_session: Option<Session>,
    sessions_dir: PathBuf,
}

impl SessionManager {
    pub fn new() -> anyhow::Result<Self> {
        let sessions_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("无法获取配置目录"))?
            .join("fastcode")
            .join("sessions");

        std::fs::create_dir_all(&sessions_dir)?;

        Ok(Self {
            current_session: None,
            sessions_dir,
        })
    }

    pub fn create(&mut self, name: Option<String>) -> anyhow::Result<Session> {
        let session = Session {
            id: Uuid::new_v4().to_string(),
            name: name.unwrap_or_else(|| format!("session-{}", chrono::Utc::now().format("%Y%m%d-%H%M%S"))),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            messages: Vec::new(),
            input_history: Vec::new(),
            approvals: Vec::new(),
            current_mode: RuntimeMode::default(),
        };

        self.save_session(&session)?;
        self.current_session = Some(session.clone());
        Ok(session)
    }

    pub fn load(&mut self, id: &str) -> anyhow::Result<Session> {
        let path = self.sessions_dir.join(format!("{}.json", id));
        let content = std::fs::read_to_string(&path)?;
        let session: Session = serde_json::from_str(&content)?;
        self.current_session = Some(session.clone());
        Ok(session)
    }

    pub fn save_session(&self, session: &Session) -> anyhow::Result<()> {
        let path = self.sessions_dir.join(format!("{}.json", session.id));
        let content = serde_json::to_string_pretty(session)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    pub fn list(&self) -> anyhow::Result<Vec<SessionMeta>> {
        // 列出所有会话
    }
}
```

**迁移优先级**: P0
**预估工作量**: 4 小时

---

### 3.7 工具系统模块 (`tools/`)

**原文件**: `src/tools.ts`

**功能**:
- 定义内置工具
- 工具执行和权限检查
- 结果格式化

**Rust 实现**:

```rust
// src/tools/base.rs
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value, // JSON Schema
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    pub mode: RuntimeMode,
    pub working_dir: PathBuf,
    pub policy: PolicyValidator,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;

    async fn execute(&self, args: Value, ctx: &ToolContext) -> anyhow::Result<String>;

    fn requires_write(&self) -> bool {
        false
    }

    fn requires_execute(&self) -> bool {
        false
    }

    fn requires_approval(&self) -> bool {
        false
    }
}

// src/tools/file_ops.rs
pub struct ListFilesTool;

#[async_trait]
impl Tool for ListFilesTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_files".to_string(),
            description: "列出目录下的文件".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "pattern": {"type": "string"}
                }
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> anyhow::Result<String> {
        let path = args["path"].as_str().unwrap_or(".");
        let pattern = args["pattern"].as_str().unwrap_or("*");

        let full_path = ctx.working_dir.join(path);
        let glob_pattern = full_path.join(pattern);

        let entries: Vec<String> = glob::glob(glob_pattern.to_str().unwrap())?
            .filter_map(|e| e.ok())
            .map(|e| e.display().to_string())
            .collect();

        Ok(entries.join("\n"))
    }
}

// src/tools/shell.rs
pub struct RunShellTool {
    approval_manager: Arc<Mutex<ApprovalManager>>,
}

#[async_trait]
impl Tool for RunShellTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "run_shell".to_string(),
            description: "执行 Shell 命令".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string"}
                },
                "required": ["command"]
            }),
        }
    }

    fn requires_execute(&self) -> bool {
        true
    }

    fn requires_approval(&self) -> bool {
        true
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> anyhow::Result<String> {
        let command = args["command"].as_str()
            .ok_or_else(|| anyhow::anyhow!("缺少 command 参数"))?;

        // 策略检查
        ctx.policy.is_command_allowed(command)?;

        // 审批检查
        self.check_approval(command).await?;

        // 执行命令
        let output = tokio::process::Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(&ctx.working_dir)
            .output()
            .await?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(anyhow::anyhow!("{}", String::from_utf8_lossy(&output.stderr)))
        }
    }
}
```

**迁移优先级**: P0
**预估工作量**: 8 小时

---

### 3.8 核心 Agent 模块 (`agent/`)

**原文件**: `src/agent.ts`

**功能**:
- 封装 OpenAI API 调用
- 流式输出处理
- 工具调用循环
- MCP 工具集成

**Rust 实现**:

```rust
// src/agent/agent.rs
use async_openai::{Client, config::OpenAIConfig};
use async_openai::types::{
    ChatCompletionRequestMessage,
    ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessageArgs,
    CreateChatCompletionRequestArgs,
    ChatCompletionTool,
};
use futures::StreamExt;

pub struct FastCodeAgent {
    client: Client<OpenAIConfig>,
    model: String,
    tools: Vec<Arc<dyn Tool>>,
    mcp_tools: Vec<ChatCompletionTool>,
}

impl FastCodeAgent {
    pub fn new(config: &Settings, tools: Vec<Arc<dyn Tool>>) -> Self {
        let openai_config = OpenAIConfig::new()
            .with_api_key(&config.api_key)
            .with_api_base(&config.base_url);

        Self {
            client: Client::with_config(openai_config),
            model: config.model.clone(),
            tools,
            mcp_tools: Vec::new(),
        }
    }

    pub async fn chat_stream(
        &self,
        messages: Vec<ChatCompletionRequestMessage>,
        sender: mpsc::Sender<AgentEvent>,
    ) -> anyhow::Result<String> {
        let tool_definitions: Vec<ChatCompletionTool> = self.tools
            .iter()
            .map(|t| self.tool_to_openai_tool(t.definition()))
            .collect();

        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(messages)
            .tools(tool_definitions)
            .stream(true)
            .build()?;

        let mut stream = self.client.chat().create_stream(request).await?;

        let mut full_content = String::new();
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    for choice in response.choices {
                        if let Some(delta) = &choice.delta {
                            // 发送内容增量
                            if let Some(content) = &delta.content {
                                full_content.push_str(content);
                                sender.send(AgentEvent::Content(content.clone())).await?;
                            }

                            // 收集工具调用
                            if let Some(calls) = &delta.tool_calls {
                                for call in calls {
                                    // 处理工具调用...
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    sender.send(AgentEvent::Error(e.to_string())).await?;
                }
            }
        }

        // 处理工具调用
        if !tool_calls.is_empty() {
            for call in tool_calls {
                sender.send(AgentEvent::ToolCall(call.clone())).await?;
                let result = self.execute_tool(&call).await?;
                sender.send(AgentEvent::ToolResult(result)).await?;
            }
        }

        Ok(full_content)
    }

    async fn execute_tool(&self, call: &ToolCall) -> anyhow::Result<String> {
        let tool = self.tools.iter()
            .find(|t| t.definition().name == call.function.name)
            .ok_or_else(|| anyhow::anyhow!("工具不存在: {}", call.function.name))?;

        let args: Value = serde_json::from_str(&call.function.arguments)?;
        let ctx = ToolContext::default();

        tool.execute(args, &ctx).await
    }
}

pub enum AgentEvent {
    Content(String),
    ToolCall(ToolCall),
    ToolResult(String),
    Error(String),
    Complete,
}
```

**迁移优先级**: P0
**预估工作量**: 6 小时

---

### 3.9 MCP 集成模块 (`mcp/`)

**原文件**: `src/mcp.ts`, `src/mcp_client.ts`

**功能**:
- JSON-RPC 2.0 协议实现
- 子进程管理
- 工具动态发现

**Rust 实现**:

```rust
// src/mcp/protocol.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

// src/mcp/client.rs
use tokio::process::{Child, Command, ChildStdin, ChildStdout};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct McpClient {
    process: Child,
    stdin: ChildStdin,
    stdout_reader: BufReader<ChildStdout>,
    request_id: u64,
}

impl McpClient {
    pub async fn start(config: &McpServerConfig) -> anyhow::Result<Self> {
        let mut process = Command::new(&config.command)
            .args(&config.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()?;

        let stdin = process.stdin.take().ok_or_else(|| anyhow::anyhow!("无法获取 stdin"))?;
        let stdout = process.stdout.take().ok_or_else(|| anyhow::anyhow!("无法获取 stdout"))?;
        let stdout_reader = BufReader::new(stdout);

        Ok(Self {
            process,
            stdin,
            stdout_reader,
            request_id: 0,
        })
    }

    pub async fn list_tools(&mut self) -> anyhow::Result<Vec<ToolDefinition>> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_id(),
            method: "tools/list".to_string(),
            params: None,
        };

        let response = self.send_request(&request).await?;

        // 解析工具列表
        let tools: Vec<ToolDefinition> = serde_json::from_value(
            response.result.unwrap_or_default()
        )?;

        Ok(tools)
    }

    pub async fn call_tool(&mut self, name: &str, args: Value) -> anyhow::Result<String> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: self.next_id(),
            method: "tools/call".to_string(),
            params: Some(json!({
                "name": name,
                "arguments": args
            })),
        };

        let response = self.send_request(&request).await?;

        Ok(serde_json::to_string(&response.result)?)
    }

    async fn send_request(&mut self, request: &JsonRpcRequest) -> anyhow::Result<JsonRpcResponse> {
        let json = serde_json::to_string(request)?;
        self.stdin.write_all(json.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;

        let mut line = String::new();
        self.stdout_reader.read_line(&mut line).await?;

        let response: JsonRpcResponse = serde_json::from_str(&line)?;
        Ok(response)
    }

    fn next_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }
}
```

**迁移优先级**: P1
**预估工作量**: 6 小时

---

### 3.10 记忆系统模块 (`memory/`)

**原文件**: `src/memory.ts`

**功能**:
- 用户记忆和项目记忆
- Markdown 格式存储
- 分区管理

**Rust 实现**:

```rust
// src/memory/store.rs
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct MemorySection {
    pub title: String,
    pub content: String,
}

pub struct MemoryStore {
    user_memory_path: PathBuf,
    project_memory_path: Option<PathBuf>,
}

impl MemoryStore {
    pub fn new(project_dir: &Path) -> anyhow::Result<Self> {
        let user_memory_path = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("无法获取配置目录"))?
            .join("fastcode")
            .join("memory_user.md");

        let project_memory_path = if project_dir.join(".fastcode-memory.md").exists() {
            Some(project_dir.join(".fastcode-memory.md"))
        } else {
            None
        };

        Ok(Self {
            user_memory_path,
            project_memory_path,
        })
    }

    pub fn load(&self) -> anyhow::Result<Vec<MemorySection>> {
        let mut sections = Vec::new();

        // 加载用户记忆
        if self.user_memory_path.exists() {
            let content = std::fs::read_to_string(&self.user_memory_path)?;
            sections.extend(self.parse_markdown(&content)?);
        }

        // 加载项目记忆
        if let Some(path) = &self.project_memory_path {
            let content = std::fs::read_to_string(path)?;
            sections.extend(self.parse_markdown(&content)?);
        }

        Ok(sections)
    }

    pub fn to_system_prompt(&self) -> anyhow::Result<String> {
        let sections = self.load()?;
        let mut prompt = String::from("# 用户记忆\n\n");

        for section in sections {
            prompt.push_str(&format!("## {}\n{}\n\n", section.title, section.content));
        }

        Ok(prompt)
    }

    fn parse_markdown(&self, content: &str) -> anyhow::Result<Vec<MemorySection>> {
        // 解析 Markdown 分区
        let mut sections = Vec::new();
        let mut current_title = String::new();
        let mut current_content = String::new();

        for line in content.lines() {
            if line.starts_with("## ") {
                if !current_title.is_empty() {
                    sections.push(MemorySection {
                        title: current_title.clone(),
                        content: current_content.trim().to_string(),
                    });
                }
                current_title = line[3..].to_string();
                current_content = String::new();
            } else {
                current_content.push_str(line);
                current_content.push('\n');
            }
        }

        if !current_title.is_empty() {
            sections.push(MemorySection {
                title: current_title,
                content: current_content.trim().to_string(),
            });
        }

        Ok(sections)
    }
}
```

**迁移优先级**: P1
**预估工作量**: 3 小时

---

### 3.11 回滚系统模块 (`rollback/`)

**原文件**: `src/rollback.ts`

**功能**:
- 文件快照
- 对话历史快照
- 恢复功能

**Rust 实现**:

```rust
// src/rollback/snapshot.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSnapshot {
    pub path: PathBuf,
    pub content: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub id: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub messages: Vec<Message>,
    pub file_snapshots: Vec<FileSnapshot>,
}

pub struct RollbackManager {
    snapshots_dir: PathBuf,
}

impl RollbackManager {
    pub fn new() -> anyhow::Result<Self> {
        let snapshots_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("无法获取配置目录"))?
            .join("fastcode")
            .join("snapshots");

        std::fs::create_dir_all(&snapshots_dir)?;

        Ok(Self { snapshots_dir })
    }

    pub fn create_snapshot(&self, session: &Session, files: &[PathBuf]) -> anyhow::Result<String> {
        let id = Uuid::new_v4().to_string();

        let mut file_snapshots = Vec::new();
        for path in files {
            if path.exists() {
                file_snapshots.push(FileSnapshot {
                    path: path.clone(),
                    content: std::fs::read_to_string(path)?,
                    timestamp: chrono::Utc::now(),
                });
            }
        }

        let snapshot = SessionSnapshot {
            id: id.clone(),
            timestamp: chrono::Utc::now(),
            messages: session.messages.clone(),
            file_snapshots,
        };

        let path = self.snapshots_dir.join(format!("{}.json", id));
        let content = serde_json::to_string_pretty(&snapshot)?;
        std::fs::write(&path, content)?;

        Ok(id)
    }

    pub fn restore(&self, id: &str) -> anyhow::Result<SessionSnapshot> {
        let path = self.snapshots_dir.join(format!("{}.json", id));
        let content = std::fs::read_to_string(&path)?;
        let snapshot: SessionSnapshot = serde_json::from_str(&content)?;

        // 恢复文件
        for file_snapshot in &snapshot.file_snapshots {
            std::fs::write(&file_snapshot.path, &file_snapshot.content)?;
        }

        Ok(snapshot)
    }

    pub fn list(&self) -> anyhow::Result<Vec<SnapshotMeta>> {
        let mut snapshots = Vec::new();

        for entry in std::fs::read_dir(&self.snapshots_dir)? {
            let entry = entry?;
            if entry.path().extension().map(|e| e == "json").unwrap_or(false) {
                let content = std::fs::read_to_string(entry.path())?;
                let snapshot: SessionSnapshot = serde_json::from_str(&content)?;
                snapshots.push(SnapshotMeta {
                    id: snapshot.id,
                    timestamp: snapshot.timestamp,
                    message_count: snapshot.messages.len(),
                });
            }
        }

        snapshots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(snapshots)
    }
}
```

**迁移优先级**: P2
**预估工作量**: 4 小时

---

### 3.12 多代理系统模块 (`agents/`)

**原文件**: `src/agents/` 目录

**功能**:
- 多代理类型定义
- 编排器
- 各代理实现

**Rust 实现**:

```rust
// src/agents/types.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentRole {
    Planner,
    Tasker,
    Replanner,
    Reviewer,
    Coder,
}

impl AgentRole {
    pub fn default_mode(&self) -> RuntimeMode {
        match self {
            AgentRole::Planner => RuntimeMode::Plan,
            AgentRole::Tasker => RuntimeMode::Auto,
            AgentRole::Replanner => RuntimeMode::Plan,
            AgentRole::Reviewer => RuntimeMode::Plan,
            AgentRole::Coder => RuntimeMode::Edit,
        }
    }
}

// src/agents/orchestrator.rs
pub struct Orchestrator {
    planner: PlannerAgent,
    tasker: TaskerAgent,
    replanner: ReplannerAgent,
}

impl Orchestrator {
    pub async fn run(&mut self, goal: &str) -> anyhow::Result<OrchestrationResult> {
        // 1. Plan 阶段
        let plan = self.planner.generate_plan(goal).await?;

        // 2. 创建任务列表
        let mut tasks = self.create_tasks(&plan);

        // 3. 执行任务
        while !tasks.is_empty() {
            let current_task = tasks.remove(0);

            // 执行任务
            let result = self.tasker.execute(&current_task).await?;

            // 评估是否需要重计划
            let should_replan = self.replanner.evaluate(&result).await?;

            if should_replan {
                let new_plan = self.planner.regenerate_plan(goal, &result).await?;
                tasks = self.merge_tasks(&tasks, &new_plan);
            }
        }

        Ok(OrchestrationResult::Success)
    }
}
```

**迁移优先级**: P2
**预估工作量**: 8 小时

---

### 3.13 计划模式模块 (`plan/`)

**原文件**: `src/plan_mode_state.ts`, `src/plan_runtime.ts`

**功能**:
- 计划状态管理
- 任务追踪
- 事件日志

**Rust 实现**:

```rust
// src/plan/state.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    Todo,
    Doing,
    Done,
    Blocked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub description: String,
    pub status: TaskStatus,
    pub dependencies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub goal: String,
    pub tasks: Vec<Task>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub struct PlanManager {
    plans_dir: PathBuf,
}

impl PlanManager {
    pub fn save(&self, plan: &Plan) -> anyhow::Result<()> {
        let path = self.plans_dir.join(format!("{}.json", plan.id));
        let content = serde_json::to_string_pretty(plan)?;
        std::fs::write(&path, content)?;
        Ok(())
    }

    pub fn load(&self, id: &str) -> anyhow::Result<Plan> {
        let path = self.plans_dir.join(format!("{}.json", id));
        let content = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    }

    pub fn update_task_status(&self, plan_id: &str, task_id: &str, status: TaskStatus) -> anyhow::Result<()> {
        let mut plan = self.load(plan_id)?;

        if let Some(task) = plan.tasks.iter_mut().find(|t| t.id == task_id) {
            task.status = status;
        }

        plan.updated_at = chrono::Utc::now();
        self.save(&plan)
    }
}
```

**迁移优先级**: P2
**预估工作量**: 4 小时

---

### 3.14 TUI 界面模块 (`ui/`)

**原文件**: `src/ui.tsx`

**功能**:
- 消息显示
- 输入处理
- 工具事件显示
- 模式切换
- 回滚选择
- 会话管理

**Rust 实现**:

```rust
// src/ui/app.rs
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame, Terminal,
};
use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};

pub struct App {
    pub mode: RuntimeMode,
    pub messages: Vec<Message>,
    pub input: String,
    pub input_cursor: usize,
    pub is_loading: bool,
    pub scroll_offset: usize,
    pub show_help: bool,
    pub show_sessions: bool,
    pub show_rollback: bool,
}

impl App {
    pub fn new() -> Self {
        Self {
            mode: RuntimeMode::default(),
            messages: Vec::new(),
            input: String::new(),
            input_cursor: 0,
            is_loading: false,
            scroll_offset: 0,
            show_help: false,
            show_sessions: false,
            show_rollback: false,
        }
    }

    pub fn run(&mut self) -> anyhow::Result<()> {
        enable_raw_mode()?;
        let mut stdout = std::io::stdout();
        execute!(stdout, EnterAlternateScreen)?;
        let backend = CrosstermBackend::new(stdout);
        let mut terminal = Terminal::new(backend)?;

        let result = self.main_loop(&mut terminal);

        disable_raw_mode()?;
        execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
        terminal.show_cursor()?;

        result
    }

    fn main_loop(&mut self, terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>) -> anyhow::Result<()> {
        loop {
            terminal.draw(|f| self.render(f))?;

            if event::poll(std::time::Duration::from_millis(100))? {
                if let Event::Key(key) = event::read()? {
                    match (key.modifiers, key.code) {
                        (KeyModifiers::CONTROL, KeyCode::Char('c')) => break,
                        (KeyModifiers::NONE, KeyCode::Enter) => self.submit_input()?,
                        (KeyModifiers::NONE, KeyCode::Char(c)) => self.input_char(c),
                        (KeyModifiers::NONE, KeyCode::Backspace) => self.backspace(),
                        (KeyModifiers::NONE, KeyCode::Left) => self.cursor_left(),
                        (KeyModifiers::NONE, KeyCode::Right) => self.cursor_right(),
                        (KeyModifiers::NONE, KeyCode::Up) => self.scroll_up(),
                        (KeyModifiers::NONE, KeyCode::Down) => self.scroll_down(),
                        _ => {}
                    }
                }
            }
        }

        Ok(())
    }

    fn render(&self, f: &mut Frame) {
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .margin(1)
            .constraints([
                Constraint::Length(1),  // 状态栏
                Constraint::Min(10),    // 消息区
                Constraint::Length(3),  // 输入区
            ])
            .split(f.size());

        // 渲染状态栏
        self.render_status_bar(f, chunks[0]);

        // 渲染消息区
        self.render_messages(f, chunks[1]);

        // 渲染输入区
        self.render_input(f, chunks[2]);
    }

    fn render_status_bar(&self, f: &mut Frame, area: Rect) {
        let mode_text = match self.mode {
            RuntimeMode::Plan => "📋 PLAN",
            RuntimeMode::Edit => "✏️ EDIT",
            RuntimeMode::Auto => "🚀 AUTO",
        };

        let status = Line::from(vec![
            Span::styled(mode_text, Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD)),
            Span::raw(" | "),
            Span::raw("Ctrl+C 退出 | Ctrl+H 帮助"),
        ]);

        let paragraph = Paragraph::new(status);
        f.render_widget(paragraph, area);
    }

    fn render_messages(&self, f: &mut Frame, area: Rect) {
        let items: Vec<ListItem> = self.messages
            .iter()
            .flat_map(|m| self.message_to_lines(m))
            .skip(self.scroll_offset)
            .take(area.height as usize)
            .map(|line| ListItem::new(line))
            .collect();

        let list = List::new(items)
            .block(Block::default()
                .borders(Borders::ALL)
                .title("Messages"));

        f.render_widget(list, area);
    }

    fn render_input(&mut self, f: &mut Frame, area: Rect) {
        let input_widget = Paragraph::new(self.input.as_str())
            .block(Block::default()
                .borders(Borders::ALL)
                .title("Input"));

        f.render_widget(input_widget, area);

        // 设置光标位置
        f.set_cursor(
            area.x + self.input_cursor as u16 + 1,
            area.y + 1,
        );
    }
}
```

**迁移优先级**: P0
**预估工作量**: 12 小时

---

### 3.15 CLI 模块 (`cli/`)

**原文件**: `src/cli.ts`

**功能**:
- 命令行参数解析
- 子命令定义

**Rust 实现**:

```rust
// src/cli/args.rs
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "fastcode")]
#[command(about = "AI 驱动的代码助手", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// 初始化配置
    Init {
        /// API Base URL
        #[arg(long)]
        base_url: Option<String>,
        /// API Key
        #[arg(long)]
        api_key: Option<String>,
        /// 模型名称
        #[arg(long)]
        model: Option<String>,
    },

    /// 启动 TUI 交互界面
    Run {
        /// 运行模式
        #[arg(short, long, default_value = "edit")]
        mode: String,
    },

    /// 单轮非交互式对话
    Chat {
        /// 用户消息
        #[arg(short, long)]
        message: String,
    },

    /// 运行多代理编排任务
    Agents {
        /// 目标描述
        #[arg(short, long)]
        goal: String,
    },

    /// 会话管理
    Session {
        #[command(subcommand)]
        action: SessionCommands,
    },

    /// 查看审计日志
    Audit {
        /// 限制数量
        #[arg(short, long, default_value = "20")]
        limit: usize,
    },

    /// 策略文件管理
    Policy {
        #[command(subcommand)]
        action: PolicyCommands,
    },

    /// 命令审批管理
    Approvals {
        /// 列出所有审批
        #[arg(short, long)]
        list: bool,
        /// 清除所有审批
        #[arg(long)]
        clear: bool,
    },
}

#[derive(Subcommand)]
pub enum SessionCommands {
    /// 列出所有会话
    List,
    /// 切换会话
    Switch { id: String },
    /// 删除会话
    Delete { id: String },
}

#[derive(Subcommand)]
pub enum PolicyCommands {
    /// 显示当前策略
    Show,
    /// 添加允许的命令前缀
    AddAllow { prefix: String },
    /// 添加拒绝的命令模式
    AddDeny { pattern: String },
}

// src/main.rs
use clap::Parser;
use fastcode::cli::args::{Cli, Commands};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Init { base_url, api_key, model } => {
            // 初始化配置
        }
        Commands::Run { mode } => {
            // 启动 TUI
        }
        Commands::Chat { message } => {
            // 单轮对话
        }
        Commands::Agents { goal } => {
            // 多代理运行
        }
        Commands::Session { action } => {
            // 会话管理
        }
        Commands::Audit { limit } => {
            // 审计日志
        }
        Commands::Policy { action } => {
            // 策略管理
        }
        Commands::Approvals { list, clear } => {
            // 审批管理
        }
    }

    Ok(())
}
```

**迁移优先级**: P0
**预估工作量**: 4 小时

---

## 四、迁移阶段规划

### 阶段一：基础架构 (Week 1)

**目标**: 建立项目骨架和核心数据结构

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 初始化 Cargo 项目 | P0 | 待开始 |
| 设计模块结构 | P0 | 待开始 |
| 实现 config 模块 | P0 | 待开始 |
| 实现 modes 模块 | P0 | 待开始 |
| 实现 policy 模块 | P0 | 待开始 |
| 实现 approvals 模块 | P0 | 待开始 |
| 实现 audit 模块 | P1 | 待开始 |
| 实现 session 模块 | P0 | 待开始 |
| 实现 CLI 框架 | P0 | 待开始 |

### 阶段二：核心功能 (Week 2)

**目标**: 实现核心 Agent 和工具系统

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 实现 tools 模块 | P0 | 待开始 |
| 实现 agent 模块 | P0 | 待开始 |
| 集成 async-openai | P0 | 待开始 |
| 实现流式输出 | P0 | 待开始 |
| 实现工具调用循环 | P0 | 待开始 |

### 阶段三：TUI 界面 (Week 3)

**目标**: 实现完整的终端用户界面

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 实现基础 TUI 框架 | P0 | 待开始 |
| 实现消息显示组件 | P0 | 待开始 |
| 实现输入组件 | P0 | 待开始 |
| 实现状态栏 | P0 | 待开始 |
| 实现加载动画 | P1 | 待开始 |
| 实现审批对话框 | P0 | 待开始 |
| 实现会话选择器 | P1 | 待开始 |
| 实现回滚选择器 | P2 | 待开始 |

### 阶段四：高级功能 (Week 4)

**目标**: 实现扩展功能

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 实现 MCP 集成 | P1 | 待开始 |
| 实现记忆系统 | P1 | 待开始 |
| 实现回滚系统 | P2 | 待开始 |
| 实现多代理系统 | P2 | 待开始 |
| 实现计划模式 | P2 | 待开始 |

### 阶段五：测试和优化 (Week 5)

**目标**: 确保质量和性能

| 任务 | 优先级 | 状态 |
|------|--------|------|
| 单元测试 | P0 | 待开始 |
| 集成测试 | P0 | 待开始 |
| 性能优化 | P1 | 待开始 |
| 错误处理完善 | P0 | 待开始 |
| 文档编写 | P1 | 待开始 |

---

## 五、关键技术挑战

### 5.1 异步模型差异

**挑战**: Node.js 事件循环 vs Tokio 运行时

**解决方案**:
- 使用 `#[tokio::main]` 宏作为入口
- 使用 `async-trait` 支持异步 trait
- 使用 channels 进行组件间通信

### 5.2 流式输出处理

**挑战**: SSE 流式响应在 Rust 中的实现

**解决方案**:
- 使用 `async-openai` 的流式 API
- 使用 `mpsc` channel 发送事件到 UI
- 使用 `futures::StreamExt` 处理流

### 5.3 终端 UI 差异

**挑战**: React/Ink 声明式 vs Ratatui 命令式

**解决方案**:
- 设计清晰的 App 状态结构
- 使用 Elm 架构模式 (Model-Update-View)
- 抽象可复用的 UI 组件

### 5.4 JSON-RPC 进程通信

**挑战**: MCP 的子进程管理

**解决方案**:
- 使用 `tokio::process::Command`
- 使用 `AsyncBufRead` 处理行协议
- 设计健壮的进程生命周期管理

### 5.5 错误处理

**挑战**: TypeScript 异常 vs Rust Result

**解决方案**:
- 使用 `anyhow` 进行错误传播
- 使用 `thiserror` 定义自定义错误类型
- 在 UI 层统一错误展示

---

## 六、测试策略

### 6.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_mode_permissions() {
        assert!(!RuntimeMode::Plan.can_write());
        assert!(RuntimeMode::Edit.can_write());
        assert!(RuntimeMode::Auto.can_write());

        assert!(RuntimeMode::Edit.requires_approval());
        assert!(!RuntimeMode::Auto.requires_approval());
    }

    #[test]
    fn test_policy_validator() {
        let config = PolicyConfig {
            allow_shell_prefixes: vec!["git status".to_string()],
            deny_shell_patterns: vec!["rm -rf /".to_string()],
            protected_paths: vec![".git".to_string()],
        };

        let validator = PolicyValidator::new(&config).unwrap();

        assert!(validator.is_command_allowed("git status").is_ok());
        assert!(validator.is_command_allowed("rm -rf /").is_err());
        assert!(validator.is_path_protected(".git/config"));
    }
}
```

### 6.2 集成测试

```rust
#[tokio::test]
async fn test_agent_chat_stream() {
    let config = Settings::load().unwrap();
    let agent = FastCodeAgent::new(&config, vec![]);

    let (tx, mut rx) = mpsc::channel(100);
    let messages = vec![
        ChatCompletionRequestMessage::User(
            ChatCompletionRequestUserMessageArgs::default()
                .content("Hello")
                .build()
                .unwrap()
                .into()
        ),
    ];

    let handle = tokio::spawn(async move {
        agent.chat_stream(messages, tx).await
    });

    while let Some(event) = rx.recv().await {
        match event {
            AgentEvent::Content(content) => {
                println!("Content: {}", content);
            }
            AgentEvent::Complete => break,
            _ => {}
        }
    }

    handle.await.unwrap().unwrap();
}
```

---

## 七、配置文件迁移

| 原文件路径 | 新文件路径 | 格式变化 |
|-----------|-----------|---------|
| `~/.happycode/config.json` | `~/.config/fastcode/config.json` | 相同 |
| `~/.happycode/sessions/*.json` | `~/.config/fastcode/sessions/*.json` | 相同 |
| `~/.happycode/approvals.json` | `~/.config/fastcode/approvals.json` | 相同 |
| `~/.happycode/audit.log` | `~/.config/fastcode/audit.log` | 相同 |
| `~/.happycode/memory_user.md` | `~/.config/fastcode/memory_user.md` | 相同 |
| `.happycode-policy.json` | `.fastcode-policy.json` | 相同 |
| `.happycode-mcp.json` | `.fastcode-mcp.json` | 相同 |
| `.happycode/memory_project.md` | `.fastcode-memory.md` | 相同 |

---

## 八、命名变化

| 原名称 | 新名称 | 说明 |
|-------|-------|------|
| happycode | fastcode | 项目名 |
| HappyCode | FastCode | 类/类型名 |
| happycode-cli | fastcode-cli | CLI 命令 |
| .happycode-* | .fastcode-* | 配置文件前缀 |

---

## 九、风险评估

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| async-openai API 变化 | 高 | 锁定版本，关注更新 |
| Ratatui 学习曲线 | 中 | 先实现简单组件 |
| MCP 协议兼容性 | 中 | 编写协议测试用例 |
| Windows 终端兼容性 | 中 | 使用 crossterm 跨平台特性 |
| 流式输出性能 | 低 | 使用 buffer 优化 |

---

## 十、后续优化方向

1. **性能优化**: 使用零拷贝、对象池等技术
2. **插件系统**: 支持动态加载工具
3. **多语言支持**: i18n 国际化
4. **配置加密**: 敏感信息加密存储
5. **远程会话**: 支持云端会话同步
6. **AI 模型切换**: 支持更多 LLM 后端

---

## 十一、参考资料

- [Ratatui 官方文档](https://docs.rs/ratatui)
- [async-openai 文档](https://docs.rs/async-openai)
- [Tokio 教程](https://tokio.rs/tokio/tutorial)
- [Crossterm 文档](https://docs.rs/crossterm)
- [Clap 文档](https://docs.rs/clap)

---

*文档版本: 1.0*
*创建日期: 2024*
*作者: Claude*
