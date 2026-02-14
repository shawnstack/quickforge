use crate::audit::logger::AuditLogger;
use crate::modes::runtime_mode::RuntimeMode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Success,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolResultEnvelope {
    pub tool: String,
    pub status: ToolStatus,
    pub output: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

impl ToolResultEnvelope {
    pub fn success(tool: &str, output: String) -> Self {
        Self {
            tool: tool.to_string(),
            status: ToolStatus::Success,
            output: Some(output),
            error_code: None,
            error_message: None,
        }
    }

    pub fn error(tool: &str, error_code: &str, error_message: impl Into<String>) -> Self {
        Self {
            tool: tool.to_string(),
            status: ToolStatus::Error,
            output: None,
            error_code: Some(error_code.to_string()),
            error_message: Some(error_message.into()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolExecutionError {
    pub code: &'static str,
    pub message: String,
}

impl ToolExecutionError {
    pub fn invalid_arguments(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_arguments",
            message: message.into(),
        }
    }

    pub fn execution_failed(message: impl Into<String>) -> Self {
        Self {
            code: "tool_execution_failed",
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolContext {
    working_dir: PathBuf,
}

impl ToolContext {
    pub fn new(working_dir: impl Into<PathBuf>) -> Self {
        Self {
            working_dir: working_dir.into(),
        }
    }

    pub fn working_dir(&self) -> &Path {
        &self.working_dir
    }
}

pub trait Tool: Send + Sync {
    fn definition(&self) -> ToolDefinition;
    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError>;
}

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register<T>(&mut self, tool: T) -> anyhow::Result<()>
    where
        T: Tool + 'static,
    {
        let definition = tool.definition();
        if self.tools.contains_key(&definition.name) {
            anyhow::bail!("tool '{}' is already registered", definition.name);
        }
        self.tools.insert(definition.name, Box::new(tool));
        Ok(())
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        let mut definitions = self
            .tools
            .values()
            .map(|tool| tool.definition())
            .collect::<Vec<_>>();
        definitions.sort_by(|a, b| a.name.cmp(&b.name));
        definitions
    }

    pub fn execute(&self, tool_name: &str, args: &Value, ctx: &ToolContext) -> ToolResultEnvelope {
        let normalized = tool_name.trim();
        if normalized.is_empty() {
            return ToolResultEnvelope::error("", "tool_not_found", "tool name cannot be empty");
        }

        let Some(tool) = self.tools.get(normalized) else {
            return ToolResultEnvelope::error(
                normalized,
                "tool_not_found",
                format!("tool '{}' is not registered", normalized),
            );
        };

        match tool.execute(args, ctx) {
            Ok(output) => ToolResultEnvelope::success(normalized, output),
            Err(err) => ToolResultEnvelope::error(normalized, err.code, err.message),
        }
    }

    pub fn execute_with_audit(
        &self,
        tool_name: &str,
        args: &Value,
        ctx: &ToolContext,
        mode: RuntimeMode,
        logger: &AuditLogger,
    ) -> ToolResultEnvelope {
        let result = self.execute(tool_name, args, ctx);
        let outcome = match result.status {
            ToolStatus::Success => "success",
            ToolStatus::Error => "error",
        };
        let _ = logger.log_tool_invocation(
            mode,
            &result.tool,
            outcome,
            result.error_code.as_deref(),
            result.error_message.as_deref(),
        );
        result
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}
