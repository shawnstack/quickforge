use crate::tools::registry::{Tool, ToolContext, ToolDefinition, ToolExecutionError, ToolRegistry};
use crate::approvals::manager::{ApprovalManager, ApprovalType};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::Write;

pub struct ShellTool;
pub struct FileTool;
pub struct GitTool;
pub struct ListFilesTool;
pub struct SearchTextTool;
pub struct RunTestsTool;
pub struct LintTool;
pub struct ApplyPatchTool;
pub struct SymbolLookupTool;
pub struct GitStatusDiffTool;
pub struct GitCommitTool;
pub struct FetchUrlTool;
pub struct WebSearchTool;
pub struct AskApprovalTool;

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
        let mut command = Command::new("git");
        apply_default_child_env(&mut command);
        let output = command
            .args(command_args)
            .current_dir(ctx.working_dir())
            .output()
            .map_err(|err| {
                ToolExecutionError::execution_failed(format!("failed to run git command: {}", err))
            })?;
        to_result_string("git", output)
    }
}

impl Tool for ListFilesTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "list_files".to_string(),
            description: "List files recursively from a path".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let path = args.get("path").and_then(Value::as_str).unwrap_or(".");
        let max_entries = args.get("max_entries").and_then(Value::as_u64).unwrap_or(500) as usize;
        let include_hidden = args
            .get("include_hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let root = resolve_path(ctx.working_dir().into(), path);
        if !root.exists() {
            return Err(ToolExecutionError::invalid_arguments(format!(
                "path does not exist: {}",
                root.display()
            )));
        }
        let mut entries = Vec::new();
        collect_files(&root, &root, include_hidden, max_entries, &mut entries)
            .map_err(|err| ToolExecutionError::execution_failed(err.to_string()))?;
        Ok(entries.join("\n"))
    }
}

impl Tool for SearchTextTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "search_text".to_string(),
            description: "Search text in files recursively".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("search_text requires non-empty 'query'")
            })?;
        let path = args.get("path").and_then(Value::as_str).unwrap_or(".");
        let max_results = args.get("max_results").and_then(Value::as_u64).unwrap_or(200) as usize;
        let include_hidden = args
            .get("include_hidden")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let root = resolve_path(ctx.working_dir().into(), path);
        if !root.exists() {
            return Err(ToolExecutionError::invalid_arguments(format!(
                "path does not exist: {}",
                root.display()
            )));
        }

        let mut matches = Vec::new();
        search_text_recursive(
            &root,
            &root,
            query,
            include_hidden,
            max_results,
            &mut matches,
        )
        .map_err(|err| ToolExecutionError::execution_failed(err.to_string()))?;
        Ok(matches.join("\n"))
    }
}

impl Tool for RunTestsTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "run_tests".to_string(),
            description: "Run project tests".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_test_command(ctx.working_dir()));
        let output = run_shell_command(&command, ctx.working_dir()).map_err(|err| {
            ToolExecutionError::execution_failed(format!("failed to run test command: {}", err))
        })?;
        to_result_string("run_tests", output)
    }
}

impl Tool for LintTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "lint".to_string(),
            description: "Run lint/typecheck command".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let command = args
            .get("command")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| default_lint_command(ctx.working_dir()));
        let output = run_shell_command(&command, ctx.working_dir()).map_err(|err| {
            ToolExecutionError::execution_failed(format!("failed to run lint command: {}", err))
        })?;
        to_result_string("lint", output)
    }
}

impl Tool for ApplyPatchTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "apply_patch".to_string(),
            description: "Apply unified patch text to repository".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let patch = args
            .get("patch")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("apply_patch requires non-empty 'patch'")
            })?;
        let mut command = Command::new("git");
        apply_default_child_env(&mut command);
        let mut child = command
            .args(["apply", "--whitespace=nowarn", "-"])
            .current_dir(ctx.working_dir())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
                ToolExecutionError::execution_failed(format!("failed to start git apply: {}", err))
            })?;
        let Some(mut stdin) = child.stdin.take() else {
            return Err(ToolExecutionError::execution_failed(
                "failed to open stdin for git apply",
            ));
        };
        stdin.write_all(patch.as_bytes()).map_err(|err| {
            ToolExecutionError::execution_failed(format!("failed to write patch: {}", err))
        })?;
        drop(stdin);
        let output = child.wait_with_output().map_err(|err| {
            ToolExecutionError::execution_failed(format!("failed to wait git apply: {}", err))
        })?;
        to_result_string("apply_patch", output)
    }
}

impl Tool for SymbolLookupTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "symbol_lookup".to_string(),
            description: "Find symbol definitions/references by text heuristic".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let symbol = args
            .get("symbol")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("symbol_lookup requires non-empty 'symbol'")
            })?;
        let path = args.get("path").and_then(Value::as_str).unwrap_or(".");
        let max_results = args.get("max_results").and_then(Value::as_u64).unwrap_or(200) as usize;
        let root = resolve_path(ctx.working_dir().into(), path);
        if !root.exists() {
            return Err(ToolExecutionError::invalid_arguments(format!(
                "path does not exist: {}",
                root.display()
            )));
        }
        let mut matches = Vec::new();
        symbol_lookup_recursive(&root, &root, symbol, max_results, &mut matches)
            .map_err(|err| ToolExecutionError::execution_failed(err.to_string()))?;
        Ok(matches.join("\n"))
    }
}

impl Tool for GitStatusDiffTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "git_status_diff".to_string(),
            description: "Get git status and diff summary".to_string(),
        }
    }

    fn execute(&self, _args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let mut status_command = Command::new("git");
        apply_default_child_env(&mut status_command);
        let status = status_command
            .args(["status", "--short"])
            .current_dir(ctx.working_dir())
            .output()
            .map_err(|err| ToolExecutionError::execution_failed(format!("git status failed: {}", err)))?;
        let mut diff_command = Command::new("git");
        apply_default_child_env(&mut diff_command);
        let diff = diff_command
            .args(["diff", "--stat"])
            .current_dir(ctx.working_dir())
            .output()
            .map_err(|err| ToolExecutionError::execution_failed(format!("git diff failed: {}", err)))?;
        let status_text = if status.status.success() {
            String::from_utf8_lossy(&status.stdout).to_string()
        } else {
            String::from_utf8_lossy(&status.stderr).to_string()
        };
        let diff_text = if diff.status.success() {
            String::from_utf8_lossy(&diff.stdout).to_string()
        } else {
            String::from_utf8_lossy(&diff.stderr).to_string()
        };
        Ok(format!("status:\n{}\n\ndiff:\n{}", status_text.trim(), diff_text.trim()))
    }
}

impl Tool for GitCommitTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "git_commit".to_string(),
            description: "Stage and commit changes".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let message = args
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                ToolExecutionError::invalid_arguments("git_commit requires non-empty 'message'")
            })?;
        let add_all = args.get("add_all").and_then(Value::as_bool).unwrap_or(true);
        if add_all {
            let mut add_command = Command::new("git");
            apply_default_child_env(&mut add_command);
            let add_out = add_command
                .args(["add", "-A"])
                .current_dir(ctx.working_dir())
                .output()
                .map_err(|err| ToolExecutionError::execution_failed(format!("git add failed: {}", err)))?;
            if !add_out.status.success() {
                return Err(ToolExecutionError::execution_failed(
                    String::from_utf8_lossy(&add_out.stderr).trim().to_string(),
                ));
            }
        }
        let mut commit_command = Command::new("git");
        apply_default_child_env(&mut commit_command);
        let commit_out = commit_command
            .args(["commit", "-m", message])
            .current_dir(ctx.working_dir())
            .output()
            .map_err(|err| ToolExecutionError::execution_failed(format!("git commit failed: {}", err)))?;
        to_result_string("git_commit", commit_out)
    }
}

impl Tool for FetchUrlTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "fetch_url".to_string(),
            description: "Fetch URL content via curl".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolExecutionError::invalid_arguments("fetch_url requires 'url'"))?;
        let max_chars = args.get("max_chars").and_then(Value::as_u64).unwrap_or(20_000) as usize;
        let output = run_shell_command(
            &format!("curl -sS --connect-timeout 8 --max-time 30 \"{}\"", url),
            ctx.working_dir(),
        )
        .map_err(|err| ToolExecutionError::execution_failed(format!("fetch_url failed: {}", err)))?;
        let text = if output.status.success() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            String::from_utf8_lossy(&output.stderr).to_string()
        };
        Ok(text.chars().take(max_chars).collect())
    }
}

impl Tool for WebSearchTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Lightweight web search wrapper".to_string(),
        }
    }

    fn execute(&self, args: &Value, ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let query = args
            .get("query")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolExecutionError::invalid_arguments("web_search requires 'query'"))?;
        let encoded = query.replace(' ', "%20");
        let url = format!("https://duckduckgo.com/?q={}", encoded);
        let fetch = FetchUrlTool;
        fetch.execute(&serde_json::json!({ "url": url, "max_chars": 30000 }), ctx)
    }
}

impl Tool for AskApprovalTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "ask_approval".to_string(),
            description: "Persist approval prefix for future command execution".to_string(),
        }
    }

    fn execute(&self, args: &Value, _ctx: &ToolContext) -> Result<String, ToolExecutionError> {
        let prefix = args
            .get("prefix")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ToolExecutionError::invalid_arguments("ask_approval requires 'prefix'"))?;
        let approval_type_raw = args
            .get("approval_type")
            .and_then(Value::as_str)
            .unwrap_or("allow_session")
            .trim()
            .to_ascii_lowercase();
        let approval_type = match approval_type_raw.as_str() {
            "allow_once" => ApprovalType::AllowOnce,
            "allow_session" => ApprovalType::AllowSession,
            "allow_global" => ApprovalType::AllowGlobal,
            _ => {
                return Err(ToolExecutionError::invalid_arguments(
                    "approval_type must be allow_once|allow_session|allow_global",
                ));
            }
        };
        let session_id = args.get("session_id").and_then(Value::as_str);
        let approvals_path = dirs::config_dir()
            .ok_or_else(|| ToolExecutionError::execution_failed("config dir unavailable"))?
            .join("fastcode")
            .join("approvals.json");
        let mut manager = ApprovalManager::load_or_create(&approvals_path)
            .map_err(|err| ToolExecutionError::execution_failed(err.to_string()))?;
        manager
            .add_approval(prefix, approval_type, session_id)
            .map_err(|err| ToolExecutionError::execution_failed(err.to_string()))?;
        Ok(format!(
            "approval saved: {} ({})",
            prefix,
            approval_type_raw
        ))
    }
}

pub fn register_builtin_tools(registry: &mut ToolRegistry) -> anyhow::Result<()> {
    registry.register(ShellTool)?;
    registry.register(FileTool)?;
    registry.register(GitTool)?;
    registry.register(ListFilesTool)?;
    registry.register(SearchTextTool)?;
    registry.register(RunTestsTool)?;
    registry.register(LintTool)?;
    registry.register(ApplyPatchTool)?;
    registry.register(SymbolLookupTool)?;
    registry.register(GitStatusDiffTool)?;
    registry.register(GitCommitTool)?;
    registry.register(FetchUrlTool)?;
    registry.register(WebSearchTool)?;
    registry.register(AskApprovalTool)?;
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

fn default_test_command(working_dir: &Path) -> String {
    if working_dir.join("Cargo.toml").exists() {
        return "cargo test -- --nocapture".to_string();
    }
    if working_dir.join("package.json").exists() {
        return "npm test".to_string();
    }
    "echo \"No default test command for this project; pass command explicitly.\"".to_string()
}

fn default_lint_command(working_dir: &Path) -> String {
    if working_dir.join("Cargo.toml").exists() {
        return "cargo check".to_string();
    }
    if working_dir.join("package.json").exists() {
        return "npm run lint".to_string();
    }
    "echo \"No default lint command for this project; pass command explicitly.\"".to_string()
}

fn collect_files(
    root: &Path,
    current: &Path,
    include_hidden: bool,
    max_entries: usize,
    entries: &mut Vec<String>,
) -> std::io::Result<()> {
    if entries.len() >= max_entries {
        return Ok(());
    }
    for dir_entry in fs::read_dir(current)? {
        if entries.len() >= max_entries {
            break;
        }
        let dir_entry = dir_entry?;
        let path = dir_entry.path();
        let file_name = dir_entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(root, &path, include_hidden, max_entries, entries)?;
        } else if path.is_file() {
            let relative = path.strip_prefix(root).unwrap_or(&path);
            entries.push(relative.display().to_string());
        }
    }
    Ok(())
}

fn search_text_recursive(
    root: &Path,
    current: &Path,
    query: &str,
    include_hidden: bool,
    max_results: usize,
    matches: &mut Vec<String>,
) -> std::io::Result<()> {
    if matches.len() >= max_results {
        return Ok(());
    }
    for dir_entry in fs::read_dir(current)? {
        if matches.len() >= max_results {
            break;
        }
        let dir_entry = dir_entry?;
        let path = dir_entry.path();
        let file_name = dir_entry.file_name();
        let file_name = file_name.to_string_lossy();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            search_text_recursive(root, &path, query, include_hidden, max_results, matches)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            if line.contains(query) {
                let relative = path.strip_prefix(root).unwrap_or(&path);
                matches.push(format!("{}:{}:{}", relative.display(), index + 1, line.trim()));
                if matches.len() >= max_results {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn symbol_lookup_recursive(
    root: &Path,
    current: &Path,
    symbol: &str,
    max_results: usize,
    matches: &mut Vec<String>,
) -> std::io::Result<()> {
    if matches.len() >= max_results {
        return Ok(());
    }
    for dir_entry in fs::read_dir(current)? {
        if matches.len() >= max_results {
            break;
        }
        let dir_entry = dir_entry?;
        let path = dir_entry.path();
        if path.is_dir() {
            symbol_lookup_recursive(root, &path, symbol, max_results, matches)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            if line.contains(symbol) {
                let relative = path.strip_prefix(root).unwrap_or(&path);
                matches.push(format!("{}:{}:{}", relative.display(), index + 1, line.trim()));
                if matches.len() >= max_results {
                    break;
                }
            }
        }
    }
    Ok(())
}

fn run_shell_command(
    command: &str,
    working_dir: &std::path::Path,
) -> std::io::Result<std::process::Output> {
    if cfg!(windows) {
        let mut shell = Command::new("powershell");
        apply_default_child_env(&mut shell);
        shell
            .arg("-NoProfile")
            .arg("-Command")
            .arg(command)
            .current_dir(working_dir)
            .output()
    } else {
        let mut shell = Command::new("sh");
        apply_default_child_env(&mut shell);
        shell
            .arg("-c")
            .arg(command)
            .current_dir(working_dir)
            .output()
    }
}

fn apply_default_child_env(command: &mut Command) {
    let check_revoke = std::env::var("CARGO_HTTP_CHECK_REVOKE").unwrap_or_else(|_| "false".to_string());
    let git_fetch_cli =
        std::env::var("CARGO_NET_GIT_FETCH_WITH_CLI").unwrap_or_else(|_| "true".to_string());
    command.env("CARGO_HTTP_CHECK_REVOKE", check_revoke);
    command.env("CARGO_NET_GIT_FETCH_WITH_CLI", git_fetch_cli);
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
        let names = definitions
            .iter()
            .map(|definition| definition.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 14);
        for expected in [
            "apply_patch",
            "ask_approval",
            "file",
            "fetch_url",
            "git",
            "git_commit",
            "git_status_diff",
            "lint",
            "list_files",
            "run_tests",
            "search_text",
            "shell",
            "symbol_lookup",
            "web_search",
        ] {
            assert!(names.contains(&expected), "missing tool: {}", expected);
        }

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

        let list_files = registry.execute(
            "list_files",
            &json!({ "path": ".", "max_entries": 10 }),
            &ctx,
        );
        assert_eq!(list_files.status, ToolStatus::Success);
        assert!(list_files.output.unwrap_or_default().contains("sample.txt"));

        let search = registry.execute(
            "search_text",
            &json!({ "query": "hello", "path": ".", "max_results": 10 }),
            &ctx,
        );
        assert_eq!(search.status, ToolStatus::Success);
        assert!(search.output.unwrap_or_default().contains("sample.txt:1"));

        let lint = registry.execute("lint", &json!({ "command": "echo lint-ok" }), &ctx);
        assert_eq!(lint.status, ToolStatus::Success);
        assert!(lint.output.unwrap_or_default().contains("lint-ok"));

        let run_tests = registry.execute(
            "run_tests",
            &json!({ "command": "echo tests-ok" }),
            &ctx,
        );
        assert_eq!(run_tests.status, ToolStatus::Success);
        assert!(run_tests.output.unwrap_or_default().contains("tests-ok"));

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
