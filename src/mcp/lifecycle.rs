use crate::audit::logger::AuditLogger;
use crate::mcp::config::{McpConfig, McpServerConfig};
use crate::modes::runtime_mode::RuntimeMode;
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpServerHealth {
    Running,
    Exited(Option<i32>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpProcessHandle {
    pub name: String,
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpLifecycleReport {
    pub started: Vec<McpProcessHandle>,
    pub health: Vec<(String, McpServerHealth)>,
    pub stopped: usize,
}

#[derive(Debug, Default)]
pub struct McpProcessManager {
    processes: HashMap<String, Child>,
}

impl McpProcessManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_server(&mut self, server: &McpServerConfig) -> Result<McpProcessHandle> {
        let name = server.name.trim().to_string();
        if self.processes.contains_key(&name) {
            anyhow::bail!("MCP server '{}' is already running", name);
        }

        let mut command = Command::new(server.command.trim());
        command.args(&server.args);
        command.envs(&server.env);
        command.stdin(Stdio::null());
        command.stdout(Stdio::null());
        command.stderr(Stdio::null());

        if let Some(cwd) = &server.cwd {
            command.current_dir(cwd);
        }

        let child = command
            .spawn()
            .with_context(|| format!("failed to spawn MCP server '{}'", name))?;
        let pid = child.id();
        self.processes.insert(name.clone(), child);

        Ok(McpProcessHandle { name, pid })
    }

    pub fn start_all(&mut self, config: &McpConfig) -> Result<Vec<McpProcessHandle>> {
        let mut handles = Vec::with_capacity(config.servers.len());
        for server in &config.servers {
            handles.push(self.start_server(server)?);
        }
        Ok(handles)
    }

    pub fn health(&mut self, name: &str) -> Result<McpServerHealth> {
        let child = self
            .processes
            .get_mut(name)
            .with_context(|| format!("MCP server '{}' is not managed", name))?;
        match child
            .try_wait()
            .with_context(|| format!("failed to query MCP server '{}' status", name))?
        {
            None => Ok(McpServerHealth::Running),
            Some(status) => Ok(McpServerHealth::Exited(status.code())),
        }
    }

    pub fn shutdown_server(&mut self, name: &str) -> Result<bool> {
        let Some(mut child) = self.processes.remove(name) else {
            return Ok(false);
        };

        let is_running = child
            .try_wait()
            .with_context(|| {
                format!(
                    "failed to query MCP server '{}' status during shutdown",
                    name
                )
            })?
            .is_none();

        if is_running {
            let _ = child.kill();
        }

        let _ = child.wait();
        Ok(true)
    }

    pub fn shutdown_all(&mut self) -> Result<usize> {
        let names = self.processes.keys().cloned().collect::<Vec<_>>();
        let mut stopped = 0usize;
        for name in names {
            if self.shutdown_server(&name)? {
                stopped += 1;
            }
        }
        Ok(stopped)
    }

    pub fn managed_names(&self) -> Vec<String> {
        let mut names = self.processes.keys().cloned().collect::<Vec<_>>();
        names.sort();
        names
    }
}

pub fn run_lifecycle_check(config: &McpConfig) -> Result<McpLifecycleReport> {
    run_lifecycle_check_inner(config, None)
}

pub fn run_lifecycle_check_with_audit(
    config: &McpConfig,
    mode: RuntimeMode,
    logger: &AuditLogger,
) -> Result<McpLifecycleReport> {
    let audit = LifecycleAudit { mode, logger };
    run_lifecycle_check_inner(config, Some(audit))
}

#[derive(Clone, Copy)]
struct LifecycleAudit<'a> {
    mode: RuntimeMode,
    logger: &'a AuditLogger,
}

fn run_lifecycle_check_inner(
    config: &McpConfig,
    audit: Option<LifecycleAudit<'_>>,
) -> Result<McpLifecycleReport> {
    let mut manager = McpProcessManager::new();
    let mut started = Vec::with_capacity(config.servers.len());
    for server in &config.servers {
        let server_name = server.name.trim();
        match manager.start_server(server) {
            Ok(handle) => {
                log_lifecycle_event(audit, "start", &handle.name, "success", None, None);
                started.push(handle);
            }
            Err(err) => {
                let err_text = err.to_string();
                log_lifecycle_event(
                    audit,
                    "start",
                    server_name,
                    "error",
                    Some("mcp_start_failed"),
                    Some(&err_text),
                );

                let managed_before_shutdown = manager.managed_names();
                let stopped = manager.shutdown_all();
                match stopped {
                    Ok(stopped_count) => {
                        for name in managed_before_shutdown {
                            log_lifecycle_event(audit, "shutdown", &name, "success", None, None);
                        }
                        return Err(anyhow::anyhow!(
                            "MCP lifecycle start failed for server '{}': {}; started {} server(s) before failure and stopped {}",
                            server_name,
                            err_text,
                            started.len(),
                            stopped_count
                        ));
                    }
                    Err(shutdown_err) => {
                        log_lifecycle_event(
                            audit,
                            "shutdown",
                            "manager",
                            "error",
                            Some("mcp_shutdown_failed"),
                            Some(&shutdown_err.to_string()),
                        );
                        return Err(anyhow::anyhow!(
                            "MCP lifecycle start failed for server '{}': {}; shutdown after partial start also failed: {}",
                            server_name,
                            err_text,
                            shutdown_err
                        ));
                    }
                }
            }
        }
    }

    let mut health = Vec::new();
    let mut health_error = None;
    for name in manager.managed_names() {
        match manager.health(&name) {
            Ok(state) => {
                let result = match state {
                    McpServerHealth::Running => "success",
                    McpServerHealth::Exited(_) => "error",
                };
                let message = if let McpServerHealth::Exited(code) = &state {
                    Some(format!(
                        "server exited during health check with code {:?}",
                        code
                    ))
                } else {
                    None
                };
                log_lifecycle_event(
                    audit,
                    "health",
                    &name,
                    result,
                    message.as_deref().map(|_| "mcp_server_exited"),
                    message.as_deref(),
                );
                health.push((name, state));
            }
            Err(err) => {
                health_error = Some(err);
                break;
            }
        }
    }

    let managed_before_shutdown = manager.managed_names();
    let stopped = manager.shutdown_all();
    match &stopped {
        Ok(_) => {
            for name in managed_before_shutdown {
                log_lifecycle_event(audit, "shutdown", &name, "success", None, None);
            }
        }
        Err(err) => {
            log_lifecycle_event(
                audit,
                "shutdown",
                "manager",
                "error",
                Some("mcp_shutdown_failed"),
                Some(&err.to_string()),
            );
        }
    }

    if let Some(err) = health_error {
        log_lifecycle_event(
            audit,
            "health",
            "manager",
            "error",
            Some("mcp_health_check_failed"),
            Some(&err.to_string()),
        );
        if let Err(shutdown_err) = stopped {
            log_lifecycle_event(
                audit,
                "shutdown",
                "manager",
                "error",
                Some("mcp_shutdown_failed"),
                Some(&shutdown_err.to_string()),
            );
            return Err(err.context(format!(
                "MCP lifecycle health check failed and shutdown also failed: {shutdown_err}"
            )));
        }
        return Err(err);
    }

    Ok(McpLifecycleReport {
        started,
        health,
        stopped: stopped?,
    })
}

fn log_lifecycle_event(
    audit: Option<LifecycleAudit<'_>>,
    stage: &str,
    server: &str,
    result: &str,
    error_code: Option<&str>,
    error_message: Option<&str>,
) {
    if let Some(audit) = audit {
        let tool = format!("mcp_lifecycle:{}:{}", stage, server);
        let _ =
            audit
                .logger
                .log_tool_invocation(audit.mode, &tool, result, error_code, error_message);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        McpProcessManager, McpServerHealth, run_lifecycle_check, run_lifecycle_check_with_audit,
    };
    use crate::audit::logger::{AuditLogger, AuditRecord};
    use crate::mcp::config::{McpConfig, McpServerConfig};
    use crate::modes::runtime_mode::RuntimeMode;
    use std::collections::HashMap;
    use std::env;
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn server(name: &str, command: &str, args: &[&str]) -> McpServerConfig {
        McpServerConfig {
            name: name.to_string(),
            command: command.to_string(),
            args: args.iter().map(|value| value.to_string()).collect(),
            env: HashMap::new(),
            cwd: None,
        }
    }

    fn long_running_server(name: &str) -> McpServerConfig {
        #[cfg(windows)]
        {
            server(
                name,
                "powershell",
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Start-Sleep -Milliseconds 5000",
                ],
            )
        }
        #[cfg(not(windows))]
        {
            server(name, "sh", &["-c", "sleep 5"])
        }
    }

    fn fast_exit_server(name: &str) -> McpServerConfig {
        #[cfg(windows)]
        {
            server(name, "cmd", &["/C", "exit 0"])
        }
        #[cfg(not(windows))]
        {
            server(name, "sh", &["-c", "exit 0"])
        }
    }

    fn invalid_server(name: &str) -> McpServerConfig {
        server(name, "__fastcode_missing_mcp_command__", &[])
    }

    #[test]
    fn starts_checks_health_and_shuts_down_server() {
        let mut manager = McpProcessManager::new();
        let handle = manager
            .start_server(&long_running_server("filesystem"))
            .expect("start MCP server");
        assert_eq!(handle.name, "filesystem");
        assert!(handle.pid > 0);

        let health = manager.health("filesystem").expect("health check");
        assert_eq!(health, McpServerHealth::Running);

        let stopped = manager
            .shutdown_server("filesystem")
            .expect("shutdown server");
        assert!(stopped);
        assert!(manager.managed_names().is_empty());
    }

    #[test]
    fn reports_exited_server_health_state() {
        let mut manager = McpProcessManager::new();
        manager
            .start_server(&fast_exit_server("github"))
            .expect("start MCP server");

        let mut health = manager.health("github").expect("health check");
        for _ in 0..20 {
            if matches!(health, McpServerHealth::Exited(_)) {
                break;
            }
            thread::sleep(Duration::from_millis(20));
            health = manager.health("github").expect("health check");
        }

        assert!(
            matches!(health, McpServerHealth::Exited(_)),
            "expected exited health, got {health:?}"
        );

        let stopped = manager.shutdown_server("github").expect("shutdown server");
        assert!(stopped);
        assert!(manager.managed_names().is_empty());
    }

    #[test]
    fn starts_and_stops_all_servers_from_config() {
        let config = McpConfig {
            servers: vec![
                long_running_server("filesystem"),
                long_running_server("github"),
            ],
        };
        let mut manager = McpProcessManager::new();
        let handles = manager.start_all(&config).expect("start all");
        assert_eq!(handles.len(), 2);
        assert_eq!(
            manager.managed_names(),
            vec!["filesystem".to_string(), "github".to_string()]
        );

        let stopped = manager.shutdown_all().expect("shutdown all");
        assert_eq!(stopped, 2);
        assert!(manager.managed_names().is_empty());
    }

    #[test]
    fn lifecycle_check_reports_start_health_and_shutdown_counts() {
        let config = McpConfig {
            servers: vec![long_running_server("filesystem")],
        };

        let report = run_lifecycle_check(&config).expect("run lifecycle check");
        assert_eq!(report.started.len(), 1);
        assert_eq!(report.health.len(), 1);
        assert_eq!(report.stopped, 1);
        assert_eq!(report.health[0].0, "filesystem");
        assert_eq!(report.health[0].1, McpServerHealth::Running);
    }

    #[test]
    fn lifecycle_check_writes_audit_events_for_start_health_and_shutdown() {
        let temp_dir = unique_temp_dir("mcp-lifecycle-audit");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let log_path = temp_dir.join("audit.jsonl");
        let logger = AuditLogger::new(&log_path);
        let config = McpConfig {
            servers: vec![long_running_server("filesystem")],
        };

        let report = run_lifecycle_check_with_audit(&config, RuntimeMode::Edit, &logger)
            .expect("run lifecycle check with audit");
        assert_eq!(report.started.len(), 1);
        assert_eq!(report.health.len(), 1);
        assert_eq!(report.stopped, 1);

        let raw = std::fs::read_to_string(&log_path).unwrap();
        let records = raw
            .lines()
            .map(|line| serde_json::from_str::<AuditRecord>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 3);
        assert_eq!(records[0].mode, RuntimeMode::Edit);
        assert_eq!(records[0].tool, "mcp_lifecycle:start:filesystem");
        assert_eq!(records[0].result, "success");
        assert_eq!(records[1].tool, "mcp_lifecycle:health:filesystem");
        assert_eq!(records[1].result, "success");
        assert_eq!(records[2].tool, "mcp_lifecycle:shutdown:filesystem");
        assert_eq!(records[2].result, "success");

        cleanup_dir(&temp_dir);
    }

    #[test]
    fn lifecycle_check_start_failure_is_auditable_and_cleans_up_started_servers() {
        let temp_dir = unique_temp_dir("mcp-lifecycle-start-failure");
        cleanup_dir(&temp_dir);
        std::fs::create_dir_all(&temp_dir).unwrap();

        let log_path = temp_dir.join("audit.jsonl");
        let logger = AuditLogger::new(&log_path);
        let config = McpConfig {
            servers: vec![
                long_running_server("filesystem"),
                invalid_server("broken-server"),
            ],
        };

        let err = run_lifecycle_check_with_audit(&config, RuntimeMode::Edit, &logger)
            .expect_err("lifecycle check should fail on invalid command");
        let message = err.to_string();
        assert!(
            message.contains("MCP lifecycle start failed for server 'broken-server'"),
            "{message}"
        );
        assert!(
            message.contains("started 1 server(s) before failure and stopped 1"),
            "{message}"
        );

        let raw = std::fs::read_to_string(&log_path).unwrap();
        let records = raw
            .lines()
            .map(|line| serde_json::from_str::<AuditRecord>(line).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(records.len(), 3);

        assert_eq!(records[0].tool, "mcp_lifecycle:start:filesystem");
        assert_eq!(records[0].result, "success");

        assert_eq!(records[1].tool, "mcp_lifecycle:start:broken-server");
        assert_eq!(records[1].result, "error");
        assert_eq!(records[1].error_code.as_deref(), Some("mcp_start_failed"));

        assert_eq!(records[2].tool, "mcp_lifecycle:shutdown:filesystem");
        assert_eq!(records[2].result, "success");

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
}
