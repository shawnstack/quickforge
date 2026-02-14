use anyhow::Context;
use clap::{Parser, Subcommand};
use fastcode::audit::logger::AuditLogger;
use fastcode::mcp::config::McpConfig;
use fastcode::mcp::lifecycle::{
    McpLifecycleReport, McpServerHealth, run_lifecycle_check, run_lifecycle_check_with_audit,
};
use fastcode::modes::runtime_mode::RuntimeMode;
use fastcode::tui::{self, McpDiagnostics};
use std::path::PathBuf;
use std::str::FromStr;

#[derive(Debug, Parser)]
#[command(name = "fastcode")]
#[command(about = "FastCode Rust TUI bootstrap")]
struct Cli {
    #[arg(long, default_value = "edit")]
    mode: String,
    #[arg(long, default_value_t = false)]
    tui: bool,
    #[command(subcommand)]
    command: Option<Command>,
    // Backward-compatible legacy flags.
    #[arg(long)]
    mcp_config: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    list_mcp_servers: bool,
    #[arg(long, default_value_t = false)]
    check_mcp_lifecycle: bool,
    #[arg(long)]
    audit_log: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// MCP-related operations.
    Mcp(McpCommand),
}

#[derive(Debug, Parser)]
struct McpCommand {
    #[command(subcommand)]
    action: McpAction,
}

#[derive(Debug, Subcommand)]
enum McpAction {
    /// List server names from MCP config.
    List {
        #[arg(long)]
        mcp_config: PathBuf,
    },
    /// Start/health-check/shutdown all configured MCP servers.
    CheckLifecycle {
        #[arg(long)]
        mcp_config: PathBuf,
        #[arg(long)]
        audit_log: Option<PathBuf>,
    },
}

#[derive(Debug, PartialEq, Eq)]
enum CliAction {
    None,
    McpList {
        config_path: PathBuf,
    },
    McpCheckLifecycle {
        config_path: PathBuf,
        audit_log: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mode = RuntimeMode::from_str(&cli.mode)?;
    let action = resolve_action(&cli)?;

    if let CliAction::McpList { config_path } = action {
        let config = McpConfig::load_from_path(&config_path)?;
        println!("loaded {} MCP server(s):", config.servers.len());
        for name in config.server_names() {
            println!("- {}", name);
        }
        return Ok(());
    }

    if let CliAction::McpCheckLifecycle {
        config_path,
        audit_log,
    } = action
    {
        let config = McpConfig::load_from_path(&config_path)?;
        let report = if let Some(path) = &audit_log {
            let logger = AuditLogger::new(path.clone());
            run_lifecycle_check_with_audit(&config, mode, &logger)?
        } else {
            run_lifecycle_check(&config)?
        };

        println!("started {} MCP server(s):", report.started.len());
        for handle in &report.started {
            println!("- {} (pid {})", handle.name, handle.pid);
        }

        println!("health check:");
        let mut exited = Vec::new();
        for (name, state) in &report.health {
            match state {
                McpServerHealth::Running => println!("- {}: running", name),
                McpServerHealth::Exited(code) => {
                    println!("- {}: exited ({:?})", name, code);
                    exited.push(name.clone());
                }
            }
        }

        println!("shutdown complete: stopped {} server(s)", report.stopped);

        if !exited.is_empty() {
            anyhow::bail!(
                "MCP lifecycle check failed: server(s) exited early: {}",
                exited.join(", ")
            );
        }

        if report.stopped != report.started.len() {
            anyhow::bail!(
                "MCP lifecycle check failed: started {} server(s) but stopped {}",
                report.started.len(),
                report.stopped
            );
        }

        return Ok(());
    }

    if cli.tui {
        let mcp_diagnostics = match cli.mcp_config.as_ref() {
            Some(config_path) => Some(build_mcp_diagnostics(config_path)),
            None => None,
        };
        tui::run_app_with_mcp_diagnostics(mode, mcp_diagnostics, cli.mcp_config.clone())?;
    } else {
        println!("fastcode bootstrap running in mode: {}", mode);
        println!("hint: run with --tui to launch the terminal UI");
    }
    Ok(())
}

fn resolve_action(cli: &Cli) -> anyhow::Result<CliAction> {
    match &cli.command {
        Some(Command::Mcp(mcp)) => {
            if cli.list_mcp_servers || cli.check_mcp_lifecycle || cli.mcp_config.is_some() {
                anyhow::bail!(
                    "legacy MCP flags cannot be combined with subcommands; use either `mcp ...` or legacy flags"
                );
            }

            let action = match &mcp.action {
                McpAction::List { mcp_config } => CliAction::McpList {
                    config_path: mcp_config.clone(),
                },
                McpAction::CheckLifecycle {
                    mcp_config,
                    audit_log,
                } => CliAction::McpCheckLifecycle {
                    config_path: mcp_config.clone(),
                    audit_log: audit_log.clone(),
                },
            };
            Ok(action)
        }
        None => {
            let mut legacy_actions = 0usize;
            if cli.list_mcp_servers {
                legacy_actions += 1;
            }
            if cli.check_mcp_lifecycle {
                legacy_actions += 1;
            }
            if legacy_actions > 1 {
                anyhow::bail!(
                    "multiple MCP actions requested; choose one of --list-mcp-servers or --check-mcp-lifecycle"
                );
            }

            if cli.list_mcp_servers {
                let config_path = cli.mcp_config.as_ref().with_context(
                    || "--list-mcp-servers requires --mcp-config <path-to-json-config>",
                )?;
                return Ok(CliAction::McpList {
                    config_path: config_path.clone(),
                });
            }

            if cli.check_mcp_lifecycle {
                let config_path = cli.mcp_config.as_ref().with_context(
                    || "--check-mcp-lifecycle requires --mcp-config <path-to-json-config>",
                )?;
                return Ok(CliAction::McpCheckLifecycle {
                    config_path: config_path.clone(),
                    audit_log: cli.audit_log.clone(),
                });
            }

            Ok(CliAction::None)
        }
    }
}

fn build_mcp_diagnostics(config_path: &PathBuf) -> McpDiagnostics {
    match McpConfig::load_from_path(config_path) {
        Ok(config) => match run_lifecycle_check(&config) {
            Ok(report) => diagnostics_from_report(&report),
            Err(err) => McpDiagnostics {
                status_label: "error".to_string(),
                messages: vec![format!("system: MCP diagnostics failed: {}", err)],
            },
        },
        Err(err) => McpDiagnostics {
            status_label: "invalid-config".to_string(),
            messages: vec![format!(
                "system: MCP config load failed ({}): {}",
                config_path.display(),
                err
            )],
        },
    }
}

fn diagnostics_from_report(report: &McpLifecycleReport) -> McpDiagnostics {
    let mut running = 0usize;
    let mut exited = Vec::new();
    for (name, state) in &report.health {
        match state {
            McpServerHealth::Running => running += 1,
            McpServerHealth::Exited(code) => exited.push((name.clone(), *code)),
        }
    }

    let total = report.health.len();
    if exited.is_empty() {
        return McpDiagnostics {
            status_label: format!("ok {running}/{total}"),
            messages: vec![format!(
                "system: MCP diagnostics healthy ({running}/{total} running)"
            )],
        };
    }

    let mut messages = vec![format!(
        "system: MCP diagnostics degraded ({running}/{total} running)"
    )];
    for (name, code) in exited {
        messages.push(format!(
            "system: MCP server '{}' exited during health check with code {:?}",
            name, code
        ));
    }

    McpDiagnostics {
        status_label: format!("degraded {running}/{total}"),
        messages,
    }
}

#[cfg(test)]
mod tests {
    use super::{Cli, CliAction, resolve_action};
    use clap::Parser;
    use std::path::PathBuf;

    #[test]
    fn parses_mcp_list_subcommand_without_legacy_flags() {
        let cli = Cli::try_parse_from(["fastcode", "mcp", "list", "--mcp-config", "a.json"])
            .expect("parse should succeed");
        let action = resolve_action(&cli).expect("action should resolve");
        assert_eq!(
            action,
            CliAction::McpList {
                config_path: PathBuf::from("a.json"),
            }
        );
    }

    #[test]
    fn rejects_combined_legacy_mcp_actions() {
        let cli = Cli::try_parse_from([
            "fastcode",
            "--list-mcp-servers",
            "--check-mcp-lifecycle",
            "--mcp-config",
            "a.json",
        ])
        .expect("parse should succeed");
        let err = resolve_action(&cli).expect_err("action should fail");
        assert!(
            err.to_string().contains("multiple MCP actions requested"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn rejects_mixed_subcommand_and_legacy_flags() {
        let cli = Cli::try_parse_from([
            "fastcode",
            "--list-mcp-servers",
            "--mcp-config",
            "a.json",
            "mcp",
            "list",
            "--mcp-config",
            "b.json",
        ])
        .expect("parse should succeed");
        let err = resolve_action(&cli).expect_err("action should fail");
        assert!(
            err.to_string()
                .contains("legacy MCP flags cannot be combined"),
            "unexpected error: {err}"
        );
    }
}
