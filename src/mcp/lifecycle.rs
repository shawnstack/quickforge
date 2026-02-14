use crate::mcp::config::{McpConfig, McpServerConfig};
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
    let mut manager = McpProcessManager::new();
    let started = manager.start_all(config)?;

    let mut health = Vec::new();
    let mut health_error = None;
    for name in manager.managed_names() {
        match manager.health(&name) {
            Ok(state) => health.push((name, state)),
            Err(err) => {
                health_error = Some(err);
                break;
            }
        }
    }

    let stopped = manager.shutdown_all();

    if let Some(err) = health_error {
        if let Err(shutdown_err) = stopped {
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

#[cfg(test)]
mod tests {
    use super::{McpProcessManager, McpServerHealth, run_lifecycle_check};
    use crate::mcp::config::{McpConfig, McpServerConfig};
    use std::collections::HashMap;
    use std::thread;
    use std::time::Duration;

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
}
