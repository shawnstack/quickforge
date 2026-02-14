use crate::tools::registry::{Tool, ToolContext, ToolDefinition, ToolExecutionError, ToolRegistry};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

pub struct ShellTool;
pub struct FileTool;
pub struct GitTool;

impl Tool for ShellTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "shell".to_string(),
            description: "Execute a shell command".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("shell tool requires non-empty 'command'")
            })?;

        let output = run_shell_command(command, ctx.working_dir()).map_err(|err| {
            ToolExecutionError::execution_failed(format!("failed to run shell command: {}", err))
        })?;

        to_result_string("shell", output)
    }
}

impl Tool for FileTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "file".to_string(),
            description: "Read file content".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("file tool requires non-empty 'path'")
            })?;

        let resolved = resolve_path(ctx.working_dir().into(), path);
        fs::read_to_string(&resolved).map_err(|err| {
            ToolExecutionError::execution_failed(format!(
                "failed to read file '{}': {}",
                resolved.display(),
                err
            ))
        })
    }
}

impl Tool for GitTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "git".to_string(),
            description: "Execute a git command".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let command_args = parse_git_args(args)?;
        let output = Command::new("git")
            .args(command_args)
            .current_dir(ctx.working_dir())
            .output()
            .map_err(|err| {
                ToolExecutionError::execution_failed(format!("failed to run git command: {}", err))
            })?;
        to_result_string("git", output)
    }
}

pub fn register_builtin_tools(registry: &mut ToolRegistry) -> anyhow::Result<()> {
    registry.register(ShellTool)?;
    registry.register(FileTool)?;
    registry.register(GitTool)?;
    Ok(())
}

fn parse_git_args(args: &Value) -> Result<Vec<String>, ToolExecutionError> {
    let raw = args.get("args").and_then(Value::as_array).ok_or_else(|| {
        ToolExecutionError::invalid_arguments("git tool requires array field 'args'")
    })?;

    if raw.is_empty() {
        return Err(ToolExecutionError::invalid_arguments(
            "git tool requires at least one argument",
        ));
    }

    let mut parsed = Vec::with_capacity(raw.len());
    for value in raw {
        let item = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments(
                    "git tool arguments must be non-empty strings",
                )
            })?;
        parsed.push(item.to_string());
    }
    Ok(parsed)
}

fn resolve_path(base: PathBuf, raw: &str) -> PathBuf {
    let candidate = PathBuf::from(raw);
    if candidate.is_absolute() {
        candidate
    } else {
        base.join(candidate)
    }
}

fn run_shell_command(
    command: &str,
    working_dir: &std::path::Path,
) -> std::io::Result<std::process::Output> {
    if cfg!(windows) {
        Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(command)
            .current_dir(working_dir)
            .output()
    } else {
        Command::new("sh")
            .arg("-c")
            .arg(command)
            .current_dir(working_dir)
            .output()
    }
}

fn to_result_string(
    tool_name: &str,
    output: std::process::Output,
) -> Result<String, ToolExecutionError> {
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{} command failed with status {}", tool_name, output.status)
    };
    Err(ToolExecutionError::execution_failed(message))
}

#[cfg(test)]
mod tests {
    use super::register_builtin_tools;
    use crate::approvals::manager::{ApprovalManager, ApprovalType};
    use crate::audit::logger::AuditRecord;
    use crate::modes::runtime_mode::RuntimeMode;
    use crate::policy::validator::{PolicyConfig, PolicyValidator};
    use crate::tools::registry::{ToolContext, ToolRegistry, ToolStatus};
    use serde_json::json;
    use std::env;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn registry_executes_builtin_tools_with_normalized_envelopes() {
        let temp_dir = unique_temp_dir("tool-registry");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let sample = temp_dir.join("sample.txt");
        std::fs::write(&sample, "hello from file tool").unwrap();

        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry).unwrap();

        let definitions = registry.definitions();
        assert_eq!(definitions.len(), 3);
        assert_eq!(definitions[0].name, "file");
        assert_eq!(definitions[1].name, "git");
        assert_eq!(definitions[2].name, "shell");

        let ctx = ToolContext::new(&temp_dir);
        let shell_ok = registry.execute("shell", &json!({ "command": "echo shell-ok" }), &ctx);
        assert_eq!(shell_ok.status, ToolStatus::Success);
        assert!(shell_ok.output.unwrap_or_default().contains("shell-ok"));

        let shell_err = registry.execute("shell", &json!({}), &ctx);
        assert_eq!(shell_err.status, ToolStatus::Error);
        assert_eq!(shell_err.error_code.as_deref(), Some("invalid_arguments"));

        let file_ok = registry.execute("file", &json!({ "path": "sample.txt" }), &ctx);
        assert_eq!(file_ok.status, ToolStatus::Success);
        assert_eq!(file_ok.output.as_deref(), Some("hello from file tool"));

        let file_err = registry.execute("file", &json!({ "path": "missing.txt" }), &ctx);
        assert_eq!(file_err.status, ToolStatus::Error);
        assert_eq!(
            file_err.error_code.as_deref(),
            Some("tool_execution_failed")
        );

        let repo_ctx = ToolContext::new(std::env::current_dir().unwrap());
        let git_ok = registry.execute("git", &json!({ "args": ["status", "--short"] }), &repo_ctx);
        assert_eq!(git_ok.status, ToolStatus::Success);
        assert!(git_ok.error_code.is_none());

        let git_err = registry.execute(
            "git",
            &json!({ "args": ["definitely-not-a-git-subcommand"] }),
            &repo_ctx,
        );
        assert_eq!(git_err.status, ToolStatus::Error);
        assert_eq!(git_err.error_code.as_deref(), Some("tool_execution_failed"));

        let not_found = registry.execute("missing", &json!({}), &repo_ctx);
        assert_eq!(not_found.status, ToolStatus::Error);
        assert_eq!(not_found.error_code.as_deref(), Some("tool_not_found"));

        cleanup_dir(&temp_dir);
    }

    #[test]
    fn writes_audit_records_for_tool_invocations_across_modes() {
        let temp_dir = unique_temp_dir("tool-audit");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let log_path = temp_dir.join("audit.jsonl");
        let logger = crate::audit::logger::AuditLogger::new(&log_path);

        let sample = temp_dir.join("sample.txt");
        std::fs::write(&sample, "audit sample").unwrap();

        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry).unwrap();

        let ctx = ToolContext::new(&temp_dir);
        let shell = registry.execute_with_audit(
            "shell",
            &json!({ "command": "echo audit-ok" }),
            &ctx,
            RuntimeMode::Edit,
            &logger,
        );
        assert_eq!(shell.status, ToolStatus::Success);

        let file = registry.execute_with_audit(
            "file",
            &json!({ "path": "sample.txt" }),
            &ctx,
            RuntimeMode::Plan,
            &logger,
        );
        assert_eq!(file.status, ToolStatus::Success);

        let raw = std::fs::read_to_string(&log_path).unwrap();
        let lines = raw.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 2);

        let first: AuditRecord = serde_json::from_str(lines[0]).unwrap();
        assert!(first.timestamp_unix_ms > 0);
        assert_eq!(first.mode, RuntimeMode::Edit);
        assert_eq!(first.tool, "shell");
        assert_eq!(first.result, "success");

        let second: AuditRecord = serde_json::from_str(lines[1]).unwrap();
        assert!(second.timestamp_unix_ms >= first.timestamp_unix_ms);
        assert_eq!(second.mode, RuntimeMode::Plan);
        assert_eq!(second.tool, "file");
        assert_eq!(second.result, "success");

        cleanup_dir(&temp_dir);
    }

    #[test]
    fn blocks_denied_shell_command_before_execution_with_resolution_error() {
        let temp_dir = unique_temp_dir("tool-safety-policy");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let target = temp_dir.join("do-not-delete.txt");
        std::fs::write(&target, "must stay").unwrap();

        let (deny_pattern, denied_command) = denied_delete_command_for_platform(&target);
        let policy = PolicyValidator::new(PolicyConfig {
            allow_command_prefixes: Vec::new(),
            deny_command_patterns: vec![deny_pattern],
            protected_paths: Vec::new(),
        });

        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry).unwrap();

        let ctx = ToolContext::new(&temp_dir);
        let result = registry.execute_with_safety(
            "shell",
            &json!({ "command": denied_command }),
            &ctx,
            RuntimeMode::Auto,
            Some(&policy),
            None,
            Some("session-a"),
        );

        assert_eq!(result.status, ToolStatus::Error);
        assert_eq!(result.error_code.as_deref(), Some("policy_denied"));
        let message = result.error_message.unwrap_or_default();
        assert!(message.contains("policy rejected command"));
        assert!(message.contains("To proceed"));
        assert!(target.exists(), "denied command should not be executed");

        cleanup_dir(&temp_dir);
    }

    #[test]
    fn blocks_shell_command_without_required_approval_in_edit_mode() {
        let temp_dir = unique_temp_dir("tool-safety-approval");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let approvals_path = temp_dir.join("approvals.json");
        let mut approvals = ApprovalManager::load_or_create(&approvals_path).unwrap();

        let mut registry = ToolRegistry::new();
        register_builtin_tools(&mut registry).unwrap();

        let ctx = ToolContext::new(&temp_dir);
        let blocked = registry.execute_with_safety(
            "shell",
            &json!({ "command": "echo needs-approval" }),
            &ctx,
            RuntimeMode::Edit,
            None,
            Some(&mut approvals),
            Some("session-a"),
        );
        assert_eq!(blocked.status, ToolStatus::Error);
        assert_eq!(blocked.error_code.as_deref(), Some("approval_required"));
        assert!(
            blocked
                .error_message
                .unwrap_or_default()
                .contains("grant allow_once/allow_session/allow_global")
        );

        approvals
            .add_approval(
                "echo needs-approval",
                ApprovalType::AllowOnce,
                Some("session-a"),
            )
            .unwrap();

        let allowed = registry.execute_with_safety(
            "shell",
            &json!({ "command": "echo needs-approval" }),
            &ctx,
            RuntimeMode::Edit,
            None,
            Some(&mut approvals),
            Some("session-a"),
        );
        assert_eq!(allowed.status, ToolStatus::Success);
        assert!(
            allowed
                .output
                .unwrap_or_default()
                .contains("needs-approval")
        );

        cleanup_dir(&temp_dir);
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        env::temp_dir().join(format!("fastcode-{}-{}", prefix, stamp))
    }

    fn cleanup_dir(path: &Path) {
        if path.exists() {
            let _ = std::fs::remove_dir_all(path);
        }
    }

    fn denied_delete_command_for_platform(target: &Path) -> (String, String) {
        if cfg!(windows) {
            (
                "remove-item -recurse".to_string(),
                format!(
                    "Remove-Item -Recurse -Force '{}'",
                    target.display().to_string().replace('\'', "''")
                ),
            )
        } else {
            (
                "rm -rf".to_string(),
                format!("rm -rf '{}'", target.display()),
            )
        }
    }
}
