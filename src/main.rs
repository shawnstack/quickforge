use anyhow::Context;
use clap::Parser;
use fastcode::audit::logger::AuditLogger;
use fastcode::mcp::config::McpConfig;
use fastcode::mcp::lifecycle::{
    McpServerHealth, run_lifecycle_check, run_lifecycle_check_with_audit,
};
use fastcode::modes::runtime_mode::RuntimeMode;
use fastcode::tui;
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
    #[arg(long)]
    mcp_config: Option<PathBuf>,
    #[arg(long, default_value_t = false)]
    list_mcp_servers: bool,
    #[arg(long, default_value_t = false)]
    check_mcp_lifecycle: bool,
    #[arg(long)]
    audit_log: Option<PathBuf>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let mode = RuntimeMode::from_str(&cli.mode)?;

    if cli.list_mcp_servers {
        let config_path = cli
            .mcp_config
            .as_ref()
            .with_context(|| "--list-mcp-servers requires --mcp-config <path-to-json-config>")?;
        let config = McpConfig::load_from_path(config_path)?;
        println!("loaded {} MCP server(s):", config.servers.len());
        for name in config.server_names() {
            println!("- {}", name);
        }
        return Ok(());
    }

    if cli.check_mcp_lifecycle {
        let config_path = cli
            .mcp_config
            .as_ref()
            .with_context(|| "--check-mcp-lifecycle requires --mcp-config <path-to-json-config>")?;
        let config = McpConfig::load_from_path(config_path)?;
        let report = if let Some(path) = &cli.audit_log {
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
        tui::run_app(mode)?;
    } else {
        println!("fastcode bootstrap running in mode: {}", mode);
        println!("hint: run with --tui to launch the terminal UI");
    }
    Ok(())
}
